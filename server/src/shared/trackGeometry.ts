/**
 * Geometria da pista — fonte única pro client (que desenha a malha 3D) e pro servidor (que simula
 * os bots e decide as voltas). Antes isso vivia copiado à mão em `src/track.ts` e
 * `server/src/trackPath.ts`; bastava mudar o `cornerRadius` de um mapa e esquecer do outro lado
 * pros bots do servidor passarem a dirigir por cima da grama, sem erro nenhum aparecer.
 *
 * Não usa three.js de propósito: é matemática pura de retângulo com cantos arredondados. Assim o
 * servidor não precisa carregar uma lib 3D inteira só pra saber onde fica a pista.
 */

export const ROAD_WIDTH = 24;

/** Quantos passos a linha central é amostrada. Client e servidor PRECISAM usar o mesmo valor —
 * é o que faz o waypoint nº N significar o mesmo lugar nos dois lados. Por isso mora aqui. */
export const CENTERLINE_DIVISIONS = 110;

export interface Point2 {
  x: number;
  z: number;
}

export interface MapShape {
  outerW: number;
  outerH: number;
  roadWidth: number;
  cornerRadius: number;
}

export const DEFAULT_MAP_ID = "vale";

/**
 * Só a FORMA de cada circuito. A cara dele (céu, cores, vegetação) fica em `TRACK_PRESETS`, no
 * client — o servidor não precisa saber que cor tem o céu, mas precisa saber onde fica a pista.
 *
 * `cornerRadius` grande = curvas longas e abertas; pequeno = curvas mais fechadas e retas maiores.
 */
export const MAP_SHAPES: Record<string, MapShape> = {
  // vale: o clássico, equilibrado — é o circuito de estreia
  vale: { outerW: 210, outerH: 140, roadWidth: ROAD_WIDTH, cornerRadius: 46 },
  // palmares: bem alongado, duas retas compridas pra abrir o motor
  palmares: { outerW: 275, outerH: 115, roadWidth: ROAD_WIDTH, cornerRadius: 38 },
  // meia-noite: o mais curto e apertado, curvas fechadas
  medianoite: { outerW: 185, outerH: 130, roadWidth: ROAD_WIDTH, cornerRadius: 40 },
  // dunas: o maior, curvas bem longas e abertas
  dunas: { outerW: 250, outerH: 165, roadWidth: ROAD_WIDTH, cornerRadius: 58 },
};

export function mapShape(mapId: string): MapShape {
  return MAP_SHAPES[mapId] ?? MAP_SHAPES[DEFAULT_MAP_ID];
}

interface Segment {
  len: number;
  /** u vai de 0 a 1 dentro do segmento */
  at(u: number): Point2;
}

/**
 * Amostra o contorno de um "estádio" (retângulo de cantos arredondados) em `divisions` passos de
 * COMPRIMENTO DE ARCO iguais, devolvendo `divisions + 1` pontos — o último repete o primeiro, pra
 * fechar o circuito (as fitas de triângulo do client contam com isso pra não deixar buraco).
 *
 * Substitui o `new THREE.Shape(...).getSpacedPoints(n)` que os dois lados usavam antes. O motivo de
 * espaçar por comprimento de arco continua o mesmo da época do three: o `getPoints()` NÃO subdivide
 * trecho reto, e reta é a maior parte do percurso — sem isso, cada reta virava dois pontos só, e a
 * elevação/os waypoints pulavam de um canto ao outro.
 */
