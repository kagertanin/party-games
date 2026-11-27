"""Rebuild Prop Hunt map bundles. Supply local map-pack and game checkouts (see CREDITS.txt).
Pillow is only needed for this offline import, to sample the original Kenney colour palettes.
"""
import argparse
import json
from pathlib import Path
import struct

from PIL import Image


DESTINATION = Path(__file__).resolve().parents[1] / "shared/hide"


def compact(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def linear(value):
    srgb = value / 255
    return srgb / 12.92 if srgb < 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4


def self_contained_glb(path):
    original = path.read_bytes()
    header_size = struct.unpack_from("<I", original, 12)[0]
    gltf = json.loads(original[20:20 + header_size])
    if not gltf.get("images"):
        return original

    # These particular assets use nearest-neighbour, flat palette swatches.
    # Bake their UV colours once, avoiding runtime image requests and texture sampling.
    binary = bytearray(original[28 + header_size:])
    palettes = [Image.open(path.parent / image["uri"]).convert("RGB") for image in gltf["images"]]
    for mesh in gltf["meshes"]:
        for prim in mesh["primitives"]:
            pbr = gltf["materials"][prim["material"]]["pbrMetallicRoughness"]
            tex = pbr.get("baseColorTexture")
            if tex is None:
                continue
            palette = palettes[gltf["textures"][tex["index"]]["source"]]
            uv = gltf["accessors"][prim["attributes"]["TEXCOORD_0"]]
            view = gltf["bufferViews"][uv["bufferView"]]
            assert uv["componentType"] == 5126 and uv["type"] == "VEC2"
            start = view.get("byteOffset", 0) + uv.get("byteOffset", 0)
            stride = view.get("byteStride", 8)
            offset = len(binary)
            for i in range(uv["count"]):
                u, v = struct.unpack_from("<ff", binary, start + i * stride)
                rgb = palette.getpixel((int((u % 1) * palette.width), int((v % 1) * palette.height)))
                binary.extend(struct.pack("<fff", *(linear(channel) for channel in rgb)))
            prim["attributes"]["COLOR_0"] = len(gltf["accessors"])
            gltf["accessors"].append({"bufferView": len(gltf["bufferViews"]), "componentType": 5126,
                                      "count": uv["count"], "type": "VEC3"})
            gltf["bufferViews"].append({"buffer": 0, "byteOffset": offset,
                                        "byteLength": len(binary) - offset, "target": 34962})

    for material in gltf["materials"]:
        material["pbrMetallicRoughness"].pop("baseColorTexture", None)
    for key in ("images", "textures", "samplers"):
        gltf.pop(key, None)
    gltf["buffers"][0]["byteLength"] = len(binary)
    encoded = compact(gltf)
    encoded += b" " * (-len(encoded) % 4)
    return (struct.pack("<4sIIII", b"glTF", 2, 28 + len(encoded) + len(binary), len(encoded), 0x4E4F534A)
            + encoded + struct.pack("<I4s", len(binary), b"BIN\0") + binary)


def package(name, map_checkout, game, catalogue):
    source = json.loads((map_checkout / "maps" / f"ph_{name}.json").read_bytes())
    level = {key: source[key] for key in ("boxes", "props", "spawns")}
    # Base ground can be split into slabs around a pool or pond.
    floors = [box for box in level["boxes"] if box["mat"] == "grass" and box.get("solid", True)]
    level["bounds"] = [extreme(box["at"][axis] + sign * box["size"][axis] / 2 for box in floors)
                       for axis in (0, 2) for extreme, sign in ((min, -1), (max, 1))]
    packed = bytearray()
    models = {}
    for model in sorted({prop["id"] for prop in level["props"]}):
        entry = catalogue[model]
        data = self_contained_glb(game / entry["model"])
        models[model] = {"size": entry["size"], "offset": len(packed), "length": len(data),
                         "disguise": entry["disguise"]}
        packed.extend(data)
    (DESTINATION / f"{name}.json").write_bytes(compact(level) + b"\n")
    (DESTINATION / f"{name}-models.json").write_bytes(compact(models) + b"\n")
    (DESTINATION / f"{name}-models.bin").write_bytes(packed)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("map_checkout", type=Path)
    parser.add_argument("game_checkout", type=Path)
    args = parser.parse_args()
    entries = json.loads((args.game_checkout / "props/catalogue.json").read_bytes())["props"]
    for map_name in ("house", "school", "woods"):
        package(map_name, args.map_checkout, args.game_checkout, {p["id"]: p for p in entries})
