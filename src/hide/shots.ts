import * as T from "three";
import { revealDuration, type Shot } from "../../shared/hide/shot";
import type { HideWorld, Player } from "../../shared/hide/world";

/** Frame the stationary disguise from an open side, even with a wall or another prop behind it. */
export function foundView({ models, cameraDistance }: HideWorld, player: Player, yaw: number, shot?: Shot) {
  const [w, h, d] = models[player.form]?.size ?? [0.52, 1.72, 0.52];
  const focus = new T.Vector3(player.x, (player.y ?? 0) + Math.max(0.18, h * 0.62), player.z);
  const desired = T.MathUtils.clamp(Math.max(w, h, d) * 1.55, 1.25, 2.8);
  const origin = focus.toArray();
  const direction = new T.Vector3();
  let distance = 0;
  let position = focus.clone();
  for (const slope of [0.48, 1.25, 5]) {
    for (const turn of [0, 1, -1, 2, -2, 3, -3, 4]) {
      const angle = yaw + turn * Math.PI / 4;
      direction.set(Math.sin(angle), slope, Math.cos(angle)).normalize();
      const room = Math.min(desired, cameraDistance(origin, direction.toArray()));
      if (room > distance) {
        distance = room;
        position.copy(focus).addScaledVector(direction, room);
      }
      if (room >= desired) return { position, focus };
    }
  }
  // A disguise can touch the camera's collision margin on several sides.
  // The incoming shot also supplies a line of sight to the impact.
  if (distance < 0.45 && shot) {
    const impact = new T.Vector3(...shot.end);
    direction.fromArray(shot.origin).sub(impact);
    const length = direction.length();
    if (length > distance) {
      position = impact.addScaledVector(direction, Math.min(desired / length, 1));
    }
  }
  return { position, focus };
}

const unitBox = new T.BoxGeometry();
const sleeve = new T.MeshStandardMaterial({ color: 0x298983 });
const skin = new T.MeshStandardMaterial({ color: 0xedbf98 });
const grip = new T.MeshStandardMaterial({ color: 0x282d36 });
const slide = new T.MeshStandardMaterial({ color: 0x5e7483 });
const brass = new T.MeshStandardMaterial({ color: 0xf1b244 });

/** The shoulder is the pitch pivot. The muzzle marks the actual tracer origin. */
export function pistolArm() {
  const arm = new T.Group();
  arm.name = "pistol-arm";
  function part(material: T.Material, x: number, y: number, z: number,
    width: number, height: number, depth: number) {
    const mesh = new T.Mesh(unitBox, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(width, height, depth);
    arm.add(mesh);
  }
  part(sleeve, 0, 0, -0.1, 0.16, 0.17, 0.24);
  part(skin, 0, -0.012, -0.30, 0.12, 0.12, 0.22);
  part(grip, 0, 0.018, -0.44, 0.09, 0.2, 0.10);
  part(skin, 0.016, -0.018, -0.43, 0.116, 0.105, 0.13);
  part(slide, 0, 0.125, -0.52, 0.1, 0.10, 0.29);
  part(grip, 0, 0.098, -0.67, 0.075, 0.068, 0.07);
  part(brass, 0, 0.182, -0.62, 0.022, 0.018, 0.028);
  const muzzle = new T.Object3D();
  muzzle.position.set(0, 0.105, -0.71);
  arm.add(muzzle);
  return { arm, muzzle };
}

const beamGeometry = new T.CylinderGeometry(1, 1, 1, 5);
const sparkGeometry = new T.OctahedronGeometry(1);
const tracerMaterial = new T.MeshBasicMaterial({ color: 0xffcc51, toneMapped: false });
const flashMaterial = new T.MeshBasicMaterial({ color: 0xffed9a, toneMapped: false });
const up = new T.Vector3(0, 1, 0);
const start = new T.Vector3();
const end = new T.Vector3();
const axis = new T.Vector3();

export class ShotEffects {
  private shots: {
    start: T.Vector3; end: T.Vector3; beam: T.Mesh; flash: T.Mesh; impact: T.Mesh; born: number; solid: boolean;
  }[] = [];

  constructor(private scene: T.Scene) {}

  show(shot: Shot, muzzle: T.Object3D | undefined, now: number) {
    const from = muzzle ? muzzle.getWorldPosition(new T.Vector3()) : new T.Vector3(...shot.origin);
    const beam = new T.Mesh(beamGeometry, tracerMaterial);
    const flash = new T.Mesh(sparkGeometry, flashMaterial);
    const impact = new T.Mesh(sparkGeometry, flashMaterial);
    beam.name = "shot-tracer";
    flash.name = "muzzle-flash";
    flash.position.copy(from);
    impact.position.fromArray(shot.end);
    this.scene.add(beam, flash, impact);
    this.shots.push({ start: from, end: impact.position.clone(), beam, flash, impact, born: now, solid: shot.impact });
  }

  update(now: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const shot = this.shots[i];
      const elapsed = now - shot.born;
      if (elapsed >= 230) {
        this.scene.remove(shot.beam, shot.flash, shot.impact);
        this.shots.splice(i, 1);
        continue;
      }
      shot.flash.scale.setScalar(0.12 * Math.max(0, 1 - elapsed / 100));
      const travel = Math.min(1, (elapsed + 25) / 115);
      const tail = Math.max(0, (elapsed - 30) / 115);
      start.lerpVectors(shot.start, shot.end, Math.min(travel, tail));
      end.lerpVectors(shot.start, shot.end, travel);
      axis.subVectors(end, start);
      const length = axis.length();
      shot.beam.visible = length > 0.001;
      if (shot.beam.visible) {
        shot.beam.position.addVectors(start, end).multiplyScalar(0.5);
        shot.beam.scale.set(0.018, length, 0.018);
        shot.beam.quaternion.setFromUnitVectors(up, axis.multiplyScalar(1 / length));
      }
      shot.impact.visible = shot.solid && elapsed >= 83;
      shot.impact.scale.setScalar(0.09 * Math.max(0, 1 - (elapsed - 83) / 147));
    }
  }
}

