import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  office,
  models,
  obstacles,
  intersect,
  rad,
  eye,
  walk,
  target,
  direction,
  type Player,
  type Snapshot,
  type Input,
} from "../../shared/hide/world";

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
  send: (input: Input) => void,
  use: () => void,
) {
  const renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new T.Scene();
  scene.background = new T.Color(0xc1dbe6);
  const camera = new T.PerspectiveCamera(72, 1, 0.035, 175);
  camera.rotation.order = "YXZ";
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
  // Batch repeated office objects and wall pieces on the GPU.
  const batches = new Map<
    string,
    {
      geometry: T.BufferGeometry;
      material: T.Material | T.Material[];
      matrices: T.Matrix4[];
    }
  >();
  function collect(obj: T.Object3D) {
    obj.updateMatrixWorld(true);
    obj.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const key =
        node.geometry.uuid +
        ":" +
        (Array.isArray(node.material)
          ? node.material.map((m) => m.uuid).join()
          : node.material.uuid);
      if (!batches.has(key))
        batches.set(key, {
          geometry: node.geometry,
          material: node.material,
          matrices: [],
        });
      batches.get(key)!.matrices.push(node.matrixWorld.clone());
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
  for (const b of batches.values()) {
    const mesh = new T.InstancedMesh(b.geometry, b.material, b.matrices.length);
    b.matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
    scene.add(mesh);
  }
  let view: Snapshot | undefined,
    self: Player | undefined,
    yaw = 0,
    pitch = 0,
    phase = "",
    last = performance.now(),
    sent = 0,
    correctionX = 0,
    correctionZ = 0;
  const actors = new Map<string, { obj: T.Group; form: string }>();
  const keys = new Set<string>();
  let touchX = 0,
    touchY = 0;
  const input = (): Input => ({
    side: Number(keys.has("KeyD")) - Number(keys.has("KeyA")) + touchX,
    forward: Number(keys.has("KeyW")) - Number(keys.has("KeyS")) + touchY,
    yaw,
    pitch,
  });
  function stop() {
    keys.clear();
    touchX = touchY = 0;
    if (self) send(input());
  }
  window.addEventListener("blur", stop);
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
      send(input());
      use();
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
      send(input());
      use();
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
    if (
      !self ||
      phase === "lobby" ||
      phase === "results" ||
      v.phase === "lobby"
    ) {
      yaw = me.yaw;
      pitch = me.pitch;
      self = { ...me };
      correctionX = correctionZ = 0;
    } else {
      correctionX = me.x - self.x;
      correctionZ = me.z - self.z;
      self = { ...me, x: self.x, z: self.z };
    }
    phase = v.phase;
    view = v;
  }
  function frame() {
    requestAnimationFrame(frame);
    const now = performance.now(),
      dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!view || !self || !canvas.offsetWidth) return;
    const active =
      self.alive && (phase === "hunt" || (phase === "hide" && !self.hunter));
    if (active) {
      const i = input();
      walk(self, i, dt);
      const blend = 1 - Math.exp(-dt * 7);
      self.x += correctionX * blend;
      self.z += correctionZ * blend;
      correctionX *= 1 - blend;
      correctionZ *= 1 - blend;
      if (now - sent >= 50) {
        send(i);
        sent = now;
      }
    }
    const follow = self.alive
      ? self
      : (view.players.find((p) => p.hunter) ?? self);
    const angle = follow === self ? yaw : follow.yaw,
      tilt = follow === self ? pitch : follow.pitch;
    camera.rotation.set(tilt, angle, 0, "YXZ");
    camera.position.set(follow.x, eye(follow), follow.z);
    blaster.visible = follow.hunter;
    if (!follow.hunter) {
      const forward = direction(angle, tilt),
        at = camera.position.toArray();
      const offset = new T.Vector3(
        -forward[0] * 2.8 + Math.cos(angle) * 0.65,
        -forward[1] * 2.8 + 0.48,
        -forward[2] * 2.8 - Math.sin(angle) * 0.65,
      );
      const back = offset.normalize().toArray();
      let dist = 2.8;
      for (const o of obstacles)
        dist = Math.min(dist, intersect(at, back, o) - 0.08);
      camera.position.addScaledVector(
        new T.Vector3().fromArray(back),
        Math.max(0.01, dist),
      );
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
      const local = p.id === id ? self : p;
      a.obj.position.lerp(
        new T.Vector3(local.x, 0, local.z),
        p.id === id ? 1 : 1 - Math.exp(-20 * dt),
      );
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
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    if (
      camera.aspect !== w / h ||
      canvas.width !== Math.floor(w * renderer.getPixelRatio())
    ) {
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
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
    action: () => {
      send(input());
      use();
    },
  };
}
