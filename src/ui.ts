export interface RacerDisplay {
  label: string;
  color: number;
  isPlayer: boolean;
  lapCount: number;
  score: number;
}

const RETRO_FONT = `'Courier New', Courier, monospace`;

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Painel estilo SNES: fundo escuro, borda branca grossa e "sombra" preta deslocada (sem blur, pixelado). */
function retroPanelStyle(extra = ""): string {
  return `
    background: #14142b;
    border: 3px solid #fff;
    box-shadow: 4px 4px 0 #000;
    font-family: ${RETRO_FONT};
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: #ffe14d;
    padding: 8px 12px;
    ${extra}
  `;
}

function ordinal(n: number): string {
  return `${n}º`;
}

const TACHO_SEGMENTS = 20;

/** Velocímetro estilo LCD vermelho com barra de tacômetro diagonal, tipo painel de corrida SNES. */
export function createSpeedHud(maxSpeedKmh: number) {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: 16px; right: 16px; z-index: 10; pointer-events: none;
    display: flex; flex-direction: column; align-items: flex-end;
  `;

  const tachoWrap = document.createElement("div");
  tachoWrap.style.cssText = `
    display: flex; gap: 2px; transform: skewX(-18deg); margin-bottom: 6px; margin-right: 8px;
  `;
  const segments: HTMLDivElement[] = [];
  for (let i = 0; i < TACHO_SEGMENTS; i++) {
    const hue = 120 - (i / TACHO_SEGMENTS) * 120;
    const seg = document.createElement("div");
    seg.style.cssText = `width: 7px; height: 16px; background: hsl(${hue}, 85%, 50%); opacity: 0.2;`;
    tachoWrap.appendChild(seg);
    segments.push(seg);
  }
  el.appendChild(tachoWrap);

  const panel = document.createElement("div");
  panel.style.cssText = retroPanelStyle(`border-color: #ff3b3b; text-align: right; min-width: 150px;`);
  el.appendChild(panel);

  const value = document.createElement("div");
  value.style.cssText = `
    font-size: 40px; line-height: 1; color: #ff2b2b; letter-spacing: 3px;
    text-shadow: 0 0 8px rgba(255, 40, 40, 0.75);
  `;
  panel.appendChild(value);

  const unit = document.createElement("div");
  unit.style.cssText = "font-size: 12px; color: #ff3b3b; margin-top: 2px;";
  unit.textContent = "KM/H";
  panel.appendChild(unit);

  const timer = document.createElement("div");
  timer.style.cssText = "font-size: 18px; color: #fff; margin-top: 8px; letter-spacing: 1px;";
  panel.appendChild(timer);

  document.body.appendChild(el);

  return {
    update(speedKmh: number, timeText: string) {
      const v = Math.max(0, Math.round(speedKmh));
      value.textContent = String(v).padStart(3, "0");
      timer.textContent = timeText;

      const lit = Math.round((Math.min(v, maxSpeedKmh) / maxSpeedKmh) * TACHO_SEGMENTS);
      segments.forEach((seg, i) => {
        seg.style.opacity = i < lit ? "1" : "0.2";
      });
    },
  };
}

