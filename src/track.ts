import * as THREE from "three";

const HILL_AMP_1 = 5;
const HILL_AMP_2 = 1.5;
// desloca a onda pra cima, então a elevação nunca fica negativa (nunca afunda em relação à grama)
const HILL_OFFSET = HILL_AMP_1 + HILL_AMP_2;

/**
 * Elevação do terreno/pista em função do ângulo ao redor do centro da pista (cria subidas e
 * descidas). Frequência baixa de propósito (1 subida+descida grande por volta, mais 2 menores por
 * cima) — com muitas subidas/descidas curtas, a elevação varia rápido demais em relação à largura
 * da pista, e qualquer aproximação fica sensível o bastante pra parecer que o carro afunda.
 *
 * IMPORTANTE: os multiplicadores de frequência (1 e 2) precisam ser números INTEIROS de ciclos
 * por volta. Com um valor não-inteiro (tipo 1.5), a função não fecha o ciclo exatamente onde a
 * pista dá a volta completa (t=0 e t=1 têm que dar o mesmo valor) — sobra um salto discreto de
 * elevação bem naquele ponto da pista, e o carro literalmente "teleporta" pra cima/baixo ali.
 */
export function elevationAt(x: number, z: number): number {
  const theta = Math.atan2(z, x);
  const t = (theta + Math.PI) / (Math.PI * 2);
  return (
    Math.sin(t * Math.PI * 2 * 1) * HILL_AMP_1 +
    Math.sin(t * Math.PI * 2 * 2 + 1.7) * HILL_AMP_2 +
    HILL_OFFSET
  );
}

export const ROAD_WIDTH = 24;

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
 * Calcula UMA elevação por índice (ponto médio entre a borda externa e interna), pra usar nos
 * dois lados da fita — se cada borda calculasse a sua separadamente, a pista ficava torta.
 * Agora que `elevationAt` varia bem devagar (poucas subidas/descidas por volta), calcular a
 * fórmula direto no ponto médio já é preciso o bastante — nada de tabela de busca por waypoint,
 * que era sensível a bugs de "pular de trecho" nas curvas.
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

/**
 * Constrói uma parede vertical que acompanha a elevação da pista tanto na base quanto no topo
 * (diferente da "saia", que vai até um nível de chão constante). Usada pras paredes do túnel.
 */
