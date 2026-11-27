import office from "../shared/hide/office.json" with { type: "json" };
import officeModels from "../shared/hide/models.json" with { type: "json" };
import house from "../shared/hide/house.json" with { type: "json" };
import houseModels from "../shared/hide/house-models.json" with { type: "json" };
import school from "../shared/hide/school.json" with { type: "json" };
import schoolModels from "../shared/hide/school-models.json" with { type: "json" };
import woods from "../shared/hide/woods.json" with { type: "json" };
import woodsModels from "../shared/hide/woods-models.json" with { type: "json" };
import { createWorld, type HideWorld, type MapLevel, type ModelCatalogue, type Player } from "../shared/hide/world.js";
import type { MapId } from "../shared/hide/maps.js";

const maps: Record<MapId, [MapLevel, ModelCatalogue]> = {
  office: [office, officeModels],
  house: [house, houseModels],
  school: [school, schoolModels],
  woods: [woods, woodsModels],
};

// Many rooms can use one immutable geometry index.
const worlds = new Map<MapId, HideWorld>();
export function roomWorld(id: MapId): HideWorld {
  let world = worlds.get(id);
  if (!world) {
    world = createWorld(...maps[id]);
    worlds.set(id, world);
  }
  return world;
}

// Test the authored spawns against our solid model footprints. Crowded rooms
// may need more positions than the source map provides for a single team.
export function roundSpawn(world: HideWorld, player: Player, index: number, placed: Player[]) {
  const spots = player.hunter ? world.level.spawns.hunters : world.level.spawns.props;
  const spot = spots[index % spots.length];
  const x = spot.at[0], z = spot.at[2] + Math.floor(index / spots.length) * 0.9;
  function clear(px: number, pz: number) {
    return world.fits(player, px, pz) &&
      placed.every(p => Math.abs(p.x - px) >= 0.60 || Math.abs(p.z - pz) >= 0.60);
  }
  if (clear(x, z)) return { x, z, yaw: spot.yaw };
  for (let r = 1; r <= 15; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const px = x + dx * 0.5, pz = z + dz * 0.5;
        if (clear(px, pz)) return { x: px, z: pz, yaw: spot.yaw };
      }
    }
  }
  throw new Error("No clear starting position near an authored spawn");
}