export function createLapHud() {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; top: 108px; left: 16px;
    pointer-events: none; z-index: 10; font-size: 15px; line-height: 1.7;
    min-width: 150px;
  `);
  document.body.appendChild(el);

  return {
    update(
      lapCount: number,
      totalLaps: number,
      lastMs: number | null,
      bestMs: number | null,
      formatTime: (ms: number) => string
    ) {
      el.innerHTML = `
        <div style="color:#fff;">VOLTA <span style="color:#ff3b3b;">${Math.min(
          lapCount + 1,
          totalLaps
        )}</span>/${totalLaps}</div>
        <div style="color:#8ecbff;">ÚLTIMA ${lastMs !== null ? formatTime(lastMs) : "--'--\"--"}</div>
        <div style="color:#8effa0;">MELHOR ${bestMs !== null ? formatTime(bestMs) : "--'--\"--"}</div>
      `;
    },
  };
}

/** Minimapa da pista (contorno visto de cima) com um ponto móvel por carro, tipo painel SNES. */
export function createMinimap(waypoints: { x: number; z: number }[]) {
  const width = 116;
  const height = 80;
  const pad = 10;

  const xs = waypoints.map((w) => w.x);
  const zs = waypoints.map((w) => w.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  function project(x: number, z: number): [number, number] {
    const px = pad + ((x - minX) / (maxX - minX)) * (width - 2 * pad);
    const py = pad + ((z - minZ) / (maxZ - minZ)) * (height - 2 * pad);
    return [px, py];
  }

  const pathD =
    waypoints
      .map((w, i) => {
        const [px, py] = project(w.x, w.z);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ") + " Z";

  const container = document.createElement("div");
  container.style.cssText = retroPanelStyle(`
    position: fixed; top: 16px; left: 16px; z-index: 10; pointer-events: none; padding: 6px;
  `);

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.style.display = "block";

  const bg = document.createElementNS(svgNS, "rect");
  bg.setAttribute("width", String(width));
  bg.setAttribute("height", String(height));
  bg.setAttribute("fill", "#0b0b1a");
  svg.appendChild(bg);

  const path = document.createElementNS(svgNS, "path");
  path.setAttribute("d", pathD);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#fff");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  const dotsGroup = document.createElementNS(svgNS, "g");
  svg.appendChild(dotsGroup);

  container.appendChild(svg);
  document.body.appendChild(container);

  const dots = new Map<string, SVGCircleElement>();

  return {
    update(cars: { id: string; x: number; z: number; color: number; isPlayer: boolean }[]) {
      for (const car of cars) {
        let dot = dots.get(car.id);
        if (!dot) {
          dot = document.createElementNS(svgNS, "circle") as SVGCircleElement;
          dot.setAttribute("r", car.isPlayer ? "3.4" : "2.4");
          dot.setAttribute("stroke", "#000");
          dot.setAttribute("stroke-width", "0.6");
          dot.setAttribute("fill", colorToCss(car.color));
          dotsGroup.appendChild(dot);
          dots.set(car.id, dot);
        }
        const [px, py] = project(car.x, car.z);
        dot.setAttribute("cx", px.toFixed(1));
        dot.setAttribute("cy", py.toFixed(1));
      }
    },
  };
}

/** Indicador grande de colocação (tipo "1ST"), canto inferior direito. */
export function createPositionBadge() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; bottom: 20px; right: 20px; z-index: 10; pointer-events: none;
    font-family: ${RETRO_FONT}; font-weight: 700; font-style: italic; font-size: 58px;
    color: #fff; text-shadow: 3px 3px 0 #000, -2px -2px 0 #ff3b3b; letter-spacing: 1px;
  `;
  document.body.appendChild(el);

  return {
    update(position: number) {
      const suffixes = ["ST", "ND", "RD"];
      const suffix = position <= 3 ? suffixes[position - 1] : "TH";
      el.textContent = `${position}${suffix}`;
    },
  };
}

export function createLeaderboardHud() {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; top: 168px; right: 16px;
    pointer-events: none; z-index: 10; font-size: 14px;
    min-width: 170px;
  `);
  document.body.appendChild(el);

  return {
    update(racers: RacerDisplay[]) {
      const sorted = [...racers].sort((a, b) => b.score - a.score);
      el.innerHTML = sorted
        .map((r, i) => {
          const swatch = `<span style="display:inline-block;width:11px;height:11px;background:${colorToCss(
            r.color
          )};margin-right:6px;border:2px solid #fff;vertical-align:middle;"></span>`;
          const rowColor = r.isPlayer ? "#fff" : "#ffe14d";
          const bg = r.isPlayer ? "background:#3a1f1f;" : "";
          return `<div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;color:${rowColor};${bg}padding:2px 4px;">${swatch}<span>${r.label}</span><span style="color:#ff3b3b;min-width:26px;">${ordinal(
            i + 1
          )}</span></div>`;
        })
        .join("");
    },
  };
}

