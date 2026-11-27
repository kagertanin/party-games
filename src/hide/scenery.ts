import * as T from "three";
import type { MapId } from "../../shared/hide/maps";

// The map's tint is applied on top of this base colour during the static geometry bake.
export const sceneryPalette: Record<string, number> = {
  concrete: 0xa8aeb5, asphalt: 0x4a5158, sidewalk: 0xb7bebc, carpet: 0xa9b9c3,
  paint: 0xffefdc, wood: 0xba9978, metal: 0x8495a1, roof: 0x75868b,
  ceiling: 0xeeeadc, glass: 0xa7dbe2, fabric: 0x779aa6, flat: 0xe6e1ce,
  plaster: 0xf2e5d9, wood_floor: 0xc79569, parquet: 0xd0a375, gym: 0xe3bb85,
  tile: 0xd6dedb, tile_check: 0xb1c6c8, tile_small: 0xd2e3e5,
  line: 0xf4f3e3, grass: 0x88b774, dirt: 0xb08b64, sand: 0xddc595,
  brick: 0xcc9581, stone: 0xaba6a0, locker: 0x6d91ad, chalkboard: 0x3f6254,
  rubber: 0xb17769, water: 0x529fb8,
};

// Direction and colour are constant during a round. Only the moving actors need live lights.
const daylight = {
  office: { horizon: 0xc1dbe6, sky: 0xfff3e0, ground: 0xc3cbd5, sun: 0xffefd7, from: [-18, 32, 22] },
  house:  { horizon: 0xe2d1bf, sky: 0xfff2e0, ground: 0xc6cabb, sun: 0xffdfae, from: [-25, 22, 15] },
  school: { horizon: 0xc4dceb, sky: 0xfff7ea, ground: 0xc6d0bf, sun: 0xffe9c5, from: [19, 35, 25] },
  woods:  { horizon: 0xeebd91, sky: 0xffe6cd, ground: 0xbfc4a9, sun: 0xffca94, from: [-32, 15, 8] },
} satisfies Record<MapId, { horizon: number; sky: number; ground: number; sun: number; from: number[] }>;

export function lightScene(id: MapId, scene: T.Scene, sky: T.HemisphereLight, sun: T.DirectionalLight) {
  const light = daylight[id];
  scene.background = new T.Color(light.horizon);
  sky.color.setHex(light.sky);
  sky.groundColor.setHex(light.ground);
  sun.color.setHex(light.sun);
  sun.position.fromArray(light.from);
}
