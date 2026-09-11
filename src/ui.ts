import { getTheme, setTheme } from "./retro";
import { playMenuClick } from "./audio";
import type { VisualTheme } from "./retro";

export interface RacerDisplay {
  label: string;
  color: number;
  isPlayer: boolean;
  lapCount: number;
  score: number;
}

const RETRO_FONT = `'Courier New', Courier, monospace`;

/**
 * Paleta das telas de MENU, tirada da própria logo.
 *
 * Amostrando `assets/logo.png`, ela é basicamente três cores: preto (34% dos pixels), vermelho
 * #f00010 (17%) e branco/prata (17%). Não tem amarelo, verde nem azul em lugar nenhum — que era
 * exatamente o que o menu usava, e por isso destoava da arte.
 *
 * A divisão vermelho/grafite nos botões espelha a própria logo, que escreve "TOP GEAR" em branco e
 * "WEB" em vermelho: a ação principal fica vermelha, a alternativa fica grafite. As duas continuam
 * com fundo escuro e texto branco, então nenhuma perde legibilidade.
 *
 * O HUD de corrida NÃO usa isto de propósito: lá o amarelo sobre a pista existe pra leitura rápida
 * por cima de uma cena 3D em movimento, que é um problema diferente do de um menu em fundo chapado.
 */
const MENU = {
  /** fundo das telas — o preto da logo é neutro, sem o roxo que o fundo antigo tinha */
  fundo: "#0c0c14",
  painel: "#16161f",
  /** o vermelho da logo, levemente rebaixado pra não vibrar atrás de texto branco */
  vermelho: "#d81420",
  vermelhoHover: "#ef2230",
  /** botão alternativo: grafite, o mesmo contraste vermelho-sobre-preto que a logo usa */
  grafite: "#1c1c26",
  grafiteHover: "#2a2a38",
  branco: "#f0f0f0",
  /** prata das letras de "TOP GEAR", pra texto secundário */
  prata: "#d0d0e0",
  apagado: "#7d7d8a",
};

/**
 * Logo do jogo, usada nas telas de menu.
 *
 * O arquivo tem 900px de largura e a gente sempre mostra ela MENOR que isso, então o navegador só
 * reduz — e redução quer filtro suave, que é o padrão. Nada de `image-rendering: pixelated` aqui:
 * ele só ajuda quando a imagem é ampliada; numa redução ele serrilha em vez de suavizar.
 *
 * O `aspect-ratio` fixo evita o layout pular quando a imagem termina de carregar.
 */
/**
 * Uma tela de menu, do ponto de vista de quem monta o fluxo.
 *
 * `destroy()` existe porque navegar pra trás precisa TIRAR a tela do DOM, não só escondê-la: se ela
 * ficasse guardada, ir e voltar várias vezes empilharia telas mortas (e listeners) sem parar.
 */
export interface MenuScreen {
  show(): void;
  hide(): void;
  destroy(): void;
}

/**
 * Dá à tela o controle de mostrar/esconder e, quando ela tem "voltar", faz o Esc valer como o botão.
 *
 * O listener do Esc vai no `window` porque uma `div` não recebe tecla sem foco — e por isso o
 * `destroy()` obrigatoriamente o remove, senão uma tela já destruída continuaria respondendo.
 */
function menuScreenHandle(el: HTMLElement, onBack?: () => void): MenuScreen {
  let aoTeclar: ((e: KeyboardEvent) => void) | null = null;

  if (onBack) {
    aoTeclar = (e: KeyboardEvent) => {
      // só a tela visível reage: várias telas do fluxo coexistem escondidas
      if (e.key === "Escape" && el.style.display !== "none") onBack();
    };
    window.addEventListener("keydown", aoTeclar);
  }

  return {
    show() {
      el.style.display = "flex";
    },
    hide() {
      el.style.display = "none";
    },
    destroy() {
      if (aoTeclar) window.removeEventListener("keydown", aoTeclar);
      el.remove();
    },
  };
}

/** Botão de voltar, discreto e no rodapé da tela. */
function createBackButton(onBack: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  // sem glifo de seta de propósito: em algumas fontes de celular ◀/▲ viram um ícone quebrado — é o
  // mesmo motivo dos triângulos dos controles mobile serem desenhados com borda CSS
  button.textContent = "Voltar";
  button.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 13px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 9px 24px; margin-top: 30px;
    background: ${MENU.grafite}; color: ${MENU.apagado}; border: 3px solid ${MENU.apagado};
    box-shadow: 3px 3px 0 #000; cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.color = "#fff";
    button.style.borderColor = "#fff";
  });
  button.addEventListener("mouseleave", () => {
    button.style.color = MENU.apagado;
    button.style.borderColor = MENU.apagado;
  });
  button.addEventListener("click", onBack);
  return button;
}

/**
 * Liga o som de clique nos botões de uma tela de MENU.
 *
 * O listener é delegado na raiz da tela em vez de um por botão, por dois motivos: as telas criam
 * dezenas de botões, e algumas os recriam (a lista de jogadores do lobby é redesenhada a cada
 * mudança de estado do servidor) — um listener delegado continua valendo pros botões novos sem
 * precisar religar nada.
 *
 * Dispara no `pointerdown`, não no `click`: o som sai no aperto e não na soltura, que é o que dá a
 * sensação de resposta imediata de menu de arcade.
 *
 * Só as telas de menu chamam isso. Durante a corrida o jogo é mudo.
 */
