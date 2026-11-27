import office from "../../shared/hide/office.json" with { type: "json" };
import catalogue from "../../shared/hide/models.json" with { type: "json" };
import { createWorld, type ModelCatalogue } from "../../shared/hide/world.js";

export { office };
export const models: ModelCatalogue = catalogue;
export * from "../../shared/hide/world.js";
export const officeWorld = createWorld(office, models);
export const { walk, eye, target, fits, cameraDistance, hiderColliders } = officeWorld;
