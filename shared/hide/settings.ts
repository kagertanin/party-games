export interface HideSettings {
  hideSeconds: number;
  huntSeconds: number;
  shotsPerHunter: number;
}

export const defaultHideSettings: Readonly<HideSettings> = {
  hideSeconds: 60,
  huntSeconds: 300,
  shotsPerHunter: 6,
};

export const settingLimits: Readonly<HideSettings> = {
  hideSeconds: 3600,
  huntSeconds: 3600,
  shotsPerHunter: 999,
};

export function isHideSetting(key: unknown): key is keyof HideSettings {
  return typeof key === "string" && Object.hasOwn(settingLimits, key);
}

export function validSetting(key: keyof HideSettings, value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= settingLimits[key];
}