export function createLapBanner() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; top: 38%; left: 50%; transform: translate(-50%, -50%);
    z-index: 15; opacity: 0; transition: opacity 0.4s ease; pointer-events: none;
  `;

  const inner = document.createElement("div");
  inner.style.cssText = `
    background: #d4342c; color: #fff; border: 4px solid #fff; box-shadow: 6px 6px 0 #000;
    font-family: ${RETRO_FONT}; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    font-size: 42px; padding: 10px 28px;
  `;
  el.appendChild(inner);
  document.body.appendChild(el);

  let hideTimeout: number | undefined;

  return {
    show(text: string) {
      inner.textContent = text;
      el.style.opacity = "1";
      window.clearTimeout(hideTimeout);
      hideTimeout = window.setTimeout(() => {
        el.style.opacity = "0";
      }, 1800);
    },
  };
}

export function createCountdownOverlay() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    z-index: 25; pointer-events: none;
  `;

  const box = document.createElement("div");
  box.style.cssText = `
    border: 6px solid #fff; box-shadow: 8px 8px 0 #000;
    padding: 16px 48px; transition: background 0.15s ease;
  `;
  el.appendChild(box);

  const text = document.createElement("div");
  text.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 130px; font-weight: 700; color: #fff;
    letter-spacing: 4px;
  `;
  box.appendChild(text);
  document.body.appendChild(el);

  return {
    start(onDone: () => void) {
      const sequence = [
        { text: "3", bg: "#d4342c" },
        { text: "2", bg: "#d4342c" },
        { text: "1", bg: "#e0a500" },
        { text: "VAI!", bg: "#1f8f3d" },
      ];
      let i = 0;

      function step() {
        if (i >= sequence.length) {
          el.style.display = "none";
          onDone();
          return;
        }
        text.textContent = sequence[i].text;
        box.style.background = sequence[i].bg;
        i++;
        window.setTimeout(step, 1000);
      }

      step();
    },
  };
}

export function createVictoryOverlay(onRestart: () => void) {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: rgba(0, 0, 0, 0.78);
    display: none; flex-direction: column; align-items: center; justify-content: center;
    z-index: 20; font-family: ${RETRO_FONT}; color: #fff; text-align: center;
  `;

  const checkerBar = document.createElement("div");
  checkerBar.style.cssText = `
    width: 320px; height: 22px; margin-bottom: 20px;
    background-image: repeating-conic-gradient(#fff 0% 25%, #111 0% 50%);
    background-size: 22px 22px;
    border: 3px solid #fff;
  `;
  el.appendChild(checkerBar);

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 52px; font-weight: 700; margin-bottom: 16px; letter-spacing: 3px;
    text-transform: uppercase; color: #ffe14d;
    text-shadow: 4px 4px 0 #000;
  `;
  title.textContent = "Corrida Finalizada!";
  el.appendChild(title);

  const winnerLine = document.createElement("div");
  winnerLine.style.cssText = `
    font-size: 26px; margin-bottom: 32px; text-transform: uppercase; letter-spacing: 2px;
    background: #14142b; border: 3px solid #fff; box-shadow: 4px 4px 0 #000; padding: 10px 24px;
  `;
  el.appendChild(winnerLine);

  const button = document.createElement("button");
  button.textContent = "Reiniciar";
  button.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 22px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px 36px;
    background: #d4342c; color: #fff; border: 3px solid #fff;
    box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = "#e0453c";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "#d4342c";
  });
  button.addEventListener("click", onRestart);
  el.appendChild(button);

  document.body.appendChild(el);

  return {
    show(winnerLabel: string, winnerColor: number) {
      const swatch = `<span style="display:inline-block;width:18px;height:18px;background:${colorToCss(
        winnerColor
      )};margin-right:10px;border:2px solid #fff;vertical-align:middle;"></span>`;
      winnerLine.innerHTML = `${swatch}${winnerLabel} Venceu!`;
      el.style.display = "flex";
    },
  };
}

const PLAYER_NAME_STORAGE_KEY = "topGearTest.playerName";
const DEFAULT_PLAYER_NAME = "JOGADOR";

export interface MobileControlState {
  throttle: boolean;
  brake: boolean;
  steer: number;
}