function comSomDeMenu<T extends HTMLElement>(el: T): T {
  el.addEventListener("pointerdown", (evento) => {
    const alvo = evento.target as HTMLElement | null;
    if (alvo && alvo.closest("button")) playMenuClick();
  });
  return el;
}

function createLogo(maxWidthPx: number, marginBottomPx: number): HTMLImageElement {
  const img = document.createElement("img");
  img.src = "/logo.png";
  img.alt = "Top Gear Web";
  img.style.cssText = `
    width: min(${maxWidthPx}px, 80vw);
    height: auto;
    aspect-ratio: 2 / 1;
    display: block;
    margin: 0 auto ${marginBottomPx}px;
    user-select: none; -webkit-user-drag: none;
  `;
  return img;
}

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

// animação usada pelo aviso de reserva do combustível (ver createDashHud)
const dashStyleTag = document.createElement("style");
dashStyleTag.textContent = `
  @keyframes fuelBlink {
    0%, 50% { opacity: 1; }
    50.01%, 100% { opacity: 0.35; }
  }
`;
document.head.appendChild(dashStyleTag);

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

/**
 * Painel de bordo: marcha e nitro embaixo à esquerda, combustível numa barra vertical à direita —
 * o mesmo arranjo do Top Gear.
 *
 * O ponteiro de combustível fica DENTRO da barra em vez de ao lado dela, pra não brigar por espaço
 * com o leaderboard no celular.
 */
