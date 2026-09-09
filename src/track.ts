import * as THREE from "three";
import { mapShape, stadiumPoints, buildTrackPath, ROAD_WIDTH } from "@shared/trackGeometry";
import type { Point2 } from "@shared/trackGeometry";

export { ROAD_WIDTH };

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

/**
 * Quantos passos as bordas da pista são amostradas. A linha CENTRAL mora no shared (o servidor
 * também precisa dela, e o waypoint nº N tem que significar o mesmo lugar nos dois lados); estas
 * aqui são só pra desenhar a malha, então ficam do lado do client mesmo.
 */
const EDGE_DIVISIONS = 120;

/**
 * À noite, uma PointLight por poste custava caro demais: cada luz entra no shader de TODO material
 * da cena, e eram ~20 delas. Os postes continuam todos acesos visualmente (o bulbo é material
 * emissivo, que sai de graça); só 1 a cada N vira fonte de luz de verdade, mais forte e mais larga
 * pra compensar. Aumente esse número se quiser ainda mais FPS no celular.
 */
const NIGHT_LAMP_LIGHT_EVERY = 3;
const TUNNEL_LIGHT_EVERY = 2;

/**
 * Configuração VISUAL de um mapa. A forma da pista em si (tamanho, raio das curvas, largura) mora
 * em `@shared/trackGeometry`, indexada por este mesmo `id` — porque o servidor precisa dela igual
 * pra simular os bots, e antes era copiada à mão nos dois lados.
 */
export interface TrackConfig {
  id: string;
  name: string;
  hasTunnel: boolean;
  night: boolean;
  roadColor: number;
  foliageColors: number[];
  billboards: boolean;
}

export const TRACK_PRESETS: TrackConfig[] = [
  {
    id: "estadio",
    name: "Estádio Clássico",
    hasTunnel: true,
    night: false,
    roadColor: 0x2d4a44,
    foliageColors: [0x2f7a3d, 0x357a42, 0x2a6b36, 0x3d8a4a, 0x276b38, 0x4a9456],
    billboards: false,
  },
  {
    id: "litoral",
    name: "Circuito Litoral",
    hasTunnel: false,
    night: false,
    roadColor: 0x3a4a4a,
    foliageColors: [0x3d8a4a, 0x4a9456, 0x357a42],
    billboards: true,
  },
  {
    id: "noturno",
    name: "Circuito Noturno",
    hasTunnel: true,
    night: true,
    roadColor: 0x232f30,
    foliageColors: [0x1e4a28, 0x224f2c, 0x1a3f22],
    billboards: true,
  },
];

/**
 * Acha o waypoint (ponto do centro da pista) mais próximo de (x,z). Usado tanto pra saber a
 * altura correta do carro quanto pra detectar se o carro saiu da pista.
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

// ---------------------------------------------------------------------------------------------
// Instancing do cenário
//
// Antes cada árvore/montanha/nuvem era um Group com meshes e MATERIAIS próprios: ~300 árvores x 3
// meshes, 92 montanhas e ~180 esferas de nuvem davam mais de 1.200 draw calls e ~700 materiais
// distintos por frame — de longe o maior gargalo no celular. Agora cada tipo vira UM InstancedMesh
// (com cor por instância onde ela varia), o que derruba isso pra menos de uma dúzia.
// ---------------------------------------------------------------------------------------------

const UP = new THREE.Vector3(0, 1, 0);
const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();

interface Instance {
  x: number;
  y: number;
  z: number;
  scaleX?: number;
  scaleY?: number;
  scaleZ?: number;
  rotationY?: number;
  color?: number;
}

function addInstances(
  scene: THREE.Scene,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: Instance[],
  options: { castShadow?: boolean; receiveShadow?: boolean } = {}
) {
  if (instances.length === 0) return;

  const mesh = new THREE.InstancedMesh(geometry, material, instances.length);
  let usesColor = false;

  instances.forEach((it, i) => {
    scratchPosition.set(it.x, it.y, it.z);
    scratchQuaternion.setFromAxisAngle(UP, it.rotationY ?? 0);
    scratchScale.set(it.scaleX ?? 1, it.scaleY ?? 1, it.scaleZ ?? 1);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
    mesh.setMatrixAt(i, scratchMatrix);
    if (it.color !== undefined) {
      usesColor = true;
      mesh.setColorAt(i, scratchColor.setHex(it.color));
    }
  });

  mesh.instanceMatrix.needsUpdate = true;
  if (usesColor && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = options.castShadow ?? false;
  mesh.receiveShadow = options.receiveShadow ?? false;
  scene.add(mesh);
}

/**
 * Calcula UMA elevação por índice (ponto médio entre a borda externa e interna), pra usar nos
 * dois lados da fita — se cada borda calculasse a sua separadamente, a pista ficava torta ao longo
 * da largura e o carro (que usa a fórmula direto na própria posição) não batia com a malha.
 */
