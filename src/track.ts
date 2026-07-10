import * as THREE from "three";

const HILL_AMP_1 = 4;
const HILL_AMP_2 = 1.2;
// desloca a onda pra cima, então a elevação nunca fica negativa (nunca afunda em relação à grama)
const HILL_OFFSET = HILL_AMP_1 + HILL_AMP_2;

/** Elevação do terreno/pista em função do ângulo ao redor do centro da pista (cria subidas e descidas). */
export function elevationAt(x: number, z: number): number {
  const theta = Math.atan2(z, x);
  const t = (theta + Math.PI) / (Math.PI * 2);
  return (
    Math.sin(t * Math.PI * 4) * HILL_AMP_1 +
    Math.sin(t * Math.PI * 10 + 1.7) * HILL_AMP_2 +
    HILL_OFFSET
  );
}

export const ROAD_WIDTH = 18;

/**
 * Acha o waypoint (ponto do centro da pista) mais próximo de (x,z). Usado tanto pra saber a
 * altura correta do carro (em vez de recalcular a fórmula de elevação na posição bruta do carro,
 * que diverge da pista quando ele não está exatamente no centro) quanto pra detectar se o carro
 * saiu da pista.
 */
export function findNearestWaypoint(
  x: number,
  z: number,
  waypoints: THREE.Vector3[]
): { index: number; distance: number } {
  let best = 0;
  let bestDistSq = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDistSq) {
      bestDistSq = d;
      best = i;
    }
  }
  return { index: best, distance: Math.sqrt(bestDistSq) };
}

/**
 * Altura suave da pista em (x,z): acha o waypoint mais próximo e projeta a posição no segmento
 * vizinho (anterior ou seguinte, o que estiver mais perto) pra interpolar a elevação entre os
 * dois. Usar só a altura do waypoint mais próximo faz o carro "pular" toda vez que o waypoint
 * mais próximo muda — como andar em paralelepípedo.
 */
export function sampleTrackElevation(x: number, z: number, waypoints: THREE.Vector3[]): number {
  const { index } = findNearestWaypoint(x, z, waypoints);
  const n = waypoints.length;
  const prev = waypoints[(index - 1 + n) % n];
  const curr = waypoints[index];
  const next = waypoints[(index + 1) % n];

  function projectOnSegment(a: THREE.Vector3, b: THREE.Vector3) {
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const lenSq = abx * abx + abz * abz;
    let t = lenSq > 0 ? ((x - a.x) * abx + (z - a.z) * abz) / lenSq : 0;
    t = THREE.MathUtils.clamp(t, 0, 1);
    const px = a.x + abx * t;
    const pz = a.z + abz * t;
    const dist = Math.hypot(x - px, z - pz);
    return { t, dist, elevation: THREE.MathUtils.lerp(a.y, b.y, t) };
  }

  const segA = projectOnSegment(prev, curr);
  const segB = projectOnSegment(curr, next);

  return segA.dist <= segB.dist ? segA.elevation : segB.elevation;
}

/**
 * Calcula UMA elevação por índice (usando o ponto médio entre a borda externa e interna da
 * pista naquele índice), pra usar nos dois lados da fita — se cada borda calculasse sua própria
 * elevação separadamente, a pista ficava torta (a elevação depende do ângulo, e as duas bordas
 * têm ângulos ligeiramente diferentes, o que também desalinhava com a altura real do carro).
 */
function buildElevationProfile(outerPts: THREE.Vector2[], innerPts: THREE.Vector2[]): number[] {
  const n = Math.min(outerPts.length, innerPts.length);
  const profile: number[] = [];
  for (let i = 0; i < n; i++) {
    const midX = (outerPts[i].x + innerPts[i].x) / 2;
    const midZ = (outerPts[i].y + innerPts[i].y) / 2;
    profile.push(elevationAt(midX, midZ));
  }
  return profile;
}

/**
 * Constrói uma "fita" de triângulos entre dois contornos (pontos já amostrados em alta
 * resolução), usando uma elevação compartilhada por índice (ver `buildElevationProfile`).
 * Uma ShapeGeometry comum não tem vértices suficientes ao longo das retas pra elevação ficar suave.
 */