export function createDashHud(mobile = false) {
  const escala = mobile ? 0.78 : 1;

  // ---- marcha + nitro, canto inferior esquerdo ----
  const canto = document.createElement("div");
  canto.style.cssText = `
    position: fixed; left: 16px; bottom: 16px; z-index: 10; pointer-events: none;
    display: flex; flex-direction: column; gap: ${6 * escala}px; align-items: flex-start;
  `;

  const nitro = document.createElement("div");
  nitro.style.cssText = retroPanelStyle(`
    font-size: ${16 * escala}px; color: #7ef0ff; letter-spacing: 2px; padding: ${5 * escala}px ${10 * escala}px;
  `);
  canto.appendChild(nitro);

  const marcha = document.createElement("div");
  marcha.style.cssText = retroPanelStyle(`
    font-size: ${18 * escala}px; color: #fff; letter-spacing: 2px; padding: ${5 * escala}px ${10 * escala}px;
  `);
  canto.appendChild(marcha);
  document.body.appendChild(canto);

  // ---- combustível, barra vertical na direita ----
  // Ancorado por BAIXO, e não centralizado na vertical: o leaderboard também mora na direita e
  // desce quase até a metade da tela com 10 carros, então um medidor centralizado ficava escondido
  // atrás dele. Aqui ele ocupa a faixa livre entre o leaderboard e o badge de posição.
  const alturaBarra = (mobile ? 110 : 150) * escala;
  const fuelWrap = document.createElement("div");
  fuelWrap.style.cssText = `
    position: fixed; right: 16px; bottom: ${(mobile ? 104 : 96) * escala}px;
    z-index: 10; pointer-events: none; display: flex; flex-direction: column;
    align-items: center; gap: 3px;
    font-family: ${RETRO_FONT}; font-weight: 700; font-size: ${11 * escala}px; color: #fff;
  `;

  const topoF = document.createElement("div");
  topoF.textContent = "F";
  fuelWrap.appendChild(topoF);

  const trilho = document.createElement("div");
  trilho.style.cssText = `
    width: ${18 * escala}px; height: ${alturaBarra}px; background: #14142b;
    border: 3px solid #fff; box-shadow: 3px 3px 0 #000;
    display: flex; flex-direction: column-reverse; overflow: hidden;
  `;
  fuelWrap.appendChild(trilho);

  // a barra é feita de blocos separados, não de uma barra contínua — é o que dá o look de
  // medidor segmentado de painel 16-bit
  const BLOCOS = 14;
  const blocos: HTMLDivElement[] = [];
  for (let i = 0; i < BLOCOS; i++) {
    const bloco = document.createElement("div");
    bloco.style.cssText = `flex: 1; margin: 1px; background: #2a1010;`;
    trilho.appendChild(bloco);
    blocos.push(bloco);
  }

  const baseE = document.createElement("div");
  baseE.textContent = "E";
  fuelWrap.appendChild(baseE);
  document.body.appendChild(fuelWrap);

  let piscando = false;

  return {
    /**
     * @param gear marcha atual (0 = ré, senão 1..6)
     * @param nitroCharges cargas de nitro sobrando
     * @param nitroActive se o turbo está queimando agora
     * @param fuel 0..1
     */
    update(gear: number, nitroCharges: number, nitroActive: boolean, fuel: number) {
      marcha.textContent = gear === 0 ? "MARCHA R" : `MARCHA ${gear}`;
      marcha.style.color = gear === 0 ? "#ff8c1a" : "#fff";

      nitro.textContent = `N x ${nitroCharges}`;
      if (nitroActive) {
        nitro.style.color = "#fff";
        nitro.style.background = "#0a6b7a";
      } else {
        nitro.style.color = nitroCharges > 0 ? "#7ef0ff" : "#4a5560";
        nitro.style.background = "#14142b";
      }

      const acesos = Math.round(Math.max(0, Math.min(1, fuel)) * BLOCOS);
      // vermelho na reserva, âmbar no meio, verde cheio — leitura instantânea sem precisar de número
      const cor = fuel > 0.5 ? "#3fd15a" : fuel > 0.22 ? "#ffd23f" : "#ff3b3b";
      blocos.forEach((bloco, i) => {
        bloco.style.background = i < acesos ? cor : "#2a1010";
      });

      // na reserva a barra inteira pisca, que é o aviso que o jogo original dá
      const deveriaPiscar = fuel <= 0.15;
      if (deveriaPiscar !== piscando) {
        piscando = deveriaPiscar;
        trilho.style.borderColor = deveriaPiscar ? "#ff3b3b" : "#fff";
        trilho.style.animation = deveriaPiscar ? "fuelBlink 0.6s steps(1) infinite" : "none";
      }
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
export function createPositionBadge(mobile = false) {
  const el = document.createElement("div");
  el.style.cssText = mobile
    ? `
    position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 10;
    pointer-events: none;
    font-family: ${RETRO_FONT}; font-weight: 700; font-style: italic; font-size: 34px;
    color: #fff; text-shadow: 2px 2px 0 #000, -1px -1px 0 #ff3b3b; letter-spacing: 1px;
  `
    : `
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

export function createLeaderboardHud(hidden = false) {
  const el = document.createElement("div");
  el.style.cssText = retroPanelStyle(`
    position: fixed; top: 168px; right: 16px;
    pointer-events: none; z-index: 10; font-size: 14px;
    min-width: 170px;
    ${hidden ? "display: none;" : ""}
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
    font-family: ${RETRO_FONT}; font-weight: 700; letter-spacing: clamp(1px, 0.6vw, 3px);
    text-transform: uppercase; white-space: nowrap;
    font-size: clamp(18px, 5.5vw, 42px); padding: clamp(6px, 1.5vw, 10px) clamp(14px, 4vw, 28px);
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

  let pendingStep: number | undefined;

  return {
    start(onDone: () => void) {
      // o fim da sequência esconde o overlay com display:none — sem restaurar aqui, a segunda
      // corrida numa mesma sala (o "reiniciar" do multiplayer, que NÃO recarrega a página)
      // largava sem countdown nenhum aparecer na tela
      el.style.display = "flex";
      window.clearTimeout(pendingStep);

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
        pendingStep = window.setTimeout(step, 1000);
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
  let clickHandler = onRestart;
  button.addEventListener("click", () => clickHandler());
  el.appendChild(button);

  document.body.appendChild(el);

  return {
    show(
      winnerLabel: string,
      winnerColor: number,
      restart?: { buttonLabel?: string; onRestart?: () => void; disabled?: boolean }
    ) {
      const swatch = `<span style="display:inline-block;width:18px;height:18px;background:${colorToCss(
        winnerColor
      )};margin-right:10px;border:2px solid #fff;vertical-align:middle;"></span>`;
      winnerLine.innerHTML = `${swatch}${winnerLabel} Venceu!`;
      el.style.display = "flex";
      button.textContent = restart?.buttonLabel ?? "Reiniciar";
      button.disabled = !!restart?.disabled;
      button.style.opacity = restart?.disabled ? "0.5" : "1";
      button.style.cursor = restart?.disabled ? "not-allowed" : "pointer";
      clickHandler = restart?.onRestart ?? onRestart;
    },
    hide() {
      el.style.display = "none";
    },
  };
}

const PLAYER_NAME_STORAGE_KEY = "topGearTest.playerName";
const DEFAULT_PLAYER_NAME = "JOGADOR";

export interface MobileControlState {
  throttle: boolean;
  brake: boolean;
  /** pulso: vira true no toque e volta pra false sozinho, igual à tecla do teclado */
  nitro: boolean;
  steer: number;
}

/**
 * Tela de loading estilo SNES — mostrada logo antes de montar a pista (que é um trabalho síncrono
 * pesado: gera todas as árvores, montanhas, nuvens, meio-fio etc. de uma vez, travando a tela por
 * um instante sem feedback nenhum). Chame `show()`, espere o próximo frame renderizar (por isso o
 * `requestAnimationFrame` duplo em quem usa isso), e só então rode o trabalho pesado.
 */
export function createLoadingScreen() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: none; flex-direction: column; align-items: center; justify-content: center;
    z-index: 35; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  el.appendChild(createLogo(340, 20));

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 22px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 24px;
  `;
  title.textContent = "Carregando...";
  el.appendChild(title);

  // barrinha de progresso "falsa" (indeterminada), só animação, estilo carregamento de cartucho
  const barTrack = document.createElement("div");
  barTrack.style.cssText = `
    width: 280px; height: 22px; border: 3px solid #fff; background: ${MENU.painel};
    box-shadow: 4px 4px 0 #000; overflow: hidden; position: relative;
  `;
  const barFill = document.createElement("div");
  barFill.style.cssText = `
    position: absolute; top: 0; bottom: 0; width: 40%; background: ${MENU.vermelho};
    animation: loadingBarMove 1s linear infinite;
  `;
  const styleTag = document.createElement("style");
  styleTag.textContent = `
    @keyframes loadingBarMove {
      0% { left: -40%; }
      100% { left: 100%; }
    }
  `;
  document.head.appendChild(styleTag);
  barTrack.appendChild(barFill);
  el.appendChild(barTrack);

  document.body.appendChild(comSomDeMenu(el));

  return {
    show() {
      el.style.display = "flex";
    },
    hide() {
      el.style.display = "none";
    },
    setText(text: string) {
      title.textContent = text;
    },
  };
}

/** Tela pra escolher entre correr sozinho contra bots ou entrar numa sala online. */
export function createModeSelectScreen(onSelect: (mode: "solo" | "online") => void): MenuScreen {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  el.appendChild(createLogo(420, 8));

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 22px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 28px;
  `;
  title.textContent = "Como Vai Correr?";
  el.appendChild(title);

  const list = document.createElement("div");
  list.style.cssText = "display: flex; flex-direction: column; gap: 16px;";
  el.appendChild(list);

  const options: { mode: "solo" | "online"; label: string; color: string; hover: string }[] = [
    { mode: "solo", label: "Solo (contra bots)", color: MENU.vermelho, hover: MENU.vermelhoHover },
    { mode: "online", label: "Sala Online (amigos)", color: MENU.grafite, hover: MENU.grafiteHover },
  ];

  for (const opt of options) {
    const button = document.createElement("button");
    button.textContent = opt.label;
    button.style.cssText = `
      font-family: ${RETRO_FONT}; font-size: 20px; font-weight: 700; letter-spacing: 2px;
      text-transform: uppercase; padding: 14px 40px;
      background: ${opt.color}; color: #fff; border: 3px solid #fff;
      box-shadow: 4px 4px 0 #000; cursor: pointer;
    `;
    button.addEventListener("mouseenter", () => {
      button.style.background = opt.hover;
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = opt.color;
    });
    button.addEventListener("click", () => {
      el.style.display = "none";
      onSelect(opt.mode);
    });
    list.appendChild(button);
  }

  el.appendChild(createThemePicker());
  document.body.appendChild(comSomDeMenu(el));

  // a tela inicial não tem "voltar": ela É o começo do fluxo. O handle existe pra que as telas
  // seguintes consigam trazê-la de volta.
  return menuScreenHandle(el);
}

/**
 * Escolha do tema visual, na tela inicial.
 *
 * Trocar recarrega a página de propósito: o antialias é decidido na criação do renderer, então não
 * dá pra trocar de verdade sem remontar tudo. Como isso só aparece na primeira tela, recarregar
 * não custa nada — e é bem mais simples (e confiável) do que reconstruir a cena viva.
 */
function createThemePicker(): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.cssText = "margin-top: 40px; display: flex; flex-direction: column; align-items: center; gap: 10px;";

  const label = document.createElement("div");
  label.style.cssText = `
    font-size: 12px; letter-spacing: 2px; color: ${MENU.prata}; text-transform: uppercase;
  `;
  label.textContent = "Visual";
  wrap.appendChild(label);

  const row = document.createElement("div");
  row.style.cssText = "display: flex; gap: 10px;";
  wrap.appendChild(row);

  const opcoes: { theme: VisualTheme; label: string; dica: string }[] = [
    { theme: "retro", label: "Retrô", dica: "Pixel grandão e luz chapada, tipo 16-bit" },
    { theme: "moderno", label: "Moderno", dica: "Resolução cheia, com sombra e antialias" },
  ];

  const dica = document.createElement("div");
  dica.style.cssText = `font-size: 11px; letter-spacing: 1px; color: ${MENU.apagado}; height: 14px;`;

  const botoes: HTMLButtonElement[] = [];
  function pintar() {
    const atual = getTheme();
    opcoes.forEach((opt, i) => {
      const ativo = opt.theme === atual;
      botoes[i].style.background = ativo ? MENU.vermelho : MENU.grafite;
      botoes[i].style.color = ativo ? "#fff" : MENU.apagado;
      if (ativo) dica.textContent = opt.dica;
    });
  }

  for (const opt of opcoes) {
    const button = document.createElement("button");
    button.textContent = opt.label;
    button.style.cssText = `
      font-family: ${RETRO_FONT}; font-size: 13px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; padding: 8px 20px; border: 3px solid #fff;
      box-shadow: 3px 3px 0 #000; cursor: pointer;
    `;
    button.addEventListener("click", () => {
      if (getTheme() === opt.theme) return;
      setTheme(opt.theme);
      // O clique toca no pointerdown, mas o reload matava o áudio antes de sair qualquer som — era
      // por isso que estes dois botões só faziam barulho na segunda vez (o segundo clique cai no
      // `return` acima e não recarrega). Uma espera curta deixa o clique ser ouvido sem que a troca
      // pareça travada.
      window.setTimeout(() => window.location.reload(), 180);
    });
    botoes.push(button);
    row.appendChild(button);
  }

  wrap.appendChild(dica);
  pintar();
  return wrap;
}

/** Depois de escolher "Sala Online": criar uma sala nova (vira host) ou entrar com um código. */
export function createOnlineChoiceScreen(
  onCreate: () => void,
  onJoin: () => void,
  onBack?: () => void
): MenuScreen {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 30px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 32px;
  `;
  title.textContent = "Sala Online";
  el.appendChild(title);

  const list = document.createElement("div");
  list.style.cssText = "display: flex; flex-direction: column; gap: 16px;";
  el.appendChild(list);

  const options: { label: string; color: string; hover: string; onClick: () => void }[] = [
    { label: "Criar Sala", color: MENU.vermelho, hover: MENU.vermelhoHover, onClick: onCreate },
    { label: "Entrar com Código", color: MENU.grafite, hover: MENU.grafiteHover, onClick: onJoin },
  ];

  for (const opt of options) {
    const button = document.createElement("button");
    button.textContent = opt.label;
    button.style.cssText = `
      font-family: ${RETRO_FONT}; font-size: 20px; font-weight: 700; letter-spacing: 2px;
      text-transform: uppercase; padding: 14px 40px;
      background: ${opt.color}; color: #fff; border: 3px solid #fff;
      box-shadow: 4px 4px 0 #000; cursor: pointer;
    `;
    button.addEventListener("mouseenter", () => {
      button.style.background = opt.hover;
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = opt.color;
    });
    button.addEventListener("click", () => {
      el.style.display = "none";
      opt.onClick();
    });
    list.appendChild(button);
  }

  if (onBack) el.appendChild(createBackButton(onBack));
  document.body.appendChild(comSomDeMenu(el));
  return menuScreenHandle(el, onBack);
}

/** Campo pra digitar o código da sala de um amigo. */
export function createCodeEntryScreen(
  onSubmit: (code: string) => void,
  onBack?: () => void
): MenuScreen {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 22px; letter-spacing: 2px; text-transform: uppercase; color: ${MENU.branco};
    margin-bottom: 20px;
  `;
  title.textContent = "Código da Sala";
  el.appendChild(title);

  // sem text-transform/toUpperCase aqui: o código da sala do Colyseus é case-sensitive
  // (tem letras minúsculas mesmo), então forçar maiúsculas quebraria o "entrar com código"
  const input = document.createElement("input");
  input.type = "text";
  input.maxLength = 12;
  input.placeholder = "código";
  input.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 28px; font-weight: 700; letter-spacing: 4px;
    text-align: center; color: #fff; background: ${MENU.painel};
    border: 4px solid #fff; box-shadow: 5px 5px 0 #000; padding: 10px 16px; width: 280px;
    margin-bottom: 28px; caret-color: ${MENU.vermelho};
  `;
  input.addEventListener("input", () => {
    input.value = input.value.trim();
  });

  // mesmo motivo do campo de nome: o anel de foco padrão do navegador é dourado e destoa da paleta
  input.style.outline = "none";
  input.addEventListener("focus", () => (input.style.borderColor = MENU.vermelho));
  input.addEventListener("blur", () => (input.style.borderColor = "#fff"));

  el.appendChild(input);

  const button = document.createElement("button");
  button.textContent = "Entrar";
  button.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 24px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px 48px;
    background: ${MENU.grafite}; color: #fff; border: 3px solid #fff;
    box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = MENU.grafiteHover;
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = MENU.grafite;
  });

  function submit() {
    const code = input.value.trim();
    if (!code) return;
    el.style.display = "none";
    onSubmit(code);
  }

  button.addEventListener("click", submit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit();
  });

  el.appendChild(button);
  if (onBack) el.appendChild(createBackButton(onBack));
  document.body.appendChild(comSomDeMenu(el));

  window.setTimeout(() => input.focus(), 0);
  return menuScreenHandle(el, onBack);
}

export interface LobbyPlayer {
  id: string;
  name: string;
  color: number;
  isBot: boolean;
}

export interface LobbyUpdate {
  code: string;
  players: LobbyPlayer[];
  isHost: boolean;
  localId: string;
  minRacers: number;
  maxRacers: number;
  onAddBot: () => void;
  onStart: () => void;
  onKick: (id: string) => void;
}

/** Sala de espera: mostra o código, quem já entrou, e (só pro host) os controles de bot/iniciar. */
export function createLobbyScreen() {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: none; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  const title = document.createElement("div");
  title.style.cssText = `
    font-size: 26px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 18px;
  `;
  title.textContent = "Sala de Espera";
  el.appendChild(title);

  const codeRow = document.createElement("div");
  codeRow.style.cssText = "display: flex; align-items: center; gap: 10px; margin-bottom: 22px;";
  el.appendChild(codeRow);

  // text-transform: none sobrescreve o uppercase padrão do retroPanelStyle — o código da sala é
  // case-sensitive (tem letras minúsculas), então precisa aparecer exatamente como é de verdade
  const codeLabel = document.createElement("div");
  codeLabel.style.cssText = retroPanelStyle(
    `font-size: 26px; letter-spacing: 4px; color: #fff; background: ${MENU.painel}; text-transform: none;`
  );
  codeRow.appendChild(codeLabel);

  const copyButton = document.createElement("button");
  copyButton.textContent = "Copiar";
  copyButton.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 13px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; padding: 8px 14px; background: ${MENU.grafite}; color: #fff;
    border: 3px solid #fff; box-shadow: 3px 3px 0 #000; cursor: pointer;
  `;
  copyButton.addEventListener("click", () => {
    const text = codeLabel.textContent ?? "";

    function flash(label: string) {
      copyButton.textContent = label;
      window.setTimeout(() => (copyButton.textContent = "Copiar"), 1200);
    }

    // navigator.clipboard só existe em contexto seguro (https ou localhost) — acessando pelo IP
    // da rede local (http puro) ele nem existe, então cai no fallback do textarea escondido
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => flash("Copiado!")).catch(() => flash("Falhou"));
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
      document.execCommand("copy");
      flash("Copiado!");
    } catch {
      flash("Falhou");
    }
    document.body.removeChild(textarea);
  });
  codeRow.appendChild(copyButton);

  const listPanel = document.createElement("div");
  listPanel.style.cssText = retroPanelStyle(
    `width: 300px; min-height: 140px; text-align: left; color: #fff; background: ${MENU.painel}; display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px;`
  );
  el.appendChild(listPanel);

  const statusText = document.createElement("div");
  statusText.style.cssText = `font-size: 14px; letter-spacing: 1px; color: ${MENU.prata}; margin-bottom: 18px;`;
  el.appendChild(statusText);

  const controls = document.createElement("div");
  controls.style.cssText = "display: flex; gap: 16px;";
  el.appendChild(controls);

  const addBotButton = document.createElement("button");
  addBotButton.textContent = "+ Adicionar Bot";
  addBotButton.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 16px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; padding: 12px 20px; background: ${MENU.grafite}; color: #fff;
    border: 3px solid #fff; box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  controls.appendChild(addBotButton);

  const startButton = document.createElement("button");
  startButton.textContent = "Iniciar Corrida";
  startButton.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 16px; font-weight: 700; letter-spacing: 1px;
    text-transform: uppercase; padding: 12px 20px; background: ${MENU.vermelho}; color: #fff;
    border: 3px solid #fff; box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  controls.appendChild(startButton);

  function setButtonEnabled(button: HTMLButtonElement, enabled: boolean) {
    button.disabled = !enabled;
    button.style.opacity = enabled ? "1" : "0.4";
    button.style.cursor = enabled ? "pointer" : "not-allowed";
  }

  let onAddBot: (() => void) | null = null;
  let onStart: (() => void) | null = null;
  addBotButton.addEventListener("click", () => onAddBot?.());
  startButton.addEventListener("click", () => onStart?.());

  document.body.appendChild(comSomDeMenu(el));

  return {
    show() {
      el.style.display = "flex";
    },
    hide() {
      el.style.display = "none";
    },
    update(opts: LobbyUpdate) {
      codeLabel.textContent = opts.code;
      onAddBot = opts.onAddBot;
      onStart = opts.onStart;

      listPanel.innerHTML = "";
      opts.players.forEach((p) => {
        const row = document.createElement("div");
        row.style.cssText = "display: flex; align-items: center; gap: 8px; font-size: 14px;";
        const swatch = document.createElement("span");
        swatch.style.cssText = `width: 12px; height: 12px; background: ${colorToCss(p.color)}; border: 2px solid #000; flex-shrink: 0;`;
        row.appendChild(swatch);
        const label = document.createElement("span");
        label.textContent = p.isBot ? `${p.name} (BOT)` : p.name;
        label.style.flex = "1";
        row.appendChild(label);
        // host pode remover qualquer bot ou jogador, menos a si mesmo
        if (opts.isHost && p.id !== opts.localId) {
          const kickButton = document.createElement("button");
          kickButton.textContent = "×";
          kickButton.title = "Remover";
          kickButton.style.cssText = `
            font-family: ${RETRO_FONT}; font-size: 14px; font-weight: 700; line-height: 1;
            padding: 3px 9px; background: ${MENU.vermelho}; color: #fff; border: 2px solid #fff;
            cursor: pointer; flex-shrink: 0;
          `;
          kickButton.addEventListener("click", () => opts.onKick(p.id));
          row.appendChild(kickButton);
        }
        listPanel.appendChild(row);
      });

      controls.style.display = opts.isHost ? "flex" : "none";
      if (opts.isHost) {
        setButtonEnabled(addBotButton, opts.players.length < opts.maxRacers);
        setButtonEnabled(startButton, opts.players.length >= opts.minRacers);
        statusText.textContent =
          opts.players.length < opts.minRacers
            ? `Mínimo de ${opts.minRacers} carros pra largar — adicione bots ou espere mais gente`
            : "Pronto pra largar quando quiser!";
      } else {
        statusText.textContent = "Aguardando o host iniciar a corrida...";
      }
    },
  };
}

export function createNameEntryScreen(
  onStart: (name: string) => void,
  onBack?: () => void
): MenuScreen {
  const savedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY) ?? "";

  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

  // a logo substitui o título que antes era desenhado em texto
  el.appendChild(createLogo(420, 24));

  const label = document.createElement("div");
  label.style.cssText = `
    font-size: 18px; letter-spacing: 2px; text-transform: uppercase; color: ${MENU.branco};
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
    text-transform: uppercase; text-align: center; color: #fff; background: ${MENU.painel};
    border: 4px solid #fff; box-shadow: 5px 5px 0 #000; padding: 10px 16px; width: 280px;
    margin-bottom: 28px; caret-color: ${MENU.vermelho};
  `;
  input.style.setProperty("user-select", "text");
  input.style.setProperty("-webkit-user-select", "text");
  input.style.setProperty("-moz-user-select", "text");
  input.style.setProperty("-ms-user-select", "text");

  // o anel de foco padrão do navegador é dourado em vários temas, e destoava depois que o menu
  // passou a ser vermelho/branco. Marca o foco na própria borda, na cor da paleta.
  input.style.outline = "none";
  input.addEventListener("focus", () => (input.style.borderColor = MENU.vermelho));
  input.addEventListener("blur", () => (input.style.borderColor = "#fff"));
  input.addEventListener("input", () => {
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  });
  el.appendChild(input);

  const button = document.createElement("button");
  button.textContent = "Iniciar";
  button.style.cssText = `
    font-family: ${RETRO_FONT}; font-size: 24px; font-weight: 700; letter-spacing: 2px;
    text-transform: uppercase; padding: 14px 48px;
    background: ${MENU.vermelho}; color: #fff; border: 3px solid #fff;
    box-shadow: 4px 4px 0 #000; cursor: pointer;
  `;
  button.addEventListener("mouseenter", () => {
    button.style.background = MENU.vermelhoHover;
  });
  button.addEventListener("mouseleave", () => {
    button.style.background = MENU.vermelho;
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
  if (onBack) el.appendChild(createBackButton(onBack));
  document.body.appendChild(comSomDeMenu(el));

  window.setTimeout(() => input.focus(), 0);
  return menuScreenHandle(el, onBack);
}

export interface MapOption {
  id: string;
  name: string;
}

/** Tela de seleção de mapa, mesmo estilo retrô da tela de nome. */
export function createMapSelectScreen(
  maps: MapOption[],
  onSelect: (id: string) => void,
  onBack?: () => void
): MenuScreen {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

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
    font-size: 34px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 32px;
  `;
  title.textContent = "Escolha a Pista";
  el.appendChild(title);

  const list = document.createElement("div");
  list.style.cssText = "display: flex; flex-direction: column; gap: 16px;";
  el.appendChild(list);

  for (const map of maps) {
    const button = document.createElement("button");
    button.textContent = map.name;
    button.style.cssText = `
      font-family: ${RETRO_FONT}; font-size: 22px; font-weight: 700; letter-spacing: 2px;
      text-transform: uppercase; padding: 14px 48px;
      background: ${MENU.grafite}; color: #fff; border: 3px solid #fff;
      box-shadow: 4px 4px 0 #000; cursor: pointer;
    `;
    button.addEventListener("mouseenter", () => {
      button.style.background = MENU.grafiteHover;
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = MENU.grafite;
    });
    button.addEventListener("click", () => {
      el.style.display = "none";
      onSelect(map.id);
    });
    list.appendChild(button);
  }

  if (onBack) el.appendChild(createBackButton(onBack));
  document.body.appendChild(comSomDeMenu(el));
  return menuScreenHandle(el, onBack);
}

export interface CarOption {
  id: string;
  name: string;
  color: number;
}

/** Tela de seleção de carro (cor), mesmo estilo retrô das outras telas. */
export function createCarSelectScreen(
  cars: CarOption[],
  onSelect: (id: string) => void,
  onBack?: () => void
): MenuScreen {
  const el = document.createElement("div");
  el.style.cssText = `
    position: fixed; inset: 0; background: ${MENU.fundo};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    z-index: 30; font-family: ${RETRO_FONT}; color: #fff; text-align: center; gap: 8px;
  `;

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
    font-size: 34px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase;
    color: ${MENU.branco}; text-shadow: 3px 3px 0 #000; margin-bottom: 32px;
  `;
  title.textContent = "Escolha seu Carro";
  el.appendChild(title);

  const grid = document.createElement("div");
  grid.style.cssText = "display: flex; flex-wrap: wrap; justify-content: center; gap: 16px; max-width: 480px;";
  el.appendChild(grid);

  for (const car of cars) {
    const button = document.createElement("button");
    button.style.cssText = `
      font-family: ${RETRO_FONT}; font-size: 15px; font-weight: 700; letter-spacing: 1px;
      text-transform: uppercase; padding: 16px 18px; width: 130px;
      background: ${MENU.painel}; color: #fff; border: 3px solid #fff;
      box-shadow: 4px 4px 0 #000; cursor: pointer;
      display: flex; flex-direction: column; align-items: center; gap: 10px;
    `;

    const swatch = document.createElement("div");
    swatch.style.cssText = `
      width: 48px; height: 26px; background: ${colorToCss(car.color)};
      border: 2px solid #fff; border-radius: 4px;
    `;
    button.appendChild(swatch);

    const label = document.createElement("span");
    label.textContent = car.name;
    button.appendChild(label);

    button.addEventListener("mouseenter", () => {
      button.style.background = "#20203f";
    });
    button.addEventListener("mouseleave", () => {
      button.style.background = MENU.painel;
    });
    button.addEventListener("click", () => {
      el.style.display = "none";
      onSelect(car.id);
    });
    grid.appendChild(button);
  }

  if (onBack) el.appendChild(createBackButton(onBack));
  document.body.appendChild(comSomDeMenu(el));
  return menuScreenHandle(el, onBack);
}

export function createMobileControls(onChange: (state: MobileControlState) => void) {
  const state: MobileControlState = { throttle: false, brake: false, nitro: false, steer: 0 };

  const container = document.createElement("div");
  container.style.cssText = `
    position: fixed; inset: 0; z-index: 22; pointer-events: none;
  `;

  const wrapper = document.createElement("div");
  wrapper.style.cssText = `
    position: absolute; inset: 0; display: flex; justify-content: space-between;
    align-items: flex-end; gap: 12px; box-sizing: border-box;
    padding: 12px; padding-bottom: max(20px, env(safe-area-inset-bottom));
    pointer-events: none;
  `;
  container.appendChild(wrapper);

  // painel do direcional — mesmo estilo retrô do resto do HUD (borda branca grossa, sombra
  // preta deslocada, sem blur/glass) em vez do visual "genérico" de antes
  // pointer-events só nos widgets de verdade (não no wrapper inteiro) — senão a área vazia do
  // meio da tela bloqueava cliques em telas por baixo, tipo o botão "Reiniciar" da vitória
  const steeringCard = document.createElement("div");
  // o tamanho considera vw E vh — só vw deixava o controle enorme no modo paisagem, onde a
  // altura da tela é bem menor (mesmo width em px vira uma fração muito maior da tela)
  steeringCard.style.cssText = `
    width: min(34vw, 34vh, 190px); height: min(34vw, 34vh, 190px);
    background: #14142b; border: 3px solid #fff; box-shadow: 5px 5px 0 #000;
    position: relative; overflow: hidden; touch-action: none; pointer-events: auto;
    display: flex; align-items: center; justify-content: center;
  `;

  const steeringPad = document.createElement("div");
  steeringPad.style.cssText = `
    width: 88%; height: 88%; border-radius: 50%;
    background: #0b0b1a;
    border: 2px solid rgba(255,255,255,0.35);
    position: relative; display: flex; align-items: center; justify-content: center;
  `;
  steeringCard.appendChild(steeringPad);

  const ring = document.createElement("div");
  ring.style.cssText = `
    position: absolute; inset: 12px; border: 1px dashed rgba(255,255,255,0.2);
    border-radius: 50%; pointer-events: none;
  `;
  steeringPad.appendChild(ring);

  const steerIndicator = document.createElement("div");
  steerIndicator.style.cssText = `
    position: absolute; width: 18px; height: 18px; background: #ffe14d;
    border: 2px solid #fff; border-radius: 50%;
    left: 50%; top: 50%; transform: translate(-50%, -50%);
    transition: left 0.08s ease-out;
  `;
  steeringPad.appendChild(steerIndicator);

  const steeringHint = document.createElement("div");
  steeringHint.textContent = "DIRIJA";
  steeringHint.style.cssText = `
    position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%);
    font-family: ${RETRO_FONT}; font-weight: 700;
    color: #fff; font-size: 11.5px; letter-spacing: 1px;
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
    display: flex; gap: 12px; align-items: center; justify-content: flex-end;
    width: min(34vw, 34vh, 170px); pointer-events: auto;
  `;

  // triângulo desenhado só com borda CSS — não usa glifo de texto (▲/▼), que em alguns
  // navegadores/fontes mobile renderizava como um ícone quebrado/genérico entre os botões
  function createArrowTriangle(direction: "up" | "down"): HTMLDivElement {
    const triangle = document.createElement("div");
    const borderSide = direction === "up" ? "border-bottom" : "border-top";
    triangle.style.cssText = `
      width: 0; height: 0; margin: 0 auto;
      border-left: 14px solid transparent; border-right: 14px solid transparent;
      ${borderSide}: 22px solid #fff;
      filter: drop-shadow(2px 2px 0 #000);
    `;
    return triangle;
  }

  function createActionButton(direction: "up" | "down", color: string) {
    const button = document.createElement("div");
    button.style.cssText = `
      width: min(18vw, 16vh, 72px); height: min(18vw, 16vh, 72px);
      display: flex; align-items: center;
      justify-content: center; background: ${color};
      border: 3px solid #fff; box-shadow: 4px 4px 0 #000;
      user-select: none; touch-action: none; transition: transform 0.1s ease;
    `;
    button.appendChild(createArrowTriangle(direction));
    button.addEventListener("pointerdown", () => {
      button.style.transform = "translate(2px, 2px)";
      button.style.boxShadow = "2px 2px 0 #000";
    });
    const restore = () => {
      button.style.transform = "translate(0, 0)";
      button.style.boxShadow = "4px 4px 0 #000";
    };
    button.addEventListener("pointerup", restore);
    button.addEventListener("pointercancel", restore);
    return button;
  }

  const throttleButton = createActionButton("up", "#1f8f3d");
  const brakeButton = createActionButton("down", "#d4342c");

  function bindToggle(button: HTMLDivElement, key: keyof MobileControlState) {
    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      commitState({ [key]: true } as Partial<MobileControlState>);
    });
    const release = (event: PointerEvent) => {
      event.preventDefault();
      commitState({ [key]: false } as Partial<MobileControlState>);
    };
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("pointerleave", release);
  }

  bindToggle(throttleButton, "throttle");
  bindToggle(brakeButton, "brake");

  // nitro é um PULSO, não um estado mantido: dispara no toque e volta a false no frame seguinte,
  // igual à tecla de espaço no teclado. Sem isso, segurar o dedo gastaria as três cargas seguidas.
  const nitroButton = document.createElement("div");
  nitroButton.textContent = "N";
  nitroButton.style.cssText = `
    width: 100%; padding: 10px 0; margin-top: 8px; text-align: center;
    font-family: ${RETRO_FONT}; font-size: 20px; font-weight: 700; color: #fff;
    background: #0a6b7a; border: 3px solid #fff; box-shadow: 3px 3px 0 #000;
    pointer-events: auto; touch-action: none; user-select: none;
  `;
  nitroButton.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    commitState({ nitro: true });
    commitState({ nitro: false });
  });

  rightPanel.appendChild(throttleButton);
  rightPanel.appendChild(brakeButton);
  rightPanel.appendChild(nitroButton);
  wrapper.appendChild(steeringCard);
  wrapper.appendChild(rightPanel);
  document.body.appendChild(container);
  return { destroy: () => container.remove() };
}