export function createNameEntryScreen(onStart: (name: string) => void) {
  const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: #0b0b1a;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  // faixa quadriculada, tipo largada
  const checkerBar = document.createElement("div");
  checkerBar.style.cssText = `
    width: 340px; height: 20px; margin-bottom: 24px;
    background-image: repeating-conic-gradient(#fff 0% 25%, #111 0% 50%);
    background-size: 20px 20px;
    border: 3px solid #fff;
  `;
  el.appendChild(checkerBar);

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 54px; font-weight: 700; letter-spacing: 4px; text-transform: uppercase;
    color: #ff3b3b; text-shadow: 4px 4px 0 #000, 8px 8px 0 #ffe14d;
    margin-bottom: 8px;
  `;
  title.textContent = "TOP GEAR";
  el.appendChild(title);

  const subtitle = document.createElement("div");
  subtitle.style.cssText = `
    font-size: 16px; letter-spacing: 2px; text-transform: uppercase; color: #8ecbff;
    margin-bottom: 40px;
  `;
  subtitle.textContent = "TEST DRIVE";
  el.appendChild(subtitle);

  const label = document.createElement("div");
  label.style.cssText = `
    font-size: 18px; letter-spacing: 2px; text-transform: uppercase; color: #ffe14d;
    margin-bottom: 14px;
  `;
  label.textContent = "Digite seu nome";
  el.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 10;
  input.value = savedName;
  input.placeholder = DEFAULT_PLAYER_NAME;
  input.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 32px; font-weight: 700; letter-spacing: 6px;
    text-transform: uppercase; text-align: center; color: #fff; background: #14142b;
    border: 4px solid #fff; box-shadow: 5px 5px 0 #000; padding: 10px 16px; width: 280px;
    margin-bottom: 28px; caret-color: #ff3b3b;
  `;
  input.style.setProperty("user-select", "text");
  input.style.setProperty("-webkit-user-select", "text");
  input.style.setProperty("-moz-user-select", "text");
  input.style.setProperty("-ms-user-select", "text");
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  });
  el.appendChild(input);

  const button = document.createElement("button");
  button.textContent = "Iniciar";
  button.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 24px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px 48px;
    background: #1f8f3d; color: #fff; border: 3px solid #fff;
    box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = "#279a49";
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = "#1f8f3d";
  });

  function submit() {
    const name = input.value.trim().slice(0, 10) || DEFAULT_PLAYER_NAME;
    localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name);
    el.style.display = "none";
    onStart(name);
  }

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  el.appendChild(button);
  document.body.appendChild(el);

  window.setTimeout(() => input.focus(), 0);
}