function buildRibbon(
  outerPts: THREE.Vector2[],
  innerPts: THREE.Vector2[],
  elevation: number[],
  baseY: number,
  material: THREE.Material
): THREE.Mesh {
  const positions: number[] = [];
  const n = Math.min(outerPts.length, innerPts.length) - 1;

  for (let i = 0; i < n; i++) {
    const o0 = outerPts[i];
    const o1 = outerPts[i + 1];
    const i0 = innerPts[i];
    const i1 = innerPts[i + 1];
    const e0 = baseY + elevation[i];
    const e1 = baseY + elevation[i + 1];

    const quad = [
      [o0.x, e0, o0.y],
      [o1.x, e1, o1.y],
      [i1.x, e1, i1.y],
      [o0.x, e0, o0.y],
      [i1.x, e1, i1.y],
      [i0.x, e0, i0.y],
    ];
    for (const v of quad) positions.push(v[0], v[1], v[2]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Constrói uma "saia" vertical (parede de sustentação) descendo de uma borda elevada da pista
 * até o nível da grama, pra fechar visualmente o vão nos trechos em que a pista fica acima do chão.
 */
function buildSkirt(
  pts: THREE.Vector2[],
  elevation: number[],
  topY: number,
  groundY: number,
  material: THREE.Material
): THREE.Mesh {
  const positions: number[] = [];
  const n = Math.min(pts.length, elevation.length) - 1;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const top0 = topY + elevation[i];
    const top1 = topY + elevation[i + 1];

    const quad = [
      [p0.x, top0, p0.y],
      [p1.x, top1, p1.y],
      [p1.x, groundY, p1.y],
      [p0.x, top0, p0.y],
      [p1.x, groundY, p1.y],
      [p0.x, groundY, p0.y],
    ];
    for (const v of quad) positions.push(v[0], v[1], v[2]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

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

function buildStripedRing(
  outerPts: THREE.Vector2[],
  innerPts: THREE.Vector2[],
  elevation: number[],
  baseY: number,
  stripeSegments: number
): THREE.Mesh {
  const positions: number[] = [];
  const colors: number[] = [];
  const colorA = new THREE.Color(0xcc2222);
  const colorB = new THREE.Color(0xf2f2f2);
  const n = Math.min(outerPts.length, innerPts.length) - 1;

  for (let i = 0; i < n; i++) {
    const o0 = outerPts[i];
    const o1 = outerPts[i + 1];
    const i0 = innerPts[i];
    const i1 = innerPts[i + 1];
    const e0 = baseY + elevation[i];
    const e1 = baseY + elevation[i + 1];
    const color = Math.floor(i / stripeSegments) % 2 === 0 ? colorA : colorB;

    const quad = [
      [o0.x, e0, o0.y],
      [o1.x, e1, o1.y],
      [i1.x, e1, i1.y],
      [o0.x, e0, o0.y],
      [i1.x, e1, i1.y],
      [i0.x, e0, i0.y],
    ];
    for (const v of quad) {
      positions.push(v[0], v[1], v[2]);
      colors.push(color.r, color.g, color.b);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createCheckeredTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const half = size / 2;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#111111";
  ctx.fillRect(0, 0, half, half);
  ctx.fillRect(half, half, half, half);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.NearestFilter;
  return texture;
}

function createTree(foliageColor = 0x2f7a3d): THREE.Group {
  const tree = new THREE.Group();

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x6b4a2f })
  );
  trunk.position.y = 0.8;
  trunk.castShadow = true;
  tree.add(trunk);

  const foliageMaterial = new THREE.MeshStandardMaterial({ color: foliageColor });
  const foliage1 = new THREE.Mesh(new THREE.ConeGeometry(1.6, 2.4, 8), foliageMaterial);
  foliage1.position.y = 2.4;
  foliage1.castShadow = true;
  tree.add(foliage1);

  const foliage2 = new THREE.Mesh(new THREE.ConeGeometry(1.2, 1.8, 8), foliageMaterial);
  foliage2.position.y = 3.6;
  foliage2.castShadow = true;
  tree.add(foliage2);

  return tree;
}

function createCloud(): THREE.Group {
  const cloud = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  const puffCount = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffCount; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 2, 8, 6), material);
    puff.position.set(i * 3.5 - (puffCount * 3.5) / 2, Math.random() * 1.5, Math.random() * 2);
    puff.scale.y = 0.6;
    cloud.add(puff);
  }
  return cloud;
}

function createMountain(height: number, color: number): THREE.Mesh {
  const mountain = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.9, height, 5),
    new THREE.MeshStandardMaterial({ color, roughness: 1 })
  );
  return mountain;
}

