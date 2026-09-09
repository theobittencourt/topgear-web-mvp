/**
 * Física do carro — fonte única pro client (modo solo) e pro servidor (multiplayer autoritativo).
 *
 * O ponto de existir isso: no multiplayer o servidor simula e o client desenha, então qualquer
 * diferença de constante entre os dois vira "o carro não obedece direito". E no solo o carro tem
 * que dirigir EXATAMENTE igual ao online, senão treinar sozinho não ajuda em nada.
 *
 * Sem dependência de three.js de propósito: é matemática pura, roda igual dos dois lados.
 */

export const MAX_SPEED = 38;
export const MAX_REVERSE_SPEED = -12;
export const ACCELERATION = 18;
export const BRAKE_DECELERATION = 26;
export const FRICTION = 6;
export const TURN_SPEED = 2.2;

/** Estado mínimo pra simular um carro no plano — quem chama guarda isso onde quiser. */
export interface CarKinematics {
  x: number;
  z: number;
  heading: number;
  speed: number;
}

export interface DriveInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1..1 (positivo vira pra esquerda) */
  steer: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Avança um carro por `dt` segundos. Muda o objeto no lugar (in-place) — é chamado por carro, por
 * frame, num jogo, então não vale a pena alocar um objeto novo a cada passo.
 *
 * NÃO cuida de colisão, elevação nem saída de pista: isso é responsabilidade de quem chama, porque
 * client e servidor tratam essas três coisas de formas diferentes hoje.
 */
export function stepCar(car: CarKinematics, input: DriveInput, dt: number): void {
  if (input.throttle > 0) {
    car.speed += ACCELERATION * input.throttle * dt;
  } else if (input.brake > 0) {
    car.speed -= BRAKE_DECELERATION * dt;
  } else {
    const decel = FRICTION * dt;
    if (car.speed > 0) car.speed = Math.max(0, car.speed - decel);
    else if (car.speed < 0) car.speed = Math.min(0, car.speed + decel);
  }

  car.speed = clamp(car.speed, MAX_REVERSE_SPEED, MAX_SPEED);

  // parado o volante não faz nada, e quanto mais devagar menos ele vira (com um piso de 0.3 pra
  // ainda dar pra manobrar em baixa). De ré, o sentido do giro inverte.
  if (Math.abs(car.speed) > 0.1) {
    const speedFactor = car.speed / MAX_SPEED;
    const direction = car.speed >= 0 ? 1 : -1;
    car.heading -= input.steer * TURN_SPEED * dt * direction * Math.min(1, Math.abs(speedFactor) + 0.3);
  }

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;
}

/** Normaliza um ângulo pro intervalo (-PI, PI] — usado pela IA pra achar o menor giro até o alvo. */
export function normalizeAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a > Math.PI) a -= Math.PI * 2;
  if (a < -Math.PI) a += Math.PI * 2;
  return a;
}
