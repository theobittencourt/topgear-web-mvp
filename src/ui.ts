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

export function createSpeedHud() {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; bottom: 20px; left: 20px;
    pointer-events: none; z-index: 10; text-align: center;
    border-color: #ff3b3b;
  `);

  const value = document.createElement("div");
  value.style.cssText = "font-size: 42px; line-height: 1; color: #fff;";
  el.appendChild(value);

  const label = document.createElement("div");
  label.style.cssText = "font-size: 13px; color: #ff3b3b; margin-top: 2px;";
  label.textContent = "KM/H";
  el.appendChild(label);

  document.body.appendChild(el);

  return {
    update(speedKmh: number) {
      value.textContent = String(Math.max(0, Math.round(speedKmh))).padStart(3, "0");
    },
  };
}

export function createLapHud() {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; top: 16px; left: 16px;
    pointer-events: none; z-index: 10; font-size: 15px; line-height: 1.7;
    min-width: 150px;
  `);
  document.body.appendChild(el);

  return {
    update(
      lapCount: number,
      totalLaps: number,
      elapsedMs: number,
      lastMs: number | null,
      bestMs: number | null,
      formatTime: (ms: number) => string
    ) {
      el.innerHTML = `
        <div style="color:#fff;">VOLTA <span style="color:#ff3b3b;">${Math.min(
          lapCount + 1,
          totalLaps
        )}</span>/${totalLaps}</div>
        <div>TEMPO ${formatTime(elapsedMs)}</div>
        <div style="color:#8ecbff;">ÚLTIMA ${lastMs !== null ? formatTime(lastMs) : "--:--"}</div>
        <div style="color:#8effa0;">MELHOR ${bestMs !== null ? formatTime(bestMs) : "--:--"}</div>
      `;
    },
  };
}

export function createLeaderboardHud() {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; top: 16px; right: 16px;
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