export function stadiumPoints(
  width: number,
  height: number,
  radius: number,
  divisions: number
): Point2[] {
  const steps = Math.max(1, Math.floor(divisions));
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  const hw = Math.max(0, width / 2 - r);
  const hh = Math.max(0, height / 2 - r);

  const segments: Segment[] = [];

  function line(x0: number, z0: number, x1: number, z1: number) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len <= 0) return;
    segments.push({ len, at: (u) => ({ x: x0 + (x1 - x0) * u, z: z0 + (z1 - z0) * u }) });
  }

  function arc(cx: number, cz: number, a0: number, a1: number) {
    const len = Math.abs(a1 - a0) * r;
    if (len <= 0) return;
    segments.push({
      len,
      at: (u) => {
        const a = a0 + (a1 - a0) * u;
        return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r };
      },
    });
  }

  // mesma ordem e sentido do traçado antigo: reta de baixo -> canto -> reta da direita -> ...
  line(-hw, -height / 2, hw, -height / 2);
  arc(hw, -hh, -Math.PI / 2, 0);
  line(hw + r, -hh, hw + r, hh);
  arc(hw, hh, 0, Math.PI / 2);
  line(hw, hh + r, -hw, hh + r);
  arc(-hw, hh, Math.PI / 2, Math.PI);
  line(-hw - r, hh, -hw - r, -hh);
  arc(-hw, -hh, Math.PI, Math.PI * 1.5);

  if (segments.length === 0) {
    // forma degenerada (largura/altura zero) — devolve o mesmo ponto repetido em vez de estourar
    const points: Point2[] = [];
    for (let i = 0; i <= steps; i++) points.push({ x: 0, z: 0 });
    return points;
  }

  let total = 0;
  for (const seg of segments) total += seg.len;

  const points: Point2[] = [];
  let segIndex = 0;
  let consumed = 0;

  for (let i = 0; i < steps; i++) {
    const target = (total * i) / steps;
    while (segIndex < segments.length - 1 && target > consumed + segments[segIndex].len) {
      consumed += segments[segIndex].len;
      segIndex++;
    }
    const seg = segments[segIndex];
    const u = Math.min(1, Math.max(0, (target - consumed) / seg.len));
    points.push(seg.at(u));
  }
  // fecha o laço repetindo o primeiro ponto
  points.push({ x: points[0].x, z: points[0].z });

  return points;
}

export interface TrackPath {
  /** linha central da pista — é o que a IA persegue e o que conta progresso/voltas */
  waypoints: Point2[];
  /** índice do waypoint mais próximo da linha de chegada (onde a volta fecha) */
  startIndex: number;
  startHeading: number;
  start: Point2;
  gridPosition(slot: number): Point2;
}

/** duas colunas por fileira — não cabem 10 carros lado a lado numa pista de 24 de largura */
const GRID_COLS = [-6, 6];
const GRID_ROW_SPACING = 7;

/**
 * Monta o traçado de um mapa: linha central, ponto/índice de largada e as vagas da grid.
 *
 * A linha de chegada VISUAL e o ponto que conta "completou uma volta" saem os dois daqui, do mesmo
 * `startIndex` — quando eram calculados separado, os carros cruzavam o quadriculado sem a volta
 * contar, porque o índice de referência ficava em outro lugar da pista.
 */
export function buildTrackPath(mapId: string): TrackPath {
  const cfg = mapShape(mapId);

  const centerW = cfg.outerW - cfg.roadWidth;
  const centerH = cfg.outerH - cfg.roadWidth;
  const centerR = Math.max(cfg.cornerRadius - cfg.roadWidth / 2, 1);
  const waypoints = stadiumPoints(centerW, centerH, centerR, CENTERLINE_DIVISIONS);

  // largada no meio da reta de baixo, no centro da pista
  const start: Point2 = { x: 0, z: -cfg.outerH / 2 + cfg.roadWidth / 2 };

  let startIndex = 0;
  let bestDistSq = Infinity;
  waypoints.forEach((p, i) => {
    const d = (p.x - start.x) ** 2 + (p.z - start.z) ** 2;
    if (d < bestDistSq) {
      bestDistSq = d;
      startIndex = i;
    }
  });

  const next = waypoints[(startIndex + 1) % waypoints.length];
  const startHeading = Math.atan2(next.x - start.x, next.z - start.z);

  // lateral = perpendicular ao sentido da pista, pra alinhar os carros lado a lado na largada
  const lateral = { x: Math.cos(startHeading), z: -Math.sin(startHeading) };
  const forward = { x: Math.sin(startHeading), z: Math.cos(startHeading) };

  function gridPosition(slot: number): Point2 {
    const col = GRID_COLS[slot % GRID_COLS.length];
    const row = Math.floor(slot / GRID_COLS.length);
    return {
      x: start.x + lateral.x * col + forward.x * -row * GRID_ROW_SPACING,
      z: start.z + lateral.z * col + forward.z * -row * GRID_ROW_SPACING,
    };
  }

  return { waypoints, startIndex, startHeading, start, gridPosition };
}