const red = new T.MeshBasicMaterial({ color: 0xff2845, side: T.DoubleSide });
const droplet = new T.MeshBasicMaterial({ color: 0xc31532 });
const dropTransform = new T.Object3D();
const dropCount = 18;

/** Each caught avatar owns only one instanced emitter. Shared model materials stay intact. */
export class FoundEffect {
  private drops: T.InstancedMesh;
  private surfaces: { mesh: T.Mesh; original: T.Material | T.Material[] }[] = [];
  private glowing = false;
  constructor(private model: T.Group, private height: number) {
    model.traverse(node => {
      if (node instanceof T.Mesh) this.surfaces.push({ mesh: node, original: node.material });
    });
    this.drops = new T.InstancedMesh(sparkGeometry, droplet, dropCount);
    this.drops.name = "hit-droplets";
    this.drops.frustumCulled = false;
    this.model.add(this.drops);
  }

  update(age: number) {
    const showDrops = age < revealDuration;
    this.drops.visible = showDrops;
    if (showDrops) {
      const seconds = Math.max(0, age / 1000);
      for (let i = 0; i < dropCount; i++) {
        const launch = i / dropCount * 0.72;
        const dt = Math.max(0, seconds - launch) % 0.72;
        const angle = i * 2.4;
        const speed = 0.40 + (i % 4) * 0.18;
        const y = Math.max(0.018, this.height * 0.66 + (1.1 + i % 3 * 0.3) * dt - 4.8 * dt * dt);
        dropTransform.position.set(Math.cos(angle) * dt * speed, y, Math.sin(angle) * dt * speed);
        const radius = seconds < launch ? 0 : 0.038 * (1 - dt / 1.1);
        dropTransform.scale.set(radius, radius * 1.7, radius);
        dropTransform.updateMatrix();
        this.drops.setMatrixAt(i, dropTransform.matrix);
      }
      this.drops.instanceMatrix.needsUpdate = true;
    }
    const glow = age < 130 || (!showDrops && Math.floor((age - revealDuration) / 350) % 2 === 0);
    if (this.glowing === glow) return;
    this.glowing = glow;
    for (const { mesh, original } of this.surfaces) mesh.material = glow ? red : original;
  }

  dispose() {
    this.model.remove(this.drops);
    this.drops.dispose();
    for (const { mesh, original } of this.surfaces) mesh.material = original;
  }
}
