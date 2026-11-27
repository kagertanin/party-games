import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { PNG } from "pngjs";

const images = new Map<string, Buffer>();
const writers = new Map<
  string,
  { image: string; revision: number; active: () => boolean; avatar: boolean }
>();
const limit = 1400000;
export function pictureSlot(
  active: () => boolean,
  purpose: "drawing" | "avatar" = "drawing",
) {
  const image = randomBytes(18).toString("hex");
  const upload = randomBytes(24).toString("hex");
  writers.set(upload, {
    image,
    active,
    revision: -1,
    avatar: purpose === "avatar",
  });
  return {
    upload: "/draw-upload/" + upload,
    url: "/draw-picture/" + image,
    exists: () => images.has(image),
    dispose() {
      writers.delete(upload);
      images.delete(image);
    },
  };
}
export async function drawImageRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  const url = new URL(req.url || "/", "http://localhost");
  if (!/^\/draw-(upload|picture)\//.test(url.pathname)) return false;
  const key = url.pathname.split("/")[2];
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  const finish = (code: number, body?: Buffer) => {
    res.statusCode = code;
    res.end(body);
    return true;
  };
  if (req.method === "OPTIONS") return finish(204);
  if (url.pathname.startsWith("/draw-picture/") && req.method === "GET") {
    const data = images.get(key);
    if (!data) return finish(404);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "private, max-age=1200, immutable");
    return finish(200, data);
  }
  const writer = writers.get(key);
  if (
    !writer ||
    req.method !== "POST" ||
    !url.pathname.startsWith("/draw-upload/")
  )
    return finish(404);
  if (!writer.active()) return finish(409);
  const rev = Number(url.searchParams.get("v"));
  if (
    !Number.isSafeInteger(rev) ||
    rev < 0 ||
    req.headers["content-type"] !== "image/png"
  )
    return finish(400);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) return finish(413);
      chunks.push(chunk);
    }
  } catch {
    return finish(400);
  }
  const data = Buffer.concat(chunks);
  if (
    data.length < 45 ||
    data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    data.toString("ascii", 12, 16) !== "IHDR" ||
    data.readUInt32BE(16) !== 640 ||
    data.readUInt32BE(20) !== 480 ||
    data.toString("ascii", data.length - 8, data.length - 4) !== "IEND"
  )
    return finish(400);
  if (writer.avatar) {
    // Browser canvases export a single non-interlaced header. Keep the
    // decoder's allocation bound to the validated 640 × 480 dimensions.
    if (data.readUInt32BE(8) !== 13 || data[28] !== 0) return finish(400);
    let offset = 33;
    while (offset + 12 <= data.length) {
      if (data.toString("ascii", offset + 4, offset + 8) === "IHDR")
        return finish(400);
      offset += 12 + data.readUInt32BE(offset);
    }
    if (offset !== data.length) return finish(400);
    // The editor exports a transparent PNG. Undoing or erasing everything must
    // not make an empty portrait count as a ready player.
    try {
      const pixels = PNG.sync.read(data).data;
      let hasInk = false;
      for (let alpha = 3; alpha < pixels.length; alpha += 4) {
        if (pixels[alpha] > 0) {
          hasInk = true;
          break;
        }
      }
      if (!hasInk) return finish(422);
    } catch {
      return finish(400);
    }
  }
  if (!writer.active() || writers.get(key) !== writer) return finish(409);
  if (rev >= writer.revision) {
    images.set(writer.image, data);
    writer.revision = rev;
  }
  return finish(204);
}
