import { CarController } from "./car";

// o carro é bem mais comprido (4.4) do que largo (2.1) — um raio pequeno demais deixava os carros
// "atravessarem" um no outro visualmente (o na frente/atrás) antes da física perceber a colisão.
const CAR_RADIUS = 2.2;
const PUSH_STRENGTH = 30;

export function resolveCarCollisions(cars: CarController[]) {
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = a.mesh.position.x - b.mesh.position.x;
      const dz = a.mesh.position.z - b.mesh.position.z;
      const dist = Math.hypot(dx, dz);
      const minDist = CAR_RADIUS * 2;

      if (dist > 0.0001 && dist < minDist) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;

        // separa as posições pra não ficarem grudadas
        a.mesh.position.x += (nx * overlap) / 2;
        a.mesh.position.z += (nz * overlap) / 2;
        b.mesh.position.x -= (nx * overlap) / 2;
        b.mesh.position.z -= (nz * overlap) / 2;

        // empurrão tipo bumper car — proporcional à sobreposição, não trava a velocidade
        const impulse = overlap * PUSH_STRENGTH;
        a.bumpVelocity.x += nx * impulse;
        a.bumpVelocity.y += nz * impulse;
        b.bumpVelocity.x -= nx * impulse;
        b.bumpVelocity.y -= nz * impulse;
      }
    }
  }
}