function buildWall(
  pts: THREE.Vector2[],
  elevation: number[],
  baseOffset: number,
  topOffset: number,
  material: THREE.Material
): THREE.Mesh {
  const positions: number[] = [];
  const n = Math.min(pts.length, elevation.length) - 1;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const base0 = elevation[i] + baseOffset;
    const base1 = elevation[i + 1] + baseOffset;
    const top0 = elevation[i] + topOffset;
    const top1 = elevation[i + 1] + topOffset;

    const quad = [
      [p0.x, base0, p0.y],
      [p1.x, base1, p1.y],
      [p1.x, top1, p1.y],
      [p0.x, base0, p0.y],
      [p1.x, top1, p1.y],
      [p0.x, top0, p0.y],
    ];
    for (const v of quad) positions.push(v[0], v[1], v[2]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Portal de concreto (dois pilares + viga) numa das pontas do túnel. */
function createTunnelPortal(width: number, height: number, material: THREE.Material): THREE.Group {
  const group = new THREE.Group();
  const thickness = 1.4;

  const pillarGeometry = new THREE.BoxGeometry(thickness, height, thickness);
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeometry, material);
    pillar.position.set((side * (width + thickness)) / 2, height / 2, 0);
    pillar.castShadow = true;
    group.add(pillar);
  }

  const lintel = new THREE.Mesh(
    new THREE.BoxGeometry(width + thickness * 3, thickness * 1.6, thickness * 1.6),
    material
  );
  lintel.position.set(0, height + thickness * 0.8, 0);
  lintel.castShadow = true;
  group.add(lintel);

  return group;
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

/** Montanha arredondada (cúpula), largura e altura variam independentemente pra ter tamanhos bem diferentes. */
function createMountain(height: number, width: number, color: number): THREE.Mesh {
  // só a metade de cima de uma esfera (domo), assentada no chão — dá o formato de morro arredondado
  const geometry = new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const mountain = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  mountain.scale.set(width, height, width);
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

  // waypoints do centro da pista — calculados JÁ AQUI (antes da malha) pra servir de referência
  // única de elevação, tanto pra malha quanto pro carro (ver comentário em buildElevationProfile)
  const centerW = outerW - roadWidth;
  const centerH = outerH - roadWidth;
  const centerR = Math.max(cornerRadius - roadWidth / 2, 1);
  const centerlinePts = stadiumShape(centerW, centerH, centerR).getSpacedPoints(110);
  const centerlineElevation = centerlinePts.map((p) => elevationAt(p.x, p.y));
  const waypoints = centerlinePts.map((p, i) => new THREE.Vector3(p.x, centerlineElevation[i], p.y));

  // pontos em alta resolução das bordas da pista (usados pro asfalto E pro meio-fio,
  // garantindo elevação suave e encaixe perfeito entre eles)
  const outerEdgePts = stadiumShape(outerW, outerH, cornerRadius).getSpacedPoints(120);
  const innerEdgePts = stadiumShape(innerW, innerH, innerR).getSpacedPoints(120);
  const elevation = buildElevationProfile(outerEdgePts, innerEdgePts);

  // asfalto verde-petróleo, tipo o Top Gear do SNES (não é cinza puro)
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: 0x2d4a44,
    roughness: 0.95,
    metalness: 0,
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

  // calçada de concreto entre o meio-fio e a grama, tipo circuito urbano retrô
  const sidewalkMaterial = new THREE.MeshStandardMaterial({ color: 0xb9b6a8, roughness: 1, side: THREE.DoubleSide });
  const outerSidewalkPts = stadiumShape(outerW + 12, outerH + 12, cornerRadius + 6).getSpacedPoints(120);
  scene.add(buildRibbon(outerSidewalkPts, outerCurbPts, elevation, 0.005, sidewalkMaterial));

  const innerSidewalkPts = stadiumShape(
    Math.max(innerW - 12, 1),
    Math.max(innerH - 12, 1),
    Math.max(innerR - 6, 0.5)
  ).getSpacedPoints(120);
  scene.add(buildRibbon(innerCurbPts, innerSidewalkPts, elevation, 0.005, sidewalkMaterial));

  // "saias" fechando o vão entre a pista elevada e a grama (evita buracos/flutuação visual)
  const skirtMaterial = new THREE.MeshStandardMaterial({ color: 0x6b6459, roughness: 1, side: THREE.DoubleSide });
  scene.add(buildSkirt(outerSidewalkPts, elevation, 0.005, -0.01, skirtMaterial));
  scene.add(buildSkirt(innerSidewalkPts, elevation, 0.005, -0.01, skirtMaterial));

  // postes de luz ao longo da calçada externa, tipo circuito urbano retrô
  const lampPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const lampHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2b0,
    emissive: 0xffdd66,
    emissiveIntensity: 1,
  });
  for (let i = 0; i < outerSidewalkPts.length; i += 8) {
    const p = outerSidewalkPts[i];
    const lampGroup = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 5, 6), lampPoleMaterial);
    pole.position.y = 2.5;
    pole.castShadow = true;
    lampGroup.add(pole);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), lampHeadMaterial);
    head.position.y = 5.1;
    lampGroup.add(head);
    lampGroup.position.set(p.x, elevation[i], p.y);
    scene.add(lampGroup);
  }

  // túnel bem comprido na reta de cima (oposta à largada) — acha o trecho reto onde z é máximo
  const topStraightZ = outerH / 2;
  let tunnelStartIdx = -1;
  let tunnelEndIdx = -1;
  for (let i = 0; i < outerEdgePts.length; i++) {
    if (Math.abs(outerEdgePts[i].y - topStraightZ) < 0.5) {
      if (tunnelStartIdx === -1) tunnelStartIdx = i;
      tunnelEndIdx = i;
    }
  }
  const TUNNEL_MARGIN = 3;
  const tunnelA = tunnelStartIdx + TUNNEL_MARGIN;
  const tunnelB = tunnelEndIdx - TUNNEL_MARGIN;

  if (tunnelStartIdx !== -1 && tunnelB > tunnelA) {
    const TUNNEL_HEIGHT = 10;
    const tunnelOuterPts = outerEdgePts.slice(tunnelA, tunnelB + 1);
    const tunnelInnerPts = innerEdgePts.slice(tunnelA, tunnelB + 1);
    const tunnelElevation = elevation.slice(tunnelA, tunnelB + 1);

    const tunnelWallMaterial = new THREE.MeshStandardMaterial({
      color: 0x3d3d3d,
      roughness: 0.9,
      side: THREE.DoubleSide,
    });
    const tunnelRoofMaterial = new THREE.MeshStandardMaterial({
      color: 0x232323,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });

    scene.add(buildWall(tunnelOuterPts, tunnelElevation, 0, TUNNEL_HEIGHT, tunnelWallMaterial));
    scene.add(buildWall(tunnelInnerPts, tunnelElevation, 0, TUNNEL_HEIGHT, tunnelWallMaterial));
    scene.add(buildRibbon(tunnelOuterPts, tunnelInnerPts, tunnelElevation, TUNNEL_HEIGHT, tunnelRoofMaterial));

    // luzes de teto (caixinhas emissivas), tipo luminárias de túnel
    const tunnelLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2b0,
      emissive: 0xffdd66,
      emissiveIntensity: 1.3,
    });
    for (let i = tunnelA + 2; i < tunnelB - 2; i += 4) {
      const outerPt = outerEdgePts[i];
      const innerPt = innerEdgePts[i];
      const nextOuter = outerEdgePts[i + 1];
      const cx = (outerPt.x + innerPt.x) / 2;
      const cz = (outerPt.y + innerPt.y) / 2;
      const heading = Math.atan2(nextOuter.x - outerPt.x, nextOuter.y - outerPt.y);
      const light = new THREE.Mesh(new THREE.BoxGeometry(roadWidth * 0.5, 0.15, 1.4), tunnelLightMaterial);
      light.position.set(cx, elevation[i] + TUNNEL_HEIGHT - 0.35, cz);
      light.rotation.y = heading;
      scene.add(light);
    }

    // portais de concreto nas duas pontas do túnel
    const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });
    function placePortal(index: number) {
      const outerPt = outerEdgePts[index];
      const innerPt = innerEdgePts[index];
      const nextOuter = outerEdgePts[Math.min(index + 1, outerEdgePts.length - 1)];
      const cx = (outerPt.x + innerPt.x) / 2;
      const cz = (outerPt.y + innerPt.y) / 2;
      const heading = Math.atan2(nextOuter.x - outerPt.x, nextOuter.y - outerPt.y);
      const portal = createTunnelPortal(roadWidth + 3, TUNNEL_HEIGHT, portalMaterial);
      portal.position.set(cx, elevation[index], cz);
      portal.rotation.y = heading;
      scene.add(portal);
    }
    placePortal(tunnelA);
    placePortal(tunnelB);
  }

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

  // árvores ao redor da pista — vários anéis (perto, médio, longe) pra dar densidade e profundidade
  const foliageColors = [0x2f7a3d, 0x357a42, 0x2a6b36, 0x3d8a4a, 0x276b38, 0x4a9456];
  function scatterTrees(ringOffset: number, pointCount: number, everyN: number, jitterRange: number) {
    const pts = stadiumShape(outerW + ringOffset, outerH + ringOffset, cornerRadius + ringOffset / 2).getSpacedPoints(
      pointCount
    );
    pts.forEach((p, i) => {
      if (i % everyN !== 0) return;
      const jitter = Math.abs((Math.sin(i * 12.9898 + ringOffset) * 43758.5453) % 1);
      const jitter2 = Math.abs((Math.sin(i * 78.233 + ringOffset) * 12543.113) % 1);
      const tree = createTree(foliageColors[(i + Math.floor(ringOffset)) % foliageColors.length]);
      tree.position.set(p.x + (jitter - 0.5) * jitterRange, 0, p.y + (jitter2 - 0.5) * jitterRange);
      tree.scale.setScalar(0.65 + jitter * 0.85);
      scene.add(tree);
    });
  }
  scatterTrees(18, 64, 3, 5);
  scatterTrees(55, 72, 1, 7);
  scatterTrees(90, 64, 1, 8);
  scatterTrees(130, 56, 1, 10);
  scatterTrees(175, 48, 1, 14);
  scatterTrees(225, 40, 1, 18);

  // nuvens no céu — várias camadas de altura/distância
  const cloudLayers = [
    { count: 14, radiusMin: 160, radiusRange: 90, heightMin: 45, heightRange: 15 },
    { count: 12, radiusMin: 260, radiusRange: 120, heightMin: 65, heightRange: 25 },
    { count: 10, radiusMin: 380, radiusRange: 140, heightMin: 90, heightRange: 35 },
  ];
  cloudLayers.forEach((layer, layerIndex) => {
    for (let i = 0; i < layer.count; i++) {
      const cloud = createCloud();
      const angle = (i / layer.count) * Math.PI * 2 + layerIndex * 0.3;
      const radius = layer.radiusMin + Math.random() * layer.radiusRange;
      cloud.position.set(
        Math.cos(angle) * radius,
        layer.heightMin + Math.random() * layer.heightRange,
        Math.sin(angle) * radius
      );
      cloud.scale.setScalar(0.8 + Math.random() * 0.9);
      scene.add(cloud);
    }
  });

  // montanhas arredondadas no horizonte — três cadeias em distâncias diferentes, tamanhos bem variados
  const mountainColors = [0x5a6b7a, 0x6b7a88, 0x4d5c6b, 0x62778a, 0x445468, 0x738495];
  const mountainRanges = [
    { count: 28, radiusMin: 280, radiusRange: 50, heightMin: 18, heightRange: 22, widthMin: 20, widthRange: 25 },
    { count: 34, radiusMin: 360, radiusRange: 90, heightMin: 30, heightRange: 45, widthMin: 28, widthRange: 35 },
    { count: 30, radiusMin: 480, radiusRange: 110, heightMin: 45, heightRange: 75, widthMin: 35, widthRange: 45 },
  ];
  mountainRanges.forEach((range, rangeIndex) => {
    for (let i = 0; i < range.count; i++) {
      const angle = (i / range.count) * Math.PI * 2 + rangeIndex * 0.15;
      const radius = range.radiusMin + Math.random() * range.radiusRange;
      const height = range.heightMin + Math.random() * range.heightRange;
      const width = range.widthMin + Math.random() * range.widthRange;
      const mountain = createMountain(height, width, mountainColors[(i + rangeIndex) % mountainColors.length]);
      mountain.position.set(Math.cos(angle) * radius, -3, Math.sin(angle) * radius);
      scene.add(mountain);
    }
  });

  return {
    startPosition,
    waypoints,
  };
}
