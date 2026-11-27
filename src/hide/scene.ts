import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  office,
  models,
  cameraBoom,
  cameraDistance,
  rad,
  eye,
  target,
  direction,
  type Player,
  type Snapshot,
  type Input,
} from "../../shared/hide/world";

import type { MoveBatch } from "../../shared/hide/movement";
import { LocalMotion, RemoteMotion } from "./motion";

const palette: Record<string, number> = {
  concrete: 0xa8aeb5,
  asphalt: 0x4a5158,
  sidewalk: 0xb7bebc,
  carpet: 0xa9b9c3,
  paint: 0xffefdc,
  wood: 0xba9978,
  metal: 0x8495a1,
  roof: 0x75868b,
  ceiling: 0xeeeadc,
  glass: 0xa7dbe2,
  fabric: 0x779aa6,
  flat: 0xe6e1ce,
};
export async function createScene(
  canvas: HTMLCanvasElement,
  id: string,
  send: (batch: MoveBatch) => void,
  use: (aim: Input, seen: number) => void,
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  const scene = new T.Scene();
  scene.background = new T.Color(0xc1dbe6);
  const camera = new T.PerspectiveCamera(72, 1, 0.035, 175);
  camera.rotation.order = "YXZ";
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }).observe(canvas);
  scene.add(new T.HemisphereLight(0xfff3e0, 0xc3cbd5, 2));
  const sun = new T.DirectionalLight(0xffefd7, 2);
  sun.position.set(-18, 32, 22);
  scene.add(sun);
  // A small first-person marker makes the hunter's firing direction visible.
  const blaster = new T.Group();
  function blasterPart(
    w: number,
    h: number,
    d: number,
    color: number,
    x: number,
    y: number,
    z: number,
  ) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshStandardMaterial({ color }),
    );
    mesh.position.set(x, y, z);
    blaster.add(mesh);
  }
  blasterPart(0.11, 0.12, 0.32, 0x287b78, 0, 0, 0);
  blasterPart(0.075, 0.08, 0.12, 0xf1b244, 0, 0, -0.2);
  blasterPart(0.075, 0.12, 0.07, 0x32444d, 0, -0.08, 0.08);
  camera.add(blaster);
  scene.add(camera);
  blaster.position.set(0.22, -0.19, -0.43);
  const templates = new Map<string, T.Object3D>();
  const data = await fetch(
    new URL("../../shared/hide/office-models.bin", import.meta.url),
  ).then((r) => {
    if (!r.ok) throw Error("Модели офиса не загрузились");
    return r.arrayBuffer();
  });
  const loader = new GLTFLoader();
  await Promise.all(
    Object.entries(models).map(async ([key, meta]) => {
      const { scene: g } = await loader.parseAsync(
        data.slice(meta.offset, meta.offset + meta.length),
        "",
      );
      const box = new T.Box3().setFromObject(g),
        size = box.getSize(new T.Vector3()),
        center = box.getCenter(new T.Vector3());
      const holder = new T.Group();
      holder.add(g);
      g.position.sub(new T.Vector3(center.x, box.min.y, center.z));
      holder.scale.set(
        meta.size[0] / size.x,
        meta.size[1] / size.y,
        meta.size[2] / size.z,
      );
      templates.set(key, holder);
    }),
  );
  const boxGeo = new T.BoxGeometry(1, 1, 1),
    actor = new T.Group();
  function part(
    w: number,
    h: number,
    d: number,
    y: number,
    color: number,
    x = 0,
    z = 0,
  ) {
    const m = new T.Mesh(boxGeo, new T.MeshStandardMaterial({ color }));
    m.scale.set(w, h, d);
    m.position.set(x, y, z);
    actor.add(m);
  }
  part(0.46, 0.66, 0.31, 0.97, 0x298983);
  part(0.34, 0.35, 0.33, 1.5, 0xedbf98);
  part(0.36, 0.1, 0.35, 1.7, 0x44445c);
  for (const x of [-0.13, 0.13]) part(0.19, 0.62, 0.23, 0.32, 0x354256, x);
  // The office assets use solid PBR colours. Bake their colours and transforms
  // once, so unlike per-model instancing, different models share a draw call.
  const batches = new Map<
    string,
    { pieces: T.BufferGeometry[]; material: T.MeshStandardMaterial }
  >();
  function collect(obj: T.Object3D) {
    obj.updateMatrixWorld(true);
    obj.traverse((node) => {
      if (
        !(node instanceof T.Mesh) ||
        !(node.material instanceof T.MeshStandardMaterial)
      )
        return;
      const source = node.material;
      // Split by office quadrant for frustum culling and preserve surface properties.
      const key = [
        obj.position.x < 0,
        obj.position.z < 0,
        source.roughness,
        source.metalness,
        source.side,
        source.transparent,
        source.opacity,
        source.depthWrite,
      ].join(":");
      let batch = batches.get(key);
      if (!batch) {
        const material = source.clone();
        material.color.setRGB(1, 1, 1);
        material.vertexColors = true;
        batch = { material, pieces: [] };
        batches.set(key, batch);
      }
      const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
      const colors = new Float32Array(geometry.getAttribute("position").count * 3);
      for (let i = 0; i < colors.length; i += 3) source.color.toArray(colors, i);
      geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
      // These models have no textures. Discard their unused texture coordinates.
      for (const name of Object.keys(geometry.attributes))
        if (name !== "position" && name !== "normal" && name !== "color")
          geometry.deleteAttribute(name);
      if (!geometry.index) {
        const count = geometry.getAttribute("position").count;
        geometry.setIndex(Array.from({ length: count }, (_, i) => i));
      }
      batch.pieces.push(geometry);
    });
  }
  const materials = new Map<string, T.MeshStandardMaterial>();
  for (const b of office.boxes) {
    const key = b.mat + ":" + b.tint;
    if (!materials.has(key)) {
      const color = new T.Color(palette[b.mat] ?? 0xeeeeee);
      if (b.tint) color.multiply(new T.Color().fromArray(b.tint));
      materials.set(
        key,
        new T.MeshStandardMaterial({
          color,
          transparent: b.mat === "glass",
          opacity: b.mat === "glass" ? 0.28 : 1,
          depthWrite: b.mat !== "glass",
          roughness: 0.9,
        }),
      );
    }
    const mesh = new T.Mesh(boxGeo, materials.get(key));
    mesh.position.fromArray(b.at);
    mesh.scale.fromArray(b.size);
    collect(mesh);
  }
  for (const p of office.props) {
    const obj = new T.Group();
    obj.add(templates.get(p.id)!.clone());
    obj.position.fromArray(p.at);
    obj.rotation.y = (p.yaw ?? 0) * rad;
    collect(obj);
  }
  for (const batch of batches.values()) {
    const geometry = mergeGeometries(batch.pieces);
    if (!geometry) throw Error("Не удалось объединить модели офиса");
    scene.add(new T.Mesh(geometry, batch.material));
  }
  batches.clear();
  let view: Snapshot | undefined,
    self: Player | undefined,
    yaw = 0,
    pitch = 0,
    phase = "",
    last = performance.now(),
    sent = 0,
    renderedTime = 0;
  let prediction: LocalMotion | undefined;
  const remotes = new RemoteMotion();
  const actors = new Map<string, { obj: T.Group; form: string }>();
  const keys = new Set<string>();
  let touchX = 0,
    touchY = 0;
  const input = (): Input => ({
    side: T.MathUtils.clamp(Number(keys.has("KeyD")) - Number(keys.has("KeyA")) + touchX, -1, 1),
    forward: T.MathUtils.clamp(Number(keys.has("KeyW")) - Number(keys.has("KeyS")) + touchY, -1, 1),
    yaw,
    pitch,
  });
  function flush() {
    let batch;
    while ((batch = prediction?.takeBatch())) send(batch);
  }
  function action() {
    flush();
    use(input(), renderedTime || view?.now || 0);
  }
  function stop() {
    keys.clear();
    touchX = touchY = 0;
    flush();
  }
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", () => {
    last = performance.now();
    if (document.hidden) stop();
  });
  document.addEventListener("pointerlockchange", () => {
    if (!document.pointerLockElement) stop();
  });
  function looking(dx: number, dy: number) {
    yaw -= dx * 0.0025;
    pitch = T.MathUtils.clamp(pitch - dy * 0.0025, -1.48, 1.48);
  }
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === canvas)
      looking(e.movementX, e.movementY);
  });
  window.addEventListener("keydown", (e) => {
    if (!canvas.offsetWidth || e.target instanceof HTMLInputElement) return;
    keys.add(e.code);
    if (e.code === "KeyE" && !e.repeat) {
      action();
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));
  canvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || matchMedia("(pointer:coarse)").matches) return;
    if (document.pointerLockElement !== canvas) {
      canvas.requestPointerLock()?.catch(() => {});
      return;
    }
    if (self?.hunter) {
      action();
    }
  });
  let touch: { id: number; x: number; y: number } | undefined;
  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse") {
      canvas.setPointerCapture(e.pointerId);
      touch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    if (touch?.id === e.pointerId) {
      looking(e.clientX - touch.x, e.clientY - touch.y);
      touch.x = e.clientX;
      touch.y = e.clientY;
    }
  });
  canvas.addEventListener("pointerup", () => (touch = undefined));
  function update(v: Snapshot) {
    const me = v.players.find((p) => p.id === id);
    if (!me) return;
    const active = me.alive && (v.phase === "hunt" || (v.phase === "hide" && !me.hunter));
    if (!prediction || !active) {
      yaw = me.yaw;
      pitch = me.pitch;
      self = { ...me };
      prediction = active ? new LocalMotion(me, v.ack) : undefined;
      last = performance.now();
      sent = 0;
    } else {
      prediction.reconcile(me, v.ack);
      self = prediction.pose(input());
    }
    remotes.push(v, performance.now());
    phase = v.phase;
    view = v;
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(),
      dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    if (
      !view || !self || document.hidden ||
      !(phase === "hunt" || (phase === "hide" && !self.hunter))
    ) return;
    if (prediction) {
      const i = input();
      prediction.advance(i, dt);
      self = prediction.pose(i);
      if (now - sent >= 50) {
        flush();
        sent = now;
      }
    }
    renderedTime = remotes.at(now);
    const hunter = !self.alive && view.players.find(p => p.hunter);
    const follow = hunter ? remotes.pose(hunter, renderedTime) : self;
    const angle = follow === self ? yaw : follow.yaw,
      tilt = follow === self ? pitch : follow.pitch;
    camera.rotation.set(tilt, angle, 0, "YXZ");
    camera.position.set(follow.x, eye(follow), follow.z);
    blaster.visible = follow.hunter;
    if (!follow.hunter) {
      const forward = direction(angle, tilt),
        at = camera.position.toArray();
      const offset = new T.Vector3(
        -forward[0] * cameraBoom + Math.cos(angle) * 0.65,
        -forward[1] * cameraBoom + 0.48,
        -forward[2] * cameraBoom - Math.sin(angle) * 0.65,
      );
      const back = offset.normalize().toArray();
      camera.position.addScaledVector(offset, cameraDistance(at, back));
      const aim = target({ ...follow, yaw: angle, pitch: tilt });
      camera.lookAt(
        new T.Vector3()
          .fromArray(at)
          .addScaledVector(
            new T.Vector3().fromArray(forward),
            Math.max(0.25, Math.min(35, aim.distance)),
          ),
      );
    }
    for (const [key, a] of actors)
      if (!view.players.some((p) => p.id === key && p.alive)) {
        scene.remove(a.obj);
        actors.delete(key);
      }
    for (const p of view.players) {
      if (!p.alive) continue;
      let a = actors.get(p.id);
      if (!a || a.form !== p.form) {
        if (a) scene.remove(a.obj);
        const obj = new T.Group();
        obj.add((templates.get(p.form) ?? actor).clone());
        obj.position.set(p.x, 0, p.z);
        a = { obj, form: p.form };
        actors.set(p.id, a);
        scene.add(obj);
      }
      const local = p.id === id ? self : remotes.pose(p, renderedTime);
      a.obj.position.set(local.x, 0, local.z);
      a.obj.rotation.y = local.facing;
      a.obj.visible =
        !(follow.hunter && follow.id === p.id) &&
        !(
          p.id === id &&
          !p.hunter &&
          camera.position.distanceTo(new T.Vector3(self.x, eye(self), self.z)) <
            0.45
        );
    }
    renderer.render(scene, camera);
  }
  frame();
  return {
    update,
    joystick: (x: number, y: number) => {
      touchX = x;
      touchY = y;
    },
    action,
  };
}
