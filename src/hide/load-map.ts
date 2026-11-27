import type { MapId } from "../../shared/hide/maps";
import { createWorld } from "../../shared/hide/world";

// Dynamic imports keep the other three levels off the network.
export async function loadWorld(id: MapId) {
  const [level, catalogue] = id === "office" ? await Promise.all([
    import("../../shared/hide/office.json"), import("../../shared/hide/models.json"),
  ]) : await Promise.all([
    import(`../../shared/hide/${id}.json`), import(`../../shared/hide/${id}-models.json`),
  ]);
  return createWorld(level.default, catalogue.default);
}
