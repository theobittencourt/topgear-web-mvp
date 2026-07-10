import * as THREE from "three";
import { elevationAt, sampleTrackElevation } from "./track";

export function createCarMesh(): THREE.Group {
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xe8e8e8,
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

  readonly maxSpeed = 28;
  readonly maxReverseSpeed = -10;
  readonly acceleration = 14;
  readonly brakeDeceleration = 24;
  readonly friction = 6;
  readonly turnSpeed = 2.2;

  protected waypoints?: THREE.Vector3[];

  constructor(mesh: THREE.Group, waypoints?: THREE.Vector3[]) {
    this.mesh = mesh;
    this.waypoints = waypoints;
  }

  update(dt: number, input: { throttle: number; brake: number; steer: number }) {
    if (input.throttle > 0) {
      this.speed += this.acceleration * input.throttle * dt;
    } else if (input.brake > 0) {
      this.speed -= this.brakeDeceleration * dt;
    } else {
      const decel = this.friction * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - decel);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + decel);
    }

    this.speed = THREE.MathUtils.clamp(this.speed, this.maxReverseSpeed, this.maxSpeed);

    if (Math.abs(this.speed) > 0.1) {
      const speedFactor = this.speed / this.maxSpeed;
      const direction = this.speed >= 0 ? 1 : -1;
      this.heading -= input.steer * this.turnSpeed * dt * direction * Math.min(1, Math.abs(speedFactor) + 0.3);
    }

    this.mesh.position.x += Math.sin(this.heading) * this.speed * dt + this.bumpVelocity.x * dt;
    this.mesh.position.z += Math.cos(this.heading) * this.speed * dt + this.bumpVelocity.y * dt;

    // usa a altura suave da pista (interpolada entre waypoints vizinhos) em vez de recalcular a
    // fórmula de elevação na posição bruta do carro — que diverge da pista quando ele não está
    // exatamente no centro (perto da borda, por exemplo)
    if (this.waypoints) {
      this.mesh.position.y = sampleTrackElevation(this.mesh.position.x, this.mesh.position.z, this.waypoints);
    } else {
      this.mesh.position.y = elevationAt(this.mesh.position.x, this.mesh.position.z);
    }
    this.mesh.rotation.y = this.heading;

    // o empurrão de colisão decai rápido, tipo bumper car
    const decayFactor = Math.pow(0.02, dt);
    this.bumpVelocity.multiplyScalar(decayFactor);
  }
}

function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export class AICarController extends CarController {
  private targetIndex: number;
  readonly cruiseThrottle: number;

  private stuckTimer = 0;
  private reverseTimer = 0;
  private lastReverseSteer = 0;

  constructor(mesh: THREE.Group, waypoints: THREE.Vector3[], startIndex: number, cruiseThrottle = 0.85) {
    super(mesh, waypoints);
    this.waypoints = waypoints;
    this.targetIndex = startIndex;
    this.cruiseThrottle = cruiseThrottle;
  }

  updateAI(dt: number) {
    const target = this.waypoints![this.targetIndex];
    const dx = target.x - this.mesh.position.x;
    const dz = target.z - this.mesh.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 8) {
      this.targetIndex = (this.targetIndex + 1) % this.waypoints!.length;
    }

    const desiredHeading = Math.atan2(dx, dz);
    const angleDiff = normalizeAngle(desiredHeading - this.heading);
    const steer = THREE.MathUtils.clamp(-angleDiff * 2, -1, 1);
    const sharpTurn = Math.abs(angleDiff) > 0.5;

    // se está travado (colidiu com carro/obstáculo e não sai do lugar), engata a ré
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      this.update(dt, { throttle: 0, brake: 1, steer: this.lastReverseSteer });
      return;
    }

    this.update(dt, {
      throttle: sharpTurn ? this.cruiseThrottle * 0.65 : this.cruiseThrottle,
      brake: 0,
      steer,
    });

    const topSpeed = this.maxSpeed * (sharpTurn ? this.cruiseThrottle * 0.65 : this.cruiseThrottle);
    if (this.speed > topSpeed) this.speed = topSpeed;

    if (Math.abs(this.speed) < 2) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.8) {
        this.reverseTimer = 1 + Math.random() * 0.5;
        this.lastReverseSteer = steer >= 0 ? -1 : 1;
        this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }
  }
}
