import * as THREE from "three";
import { elevationAt } from "./track";
import { stepCar, MAX_SPEED } from "@shared/physics";
import type { DriveInput } from "@shared/physics";

export function createCarMesh(bodyColor: number = 0xe8e8e8): THREE.Group {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: bodyColor,
    metalness: 0.5,
    roughness: 0.3,
  });

  // chassi principal (baixo, largo e comprido, tipo supercarro)
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.38, 4.4), bodyMaterial);
  body.position.y = 0.36;
  body.castShadow = true;
  group.add(body);

  // capô longo e baixo (frente afunilada)
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.28, 1.7), bodyMaterial);
  hood.position.set(0, 0.44, 1.85);
  hood.rotation.x = -0.12;
  hood.castShadow = true;
  group.add(hood);

  // alargamentos traseiros (dão a silhueta larga de supercarro)
  for (const side of [-1, 1]) {
    const fender = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 1.6), bodyMaterial);
    fender.position.set(side * 1.05, 0.4, -0.9);
    fender.castShadow = true;
    group.add(fender);
  }

  // cabine baixa, mais pra trás
  const cabinMaterial = new THREE.MeshStandardMaterial({
    color: 0x161616,
    metalness: 0.3,
    roughness: 0.5,
  });
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 1.8), cabinMaterial);
  cabin.position.set(0, 0.72, -0.55);
  cabin.castShadow = true;
  group.add(cabin);

  // para-brisa inclinado
  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.45, 0.4, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x88ccee, metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.6 })
  );
  windshield.position.set(0, 0.72, 0.4);
  windshield.rotation.x = -0.55;
  group.add(windshield);

  // aerofólio traseiro
  const spoilerMaterial = new THREE.MeshStandardMaterial({ color: 0x161616, metalness: 0.3, roughness: 0.5 });
  const spoilerWing = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.45), spoilerMaterial);
  spoilerWing.position.set(0, 0.85, -2.2);
  group.add(spoilerWing);
  for (const side of [-0.8, 0.8]) {
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), spoilerMaterial);
    strut.position.set(side, 0.68, -2.2);
    group.add(strut);
  }

  // faróis
  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffee,
    emissive: 0xffffaa,
    emissiveIntensity: 0.8,
  });
  for (const side of [-0.75, 0.75]) {
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.1), headlightMaterial);
    headlight.position.set(side, 0.42, 2.65);
    group.add(headlight);
  }

  // lanternas traseiras
  const taillightMaterial = new THREE.MeshStandardMaterial({
    color: 0xff3333,
    emissive: 0xaa0000,
    emissiveIntensity: 0.7,
  });
  for (const side of [-0.85, 0.85]) {
    const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.14, 0.08), taillightMaterial);
    taillight.position.set(side, 0.42, -2.22);
    group.add(taillight);
  }

  // rodas (pneu + roda) — largas, tipo supercarro
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.8 });
  const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.8, roughness: 0.3 });
  const wheelOffsets: [number, number, number][] = [
    [-1.05, 0.36, 1.35],
    [1.05, 0.36, 1.35],
    [-1.05, 0.36, -1.35],
    [1.05, 0.36, -1.35],
  ];
  for (const [x, y, z] of wheelOffsets) {
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.28, 16), tireMaterial);
    tire.rotation.z = Math.PI / 2;
    tire.position.set(x, y, z);
    tire.castShadow = true;
    group.add(tire);

    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8), rimMaterial);
    rim.rotation.z = Math.PI / 2;
    rim.position.set(x, y, z);
    group.add(rim);
  }

  return group;
}

export class CarController {
  mesh: THREE.Group;
  speed = 0;
  heading = 0;
  /** velocidade lateral de empurrão (bump), independente da velocidade de condução */
  bumpVelocity = new THREE.Vector2(0, 0);

  readonly maxSpeed = MAX_SPEED;

  /**
   * Teto de velocidade deste carro, ou `null` pra usar o da física.
   *
   * Existe pros bots: cada um tem uma velocidade de cruzeiro própria (é o que dá um pelotão em vez
   * de um trem andando junto). Fica no carro, e não na IA, pra que o teto valha dentro do passo de
   * física em vez de ser um ajuste aplicado por fora depois — quem define é o `BotInput`.
   */
  speedCap: number | null = null;

  /** objeto reaproveitado pra não alocar um por carro por frame só pra chamar o `stepCar` */
  private kinematics = { x: 0, z: 0, heading: 0, speed: 0 };

  constructor(mesh: THREE.Group) {
    this.mesh = mesh;
  }

  update(dt: number, input: DriveInput) {
    // a física em si é a MESMA que o servidor roda no multiplayer (@shared/physics) — se as duas
    // divergissem, treinar no solo não ensinaria nada sobre como o carro se comporta online
    const k = this.kinematics;
    k.x = this.mesh.position.x;
    k.z = this.mesh.position.z;
    k.heading = this.heading;
    k.speed = this.speed;

    stepCar(k, input, dt);

    this.heading = k.heading;
    this.speed = k.speed;
    if (this.speedCap !== null && this.speed > this.speedCap) this.speed = this.speedCap;
    // o empurrão de colisão é local do client (o servidor ainda não simula colisão), então entra
    // por fora do passo de física compartilhado
    this.mesh.position.x = k.x + this.bumpVelocity.x * dt;
    this.mesh.position.z = k.z + this.bumpVelocity.y * dt;

    // a fórmula de elevação varia devagar (poucas subidas/descidas por volta), então calcular
    // direto na posição do carro já é preciso — sem tabela de busca por waypoint (que tinha bugs
    // de "pular de trecho" nas curvas mais fechadas)
    this.mesh.position.y = elevationAt(this.mesh.position.x, this.mesh.position.z);
    this.mesh.rotation.y = this.heading;

    // o empurrão de colisão decai rápido, tipo bumper car
    const decayFactor = Math.pow(0.02, dt);
    this.bumpVelocity.multiplyScalar(decayFactor);
  }
}