function buildElevationProfile(outerPts: Point2[], innerPts: Point2[]): number[] {
  const n = Math.min(outerPts.length, innerPts.length);
  const profile: number[] = [];
  for (let i = 0; i < n; i++) {
    const midX = (outerPts[i].x + innerPts[i].x) / 2;
    const midZ = (outerPts[i].z + innerPts[i].z) / 2;
    profile.push(elevationAt(midX, midZ));
  }
  return profile;
}

/**
 * Constrói uma "fita" de triângulos entre dois contornos, usando uma elevação compartilhada por
 * índice (ver `buildElevationProfile`). Uma ShapeGeometry comum não teria vértices suficientes ao
 * longo das retas pra elevação ficar suave.
 */
function buildRibbon(
  outerPts: Point2[],
  innerPts: Point2[],
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
      [o0.x, e0, o0.z],
      [o1.x, e1, o1.z],
      [i1.x, e1, i1.z],
      [o0.x, e0, o0.z],
      [i1.x, e1, i1.z],
      [i0.x, e0, i0.z],
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
  pts: Point2[],
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
      [p0.x, top0, p0.z],
      [p1.x, top1, p1.z],
      [p1.x, groundY, p1.z],
      [p0.x, top0, p0.z],
      [p1.x, groundY, p1.z],
      [p0.x, groundY, p0.z],
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
 * Parede vertical que acompanha a elevação da pista tanto na base quanto no topo (diferente da
 * "saia", que vai até um nível de chão constante). Usada pras paredes do túnel.
 */
function buildWall(
  pts: Point2[],
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
      [p0.x, base0, p0.z],
      [p1.x, base1, p1.z],
      [p1.x, top1, p1.z],
      [p0.x, base0, p0.z],
      [p1.x, top1, p1.z],
      [p0.x, top0, p0.z],
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

function buildStripedRing(
  outerPts: Point2[],
  innerPts: Point2[],
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
      [o0.x, e0, o0.z],
      [o1.x, e1, o1.z],
      [i1.x, e1, i1.z],
      [o0.x, e0, o0.z],
      [i1.x, e1, i1.z],
      [i0.x, e0, i0.z],
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

/** Textura de painel de patrocínio com o texto (placeholder — depois dá pra trocar por logo real). */
function createBillboardTexture(text: string): THREE.Texture {
  const width = 512;
  const height = 200;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const bgColors = ["#d4342c", "#1f5fb8", "#1f8f3d", "#e0a500", "#8a2be2"];
  const bg = bgColors[Math.abs(text.length * 7) % bgColors.length];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 56px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, width / 2, height / 2);

  return new THREE.CanvasTexture(canvas);
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

export function createTrack(scene: THREE.Scene, config: TrackConfig = TRACK_PRESETS[0]) {
  const shape = mapShape(config.id);
  const outerW = shape.outerW;
  const outerH = shape.outerH;
  const roadWidth = shape.roadWidth;
  const cornerRadius = shape.cornerRadius;

  // grama (mais escura no modo noturno)
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(700, 700),
    new THREE.MeshStandardMaterial({ color: config.night ? 0x11241a : 0x2d6a2f })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const innerW = outerW - roadWidth * 2;
  const innerH = outerH - roadWidth * 2;
  const innerR = Math.max(cornerRadius - roadWidth, 1);

  // traçado central, largada e grid vêm do módulo compartilhado — o MESMO que o servidor usa pra
  // simular os bots e contar as voltas no multiplayer
  const path = buildTrackPath(config.id);
  const waypoints = path.waypoints.map((p) => new THREE.Vector3(p.x, elevationAt(p.x, p.z), p.z));

  // pontos em alta resolução das bordas da pista (usados pro asfalto E pro meio-fio,
  // garantindo elevação suave e encaixe perfeito entre eles)
  const outerEdgePts = stadiumPoints(outerW, outerH, cornerRadius, EDGE_DIVISIONS);
  const innerEdgePts = stadiumPoints(innerW, innerH, innerR, EDGE_DIVISIONS);
  const elevation = buildElevationProfile(outerEdgePts, innerEdgePts);

  // asfalto verde-petróleo, tipo o Top Gear do SNES (não é cinza puro)
  const roadMaterial = new THREE.MeshStandardMaterial({
    color: config.roadColor,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  scene.add(buildRibbon(outerEdgePts, innerEdgePts, elevation, 0, roadMaterial));

  // meio-fio em zebra (vermelho/branco), borda externa e interna
  const outerCurbPts = stadiumPoints(outerW + 3, outerH + 3, cornerRadius + 1.5, EDGE_DIVISIONS);
  scene.add(buildStripedRing(outerCurbPts, outerEdgePts, elevation, 0.01, 3));

  const innerCurbPts = stadiumPoints(
    Math.max(innerW - 3, 1),
    Math.max(innerH - 3, 1),
    Math.max(innerR - 1.5, 0.5),
    EDGE_DIVISIONS
  );
  scene.add(buildStripedRing(innerEdgePts, innerCurbPts, elevation, 0.01, 3));

  // calçada de concreto entre o meio-fio e a grama, tipo circuito urbano retrô
  const sidewalkMaterial = new THREE.MeshStandardMaterial({
    color: 0xb9b6a8,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const outerSidewalkPts = stadiumPoints(outerW + 12, outerH + 12, cornerRadius + 6, EDGE_DIVISIONS);
  scene.add(buildRibbon(outerSidewalkPts, outerCurbPts, elevation, 0.005, sidewalkMaterial));

  const innerSidewalkPts = stadiumPoints(
    Math.max(innerW - 12, 1),
    Math.max(innerH - 12, 1),
    Math.max(innerR - 6, 0.5),
    EDGE_DIVISIONS
  );
  scene.add(buildRibbon(innerCurbPts, innerSidewalkPts, elevation, 0.005, sidewalkMaterial));

  // "saias" fechando o vão entre a pista elevada e a grama (evita buracos/flutuação visual)
  const skirtMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b6459,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  scene.add(buildSkirt(outerSidewalkPts, elevation, 0.005, -0.01, skirtMaterial));
  scene.add(buildSkirt(innerSidewalkPts, elevation, 0.005, -0.01, skirtMaterial));

  // postes de luz ao longo da calçada externa, tipo circuito urbano retrô
  const lampPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.8 });
  const lampHeadMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff2b0,
    emissive: 0xffdd66,
    emissiveIntensity: config.night ? 6 : 1,
  });
  const lampPoles: Instance[] = [];
  const lampHeads: Instance[] = [];
  let lampIndex = 0;
  for (let i = 0; i < outerSidewalkPts.length; i += 8) {
    const p = outerSidewalkPts[i];
    const baseY = elevation[i];
    lampPoles.push({ x: p.x, y: baseY + 2.5, z: p.z });
    lampHeads.push({ x: p.x, y: baseY + 5.1, z: p.z });

    if (config.night && lampIndex % NIGHT_LAMP_LIGHT_EVERY === 0) {
      // menos luzes, porém mais fortes e mais largas — ver NIGHT_LAMP_LIGHT_EVERY
      const lampLight = new THREE.PointLight(0xffdd88, 260, 75, 1);
      lampLight.position.set(p.x, baseY + 5.1, p.z);
      scene.add(lampLight);
    }
    lampIndex++;
  }
  addInstances(scene, new THREE.CylinderGeometry(0.15, 0.18, 5, 6), lampPoleMaterial, lampPoles, {
    castShadow: true,
  });
  addInstances(scene, new THREE.SphereGeometry(0.4, 8, 6), lampHeadMaterial, lampHeads);

  // túnel bem comprido na reta de cima (oposta à largada) — acha o trecho reto onde z é máximo
  const topStraightZ = outerH / 2;
  let tunnelStartIdx = -1;
  let tunnelEndIdx = -1;
  for (let i = 0; i < outerEdgePts.length; i++) {
    if (Math.abs(outerEdgePts[i].z - topStraightZ) < 0.5) {
      if (tunnelStartIdx === -1) tunnelStartIdx = i;
      tunnelEndIdx = i;
    }
  }
  const TUNNEL_MARGIN = 3;
  const tunnelA = tunnelStartIdx + TUNNEL_MARGIN;
  const tunnelB = tunnelEndIdx - TUNNEL_MARGIN;

  if (config.hasTunnel && tunnelStartIdx !== -1 && tunnelB > tunnelA) {
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
    scene.add(
      buildRibbon(tunnelOuterPts, tunnelInnerPts, tunnelElevation, TUNNEL_HEIGHT, tunnelRoofMaterial)
    );

    // luminárias de teto — o túnel é fechado, fica escuro demais sem fonte de luz própria. As
    // caixinhas emissivas ficam todas, mas só 1 a cada TUNNEL_LIGHT_EVERY vira PointLight de fato.
    const tunnelLightMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff2b0,
      emissive: 0xffdd66,
      emissiveIntensity: config.night ? 5 : 2.5,
    });
    const tunnelLightBoxes: Instance[] = [];
    let tunnelLightIndex = 0;
    for (let i = tunnelA + 2; i < tunnelB - 2; i += 4) {
      const outerPt = outerEdgePts[i];
      const innerPt = innerEdgePts[i];
      const nextOuter = outerEdgePts[i + 1];
      const cx = (outerPt.x + innerPt.x) / 2;
      const cz = (outerPt.z + innerPt.z) / 2;
      const heading = Math.atan2(nextOuter.x - outerPt.x, nextOuter.z - outerPt.z);
      tunnelLightBoxes.push({
        x: cx,
        y: elevation[i] + TUNNEL_HEIGHT - 0.35,
        z: cz,
        rotationY: heading,
      });

      if (tunnelLightIndex % TUNNEL_LIGHT_EVERY === 0) {
        const tunnelPointLight = new THREE.PointLight(0xffdd88, config.night ? 170 : 90, 55, 1.3);
        tunnelPointLight.position.set(cx, elevation[i] + TUNNEL_HEIGHT - 1, cz);
        scene.add(tunnelPointLight);
      }
      tunnelLightIndex++;
    }
    addInstances(
      scene,
      new THREE.BoxGeometry(roadWidth * 0.5, 0.15, 1.4),
      tunnelLightMaterial,
      tunnelLightBoxes
    );

    // portais de concreto nas duas pontas do túnel
    const portalMaterial = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 1 });
    const placePortal = (index: number) => {
      const outerPt = outerEdgePts[index];
      const innerPt = innerEdgePts[index];
      const nextOuter = outerEdgePts[Math.min(index + 1, outerEdgePts.length - 1)];
      const cx = (outerPt.x + innerPt.x) / 2;
      const cz = (outerPt.z + innerPt.z) / 2;
      const heading = Math.atan2(nextOuter.x - outerPt.x, nextOuter.z - outerPt.z);
      const portal = createTunnelPortal(roadWidth + 3, TUNNEL_HEIGHT, portalMaterial);
      portal.position.set(cx, elevation[index], cz);
      portal.rotation.y = heading;
      scene.add(portal);
    };
    placePortal(tunnelA);
    placePortal(tunnelB);
  }

  // linha central tracejada
  const dashes: Instance[] = [];
  for (let i = 0; i < waypoints.length; i += 4) {
    const from = waypoints[i];
    const to = waypoints[(i + 1) % waypoints.length];
    dashes.push({
      x: from.x,
      y: from.y + 0.015,
      z: from.z,
      rotationY: Math.atan2(to.x - from.x, to.z - from.z),
    });
  }
  addInstances(
    scene,
    new THREE.BoxGeometry(0.35, 0.02, 3),
    new THREE.MeshStandardMaterial({ color: 0xf2f2f2 }),
    dashes
  );

  const startPosition = new THREE.Vector3(
    path.start.x,
    elevationAt(path.start.x, path.start.z),
    path.start.z
  );

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

  // painéis de patrocínio ao redor da pista (opcional por mapa)
  if (config.billboards) {
    const sponsorNames = [
      "TURBO COLA",
      "NOS RACING",
      "ACME PNEUS",
      "VELOX FUEL",
      "APEX TECH",
      "RAIO ENERGY",
      "SKID WEAR",
      "NITRO BANK",
      "GRID SPORT",
      "OCTANO+",
    ];
    // a geometria do painel é a mesma pra todos; só o material muda (cada um tem seu texto)
    const billboardGeometry = new THREE.PlaneGeometry(10, 4);
    const billboardPts = stadiumPoints(outerW + 20, outerH + 20, cornerRadius + 10, 60);
    const posts: Instance[] = [];

    billboardPts.forEach((p, i) => {
      if (i % 3 !== 0) return;
      const texture = createBillboardTexture(sponsorNames[(i / 3) % sponsorNames.length]);
      const billboard = new THREE.Mesh(
        billboardGeometry,
        new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide })
      );

      // aponta o painel pro ponto correspondente da pista (não na direção do percurso) — assim
      // o lado com o texto fica de frente pra quem tá dirigindo, em vez de "de perfil"
      const targetIdx =
        Math.floor((i / billboardPts.length) * outerEdgePts.length) % outerEdgePts.length;
      const trackPoint = outerEdgePts[targetIdx];
      const heading = Math.atan2(trackPoint.x - p.x, trackPoint.z - p.z);
      billboard.position.set(p.x, 5, p.z);
      billboard.rotation.y = heading;
      scene.add(billboard);

      // postes de sustentação — antes eram filhos do painel (herdavam a rotação dele); aqui já
      // entram com a posição no mundo, pra poderem virar instâncias de uma malha só
      for (const side of [-4, 4]) {
        posts.push({
          x: p.x + side * Math.cos(heading),
          y: 3,
          z: p.z - side * Math.sin(heading),
        });
      }
    });

    addInstances(
      scene,
      new THREE.CylinderGeometry(0.2, 0.2, 6, 6),
      new THREE.MeshStandardMaterial({ color: 0x333333 }),
      posts
    );
  }

  // árvores ao redor da pista — vários anéis (perto, médio, longe) pra dar densidade e profundidade.
  // No fim tudo vira 3 InstancedMesh (tronco + duas copas), não ~900 meshes soltos.
  const foliageColors = config.foliageColors;
  const trunks: Instance[] = [];
  const foliageLower: Instance[] = [];
  const foliageUpper: Instance[] = [];

  function scatterTrees(ringOffset: number, pointCount: number, everyN: number, jitterRange: number) {
    const pts = stadiumPoints(
      outerW + ringOffset,
      outerH + ringOffset,
      cornerRadius + ringOffset / 2,
      pointCount
    );
    pts.forEach((p, i) => {
      if (i % everyN !== 0) return;
      const jitter = Math.abs((Math.sin(i * 12.9898 + ringOffset) * 43758.5453) % 1);
      const jitter2 = Math.abs((Math.sin(i * 78.233 + ringOffset) * 12543.113) % 1);
      const x = p.x + (jitter - 0.5) * jitterRange;
      const z = p.z + (jitter2 - 0.5) * jitterRange;
      const s = 0.65 + jitter * 0.85;
      const color = foliageColors[(i + Math.floor(ringOffset)) % foliageColors.length];

      // a escala é uniforme, então a altura local de cada peça só precisa ser multiplicada por ela
      trunks.push({ x, y: 0.8 * s, z, scaleX: s, scaleY: s, scaleZ: s });
      foliageLower.push({ x, y: 2.4 * s, z, scaleX: s, scaleY: s, scaleZ: s, color });
      foliageUpper.push({ x, y: 3.6 * s, z, scaleX: s, scaleY: s, scaleZ: s, color });
    });
  }
  scatterTrees(18, 64, 3, 5);
  scatterTrees(55, 72, 1, 7);
  scatterTrees(90, 64, 1, 8);
  scatterTrees(130, 56, 1, 10);
  scatterTrees(175, 48, 1, 14);
  scatterTrees(225, 40, 1, 18);

  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  // branco de base porque a cor real de cada copa vem por instância (setColorAt multiplica)
  const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff });
  addInstances(scene, new THREE.CylinderGeometry(0.25, 0.3, 1.6, 6), trunkMaterial, trunks, {
    castShadow: true,
  });
  addInstances(scene, new THREE.ConeGeometry(1.6, 2.4, 8), foliageMaterial, foliageLower, {
    castShadow: true,
  });
  addInstances(scene, new THREE.ConeGeometry(1.2, 1.8, 8), foliageMaterial, foliageUpper, {
    castShadow: true,
  });

  // nuvens no céu — várias camadas de altura/distância, todas numa InstancedMesh de esferas
  const cloudLayers = [
    { count: 14, radiusMin: 160, radiusRange: 90, heightMin: 45, heightRange: 15 },
    { count: 12, radiusMin: 260, radiusRange: 120, heightMin: 65, heightRange: 25 },
    { count: 10, radiusMin: 380, radiusRange: 140, heightMin: 90, heightRange: 35 },
  ];
  const cloudPuffs: Instance[] = [];
  cloudLayers.forEach((layer, layerIndex) => {
    for (let i = 0; i < layer.count; i++) {
      const angle = (i / layer.count) * Math.PI * 2 + layerIndex * 0.3;
      const radius = layer.radiusMin + Math.random() * layer.radiusRange;
      const cx = Math.cos(angle) * radius;
      const cy = layer.heightMin + Math.random() * layer.heightRange;
      const cz = Math.sin(angle) * radius;
      const cloudScale = 0.8 + Math.random() * 0.9;

      const puffCount = 4 + Math.floor(Math.random() * 3);
      for (let p = 0; p < puffCount; p++) {
        const puffRadius = 3 + Math.random() * 2;
        const localX = p * 3.5 - (puffCount * 3.5) / 2;
        const localY = Math.random() * 1.5;
        const localZ = Math.random() * 2;
        cloudPuffs.push({
          x: cx + localX * cloudScale,
          y: cy + localY * cloudScale,
          z: cz + localZ * cloudScale,
          // esfera unitária: o raio do puff entra na escala, junto com o achatamento em Y
          scaleX: puffRadius * cloudScale,
          scaleY: puffRadius * 0.6 * cloudScale,
          scaleZ: puffRadius * cloudScale,
        });
      }
    }
  });
  addInstances(
    scene,
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    cloudPuffs
  );

  // montanhas arredondadas no horizonte — três cadeias em distâncias diferentes. Só a metade de
  // cima de uma esfera (domo), assentada no chão, com a cor vindo por instância.
  const mountainColors = [0x5a6b7a, 0x6b7a88, 0x4d5c6b, 0x62778a, 0x445468, 0x738495];
  const mountainRanges = [
    { count: 28, radiusMin: 280, radiusRange: 50, heightMin: 18, heightRange: 22, widthMin: 20, widthRange: 25 },
    { count: 34, radiusMin: 360, radiusRange: 90, heightMin: 30, heightRange: 45, widthMin: 28, widthRange: 35 },
    { count: 30, radiusMin: 480, radiusRange: 110, heightMin: 45, heightRange: 75, widthMin: 35, widthRange: 45 },
  ];
  const mountains: Instance[] = [];
  mountainRanges.forEach((range, rangeIndex) => {
    for (let i = 0; i < range.count; i++) {
      const angle = (i / range.count) * Math.PI * 2 + rangeIndex * 0.15;
      const radius = range.radiusMin + Math.random() * range.radiusRange;
      const width = range.widthMin + Math.random() * range.widthRange;
      mountains.push({
        x: Math.cos(angle) * radius,
        y: -3,
        z: Math.sin(angle) * radius,
        scaleX: width,
        scaleY: range.heightMin + Math.random() * range.heightRange,
        scaleZ: width,
        color: mountainColors[(i + rangeIndex) % mountainColors.length],
      });
    }
  });
  addInstances(
    scene,
    new THREE.SphereGeometry(1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }),
    mountains
  );

  return {
    startPosition,
    waypoints,
    startIndex: path.startIndex,
    startHeading: path.startHeading,
    /** vaga na grid de largada — mesma fórmula que o servidor usa no multiplayer */
    gridPosition(slot: number): THREE.Vector3 {
      const p = path.gridPosition(slot);
      return new THREE.Vector3(p.x, elevationAt(p.x, p.z), p.z);
    },
    night: config.night,
  };
}
