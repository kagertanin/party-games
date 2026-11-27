export const mapNames = {
  office: "Офис",
  house: "Дом",
  school: "Школа",
  woods: "Лес",
} as const;
export type MapId = keyof typeof mapNames;
export const isMapId = (id: unknown): id is MapId =>
  typeof id === "string" && Object.hasOwn(mapNames, id);