export function createTrack(scene: THREE.Scene) {
  // grama
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ color: 0x2d6a2f })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const outerW = 210;
  const outerH = 140;
  const roadWidth = ROAD_WIDTH;
  const cornerRadius = 46;

  const innerW = outerW - roadWidth * 2;
  const innerH = outerH - roadWidth * 2;
  const innerR = Math.max(cornerRadius - roadWidth, 1);

  // pontos em alta resolução das bordas da pista (usados pro asfalto E pro meio-fio,
  // garantindo elevação suave e encaixe perfeito entre eles)
  const outerEdgePts = stadiumShape(outerW, outerH, cornerRadius).getSpacedPoints(120);
  const innerEdgePts = stadiumShape(innerW, innerH, innerR).getSpacedPoints(120);
  const elevation = buildElevationProfile(outerEdgePts, innerEdgePts);

  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x363636,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  scene.add(buildRibbon(outerEdgePts, innerEdgePts, elevation, 0, roadMaterial));

  // meio-fio em zebra (vermelho/branco), borda externa e interna
  const outerCurbPts = stadiumShape(outerW + 3, outerH + 3, cornerRadius + 1.5).getSpacedPoints(120);
  scene.add(buildStripedRing(outerCurbPts, outerEdgePts, elevation, 0.01, 3));

  const innerCurbPts = stadiumShape(
    Math.max(innerW - 3, 1),
    Math.max(innerH - 3, 1),
    Math.max(innerR - 1.5, 0.5)
  ).getSpacedPoints(120);
  scene.add(buildStripedRing(innerEdgePts, innerCurbPts, elevation, 0.01, 3));

  // "saias" fechando o vão entre a pista elevada e a grama (evita buracos/flutuação visual)
  const skirtMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 1, side: THREE.DoubleSide });
  scene.add(buildSkirt(outerCurbPts, elevation, 0.01, -0.01, skirtMaterial));
  scene.add(buildSkirt(innerCurbPts, elevation, 0.01, -0.01, skirtMaterial));

  const centerW = outerW - roadWidth;
  const centerH = outerH - roadWidth;
  const centerR = Math.max(cornerRadius - roadWidth / 2, 1);
  const centerlineShape = stadiumShape(centerW, centerH, centerR);
  const waypoints = centerlineShape
    .getSpacedPoints(110)
    .map((p) => new THREE.Vector3(p.x, elevationAt(p.x, p.y), p.y));

  // linha central tracejada
  const dashMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2f2 });
  for (let i = 0; i < waypoints.length; i += 4) {
    const from = waypoints[i];
    const to = waypoints[(i + 1) % waypoints.length];
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    const dash = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 3), dashMaterial);
    dash.position.set(from.x, from.y + 0.015, from.z);
    dash.rotation.y = heading;
    scene.add(dash);
  }

  const startZ = -outerH / 2 + roadWidth / 2;
  const startPosition = new THREE.Vector3(0, elevationAt(0, startZ), startZ);

  // linha de chegada quadriculada
  const finishTexture = createCheckeredTexture();
  finishTexture.repeat.set(4, 1);
  const finishLine = new THREE.Mesh(
    new THREE.PlaneGeometry(roadWidth - 1, 5),
    new THREE.MeshStandardMaterial({ map: finishTexture })
  );
  finishLine.rotation.x = -Math.PI / 2;
  finishLine.position.set(startPosition.x, startPosition.y + 0.02, startPosition.z);
  finishLine.receiveShadow = true;
  scene.add(finishLine);

  // arquibancada simples numa das retas
  const standMaterial = new THREE.MeshStandardMaterial({ color: 0x777788 });
  const stand = new THREE.Mesh(new THREE.BoxGeometry(60, 8, 6), standMaterial);
  stand.position.set(0, 4, outerH / 2 + roadWidth + 14);
  stand.castShadow = true;
  stand.receiveShadow = true;
  scene.add(stand);

  // árvores ao redor da pista — dois anéis (mais perto e mais longe) pra dar densidade e profundidade
  const foliageColors = [0x2f7a3d, 0x357a42, 0x2a6b36, 0x3d8a4a];
  function scatterTrees(ringOffset: number, pointCount: number, everyN: number) {
    const pts = stadiumShape(outerW + ringOffset, outerH + ringOffset, cornerRadius + ringOffset / 2).getSpacedPoints(
      pointCount
    );
    pts.forEach((p, i) => {
      if (i % everyN !== 0) return;
      const jitter = Math.abs((Math.sin(i * 12.9898 + ringOffset) * 43758.5453) % 1);
      const jitter2 = Math.abs((Math.sin(i * 78.233 + ringOffset) * 12543.113) % 1);
      const tree = createTree(foliageColors[i % foliageColors.length]);
      tree.position.set(p.x + (jitter - 0.5) * 6, 0, p.y + (jitter2 - 0.5) * 6);
      tree.scale.setScalar(0.7 + jitter * 0.7);
      scene.add(tree);
    });
  }
  scatterTrees(55, 48, 1);
  scatterTrees(95, 40, 1);
  scatterTrees(140, 32, 2);

  // nuvens no céu
  for (let i = 0; i < 10; i++) {
    const cloud = createCloud();
    const angle = (i / 10) * Math.PI * 2;
    const radius = 220 + Math.random() * 120;
    cloud.position.set(Math.cos(angle) * radius, 55 + Math.random() * 25, Math.sin(angle) * radius);
    scene.add(cloud);
  }

  // montanhas no horizonte, pra dar profundidade ao fundo
  const mountainColors = [0x5a6b7a, 0x6b7a88, 0x4d5c6b];
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const radius = 320 + Math.random() * 60;
    const height = 40 + Math.random() * 50;
    const mountain = createMountain(height, mountainColors[i % mountainColors.length]);
    mountain.position.set(Math.cos(angle) * radius, height / 2 - 4, Math.sin(angle) * radius);
    scene.add(mountain);
  }

  return {
    startPosition,
    waypoints,
  };
}
