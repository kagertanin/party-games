import { direction, type Player } from "./world.js";

export type Point = [number, number, number];
export interface Shot {
  shooter: string;
  hit: string;
  origin: Point;
  end: Point;
  impact: boolean;
  penalty?: boolean;
}

export const revealDuration = 3500;

// Resolve the crosshair ray on the server. Clients draw from the gun barrel
// to the same impact point, including hits on furniture or walls.
export function shotPath(shooter: Player, distance: number, hit: string, height: number): Shot {
  const origin: Point = [shooter.x, height, shooter.z];
  const dir = direction(shooter.yaw, shooter.pitch);
  const range = Number.isFinite(distance) ? distance : 150;
  return {
    shooter: shooter.id, hit, origin,
    end: [origin[0] + dir[0] * range, origin[1] + dir[1] * range, origin[2] + dir[2] * range],
    impact: Number.isFinite(distance),
  };
}