export function createMobileControls(onChange: (state: MobileControlState) => void) {
  const state: MobileControlState = { throttle: false, brake: false, steer: 0 };

  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; inset: 0; z-index: 22; pointer-events: none;
  `;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: absolute; inset: 0; display: flex; justify-content: space-between;
    align-items: flex-end; gap: 12px; padding: 12px; box-sizing: border-box;
    pointer-events: auto;
  `;
  container.appendChild(wrapper);

  const steeringCard = document.createElement("div");
  steeringCard.style.cssText = `
    width: min(34vw, 210px); min-width: 180px; height: min(34vw, 210px);
    background: rgba(11, 16, 30, 0.82); backdrop-filter: blur(12px);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 32px;
    box-shadow: 0 22px 44px rgba(0,0,0,0.35);
    position: relative; overflow: hidden; touch-action: none;
    display: flex; align-items: center; justify-content: center;
  `;

  const steeringPad = document.createElement("div");
  steeringPad.style.cssText = `
    width: 88%; height: 88%; border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, rgba(255,255,255,0.18), transparent 34%),
      radial-gradient(circle at 50% 50%, rgba(255,255,255,0.06), transparent 62%),
      linear-gradient(180deg, rgba(15, 24, 45, 0.94), rgba(10, 14, 24, 0.96));
    border: 2px solid rgba(255,255,255,0.2);
    position: relative; display: flex; align-items: center; justify-content: center;
  `;
  steeringCard.appendChild(steeringPad);

  const ring = document.createElement("div");
  ring.style.cssText = `
    position: absolute; inset: 12px; border: 1px dashed rgba(255,255,255,0.14);
    border-radius: 50%; pointer-events: none;
  `;
  steeringPad.appendChild(ring);

  const steerIndicator = document.createElement("div");
  steerIndicator.style.cssText = `
    position: absolute; width: 16px; height: 16px; background: #ffd86a;
    border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 10px rgba(255,216,106,0.08);
    left: 50%; top: 50%; transform: translate(-50%, -50%);
    transition: left 0.08s ease-out;
  `;
  steeringPad.appendChild(steerIndicator);

  const steeringHint = document.createElement("div");
  steeringHint.textContent = "DIRIJA";
  steeringHint.style.cssText = `
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    color: rgba(255,255,255,0.82); font-size: 11.5px; letter-spacing: 1px;
    text-transform: uppercase; pointer-events: none;
  `;
  steeringPad.appendChild(steeringHint);

  let steeringActive = false;

  function commitState(newState: Partial<MobileControlState>) {
    Object.assign(state, newState);
    onChange(state);
  }

  function updateSteerFromEvent(event: PointerEvent) {
    const rect = steeringPad.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const steer = Math.max(-1, Math.min(1, x / (rect.width * 0.42)));
    steerIndicator.style.left = `${50 + steer * 36}%`;
    commitState({ steer });
  }

  steeringPad.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    steeringPad.setPointerCapture(event.pointerId);
    steeringActive = true;
    updateSteerFromEvent(event);
  });

  steeringPad.addEventListener("pointermove", (event) => {
    if (!steeringActive) return;
    event.preventDefault();
    updateSteerFromEvent(event);
  });

  const resetSteer = () => {
    steeringActive = false;
    steerIndicator.style.left = "50%";
    commitState({ steer: 0 });
  };

  steeringPad.addEventListener("pointerup", resetSteer);
  steeringPad.addEventListener("pointercancel", resetSteer);
  steeringPad.addEventListener("pointerleave", resetSteer);

  const rightPanel = document.createElement("div");
  rightPanel.style.cssText = `
    display: flex; gap: 10px; align-items: center; justify-content: flex-end;
    width: min(34vw, 190px); min-width: 160px;
  `;

  function createActionButton(icon: string, color: string, accent: string) {
    const button = document.createElement("div");
    button.textContent = icon;
    button.style.cssText = `
      width: 76px; height: 76px; display: inline-flex; align-items: center;
      justify-content: center; background: linear-gradient(180deg, ${accent} 0%, ${color} 100%);
      color: #fff; border: 1px solid rgba(255,255,255,0.22); border-radius: 50%;
      font-family: ${RETRO_FONT}; font-size: 32px; font-weight: 800;
      box-shadow: 0 16px 28px rgba(0,0,0,0.24); user-select: none;
      touch-action: none; transition: transform 0.15s ease, box-shadow 0.15s ease;
    `;
    button.addEventListener("pointerdown", () => {
      button.style.transform = "translateY(1px) scale(0.98)";
      button.style.boxShadow = "0 8px 16px rgba(0,0,0,0.2)";
    });
    button.addEventListener("pointerup", () => {
      button.style.transform = "translateY(0) scale(1)";
      button.style.boxShadow = "0 16px 28px rgba(0,0,0,0.24)";
    });
    button.addEventListener("pointercancel", () => {
      button.style.transform = "translateY(0) scale(1)";
      button.style.boxShadow = "0 16px 28px rgba(0,0,0,0.24)";
    });
    return button;
  }

  const throttleButton = createActionButton("▲", "#27b84b", "#5ae186");
  const brakeButton = createActionButton("▼", "#e24444", "#ff6f6f");

  function bindToggle(button: HTMLDivElement, key: keyof MobileControlState) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      commitState({ [key]: true } as Partial<MobileControlState>);
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      commitState({ [key]: false } as Partial<MobileControlState>);
      button.style.transform = "translateY(0) scale(1)";
      button.style.boxShadow = "0 14px 26px rgba(0,0,0,0.22)";
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }

  bindToggle(throttleButton, "throttle");
  bindToggle(brakeButton, "brake");

  rightPanel.appendChild(throttleButton);
  rightPanel.appendChild(brakeButton);
  wrapper.appendChild(steeringCard);
  wrapper.appendChild(rightPanel);
  document.body.appendChild(container);
  return { destroy: () => container.remove() };
}
