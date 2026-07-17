import * as THREE from "three";

// PRECISA bater com src/track.ts (ROAD_WIDTH e o outerW/outerH/cornerRadius de cada TrackConfig
// em TRACK_PRESETS) no client, senão os bots do servidor seguem um traçado diferente da pista
// que o client desenha.
export const ROAD_WIDTH = 24;

interface MapShapeConfig {
  outerW: number;
  outerH: number;
  roadWidth: number;
  cornerRadius: number;
}

const MAP_SHAPES: Record<string, MapShapeConfig> = {
  estadio: { outerW: 210, outerH: 140, roadWidth: ROAD_WIDTH, cornerRadius: 46 },
  litoral: { outerW: 260, outerH: 120, roadWidth: ROAD_WIDTH, cornerRadius: 40 },
  noturno: { outerW: 190, outerH: 130, roadWidth: ROAD_WIDTH, cornerRadius: 42 },
};

function stadiumShape(width: number, height: number, radius: number): THREE.Shape {
  const shape = new THREE.Shape();
  const hw = width / 2 - radius;
  const hh = height / 2 - radius;

  shape.moveTo(-hw, -height / 2);
  shape.lineTo(hw, -height / 2);
  shape.absarc(hw, -hh, radius, -Math.PI / 2, 0, false);
  shape.lineTo(width / 2, hh);
  shape.absarc(hw, hh, radius, 0, Math.PI / 2, false);
  shape.lineTo(-hw, height / 2);
  shape.absarc(-hw, hh, radius, Math.PI / 2, Math.PI, false);
  shape.lineTo(-width / 2, -hh);
  shape.absarc(-hw, -hh, radius, Math.PI, Math.PI * 1.5, false);

  return shape;
}

export interface TrackPoint {
  x: number;
  z: number;
}

export interface TrackPath {
  waypoints: TrackPoint[];
  startIndex: number;
  startHeading: number;
  gridPosition(slot: number): TrackPoint;
}

const GRID_COLS = [-6, 6];
const GRID_ROW_SPACING = 7;

/**
 * Recalcula, só com matemática (sem malha 3D), o mesmo traçado central que o client desenha em
 * `createTrack` — usado pelos bots pra saber pra onde dirigir e pra posicionar os carros na grid
 * de largada.
 */
export function buildTrackPath(mapId: string): TrackPath {
  const cfg = MAP_SHAPES[mapId] ?? MAP_SHAPES.estadio;

  const centerW = cfg.outerW - cfg.roadWidth;
  const centerH = cfg.outerH - cfg.roadWidth;
  const centerR = Math.max(cfg.cornerRadius - cfg.roadWidth / 2, 1);
  const centerlinePts = stadiumShape(centerW, centerH, centerR).getSpacedPoints(110);
  const waypoints: TrackPoint[] = centerlinePts.map((p) => ({ x: p.x, z: p.y }));

  const startX = 0;
  const startZ = -cfg.outerH / 2 + cfg.roadWidth / 2;

  let startIndex = 0;
  let bestDistSq = Infinity;
  waypoints.forEach((p, i) => {
    const d = (p.x - startX) ** 2 + (p.z - startZ) ** 2;
    if (d < bestDistSq) {
      bestDistSq = d;
      startIndex = i;
    }
  });

  const next = waypoints[(startIndex + 1) % waypoints.length];
  const startHeading = Math.atan2(next.x - startX, next.z - startZ);

  const lateral = { x: Math.cos(startHeading), z: -Math.sin(startHeading) };
  const forward = { x: Math.sin(startHeading), z: Math.cos(startHeading) };

  function gridPosition(slot: number): TrackPoint {
    const col = GRID_COLS[slot % GRID_COLS.length];
    const row = Math.floor(slot / GRID_COLS.length);
    return {
      x: startX + lateral.x * col + forward.x * -row * GRID_ROW_SPACING,
      z: startZ + lateral.z * col + forward.z * -row * GRID_ROW_SPACING,
    };
  }

  return { waypoints, startIndex, startHeading, gridPosition };
}
