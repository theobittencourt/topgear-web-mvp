/**
 * Som de interface.
 *
 * Só os menus fazem barulho por enquanto — durante a corrida o jogo é mudo de propósito, então
 * nada aqui é chamado de dentro do loop de jogo.
 */

/** Cheio soa agressivo demais pra um clique que se repete o tempo todo. */
const VOLUME_CLIQUE = 0.5;

let cliqueAudio: HTMLAudioElement | null = null;

/**
 * Um elemento `<audio>` só, reaproveitado em todo clique.
 *
 * Dar `new Audio()` a cada clique deixaria o primeiro toque atrasado (o navegador iria buscar o
 * arquivo na hora) e ainda acumularia elementos soltos na memória. Criando uma vez com
 * `preload = "auto"`, o arquivo já está na mão quando o clique acontece.
 */
function obterAudioDeClique(): HTMLAudioElement {
  if (!cliqueAudio) {
    cliqueAudio = new Audio("/sound.mp3");
    cliqueAudio.preload = "auto";
    cliqueAudio.volume = VOLUME_CLIQUE;
  }
  return cliqueAudio;
}

/**
 * Toca o clique de menu. Seguro de chamar em qualquer situação: se o navegador recusar, o som
 * simplesmente não sai.
 *
 * O `currentTime = 0` é o que permite cliques em sequência — sem ele, clicar de novo enquanto o
 * som anterior ainda toca não faria nada, e o menu pareceria estar ignorando o segundo clique.
 */
export function playMenuClick() {
  const audio = obterAudioDeClique();
  try {
    audio.currentTime = 0;
    // play() devolve uma promise que pode ser rejeitada (política de autoplay, aba sem foco,
    // aparelho no mudo). Sem o catch isso vira "unhandled rejection" no console — e um som de
    // interface não vale um erro na tela do usuário.
    void audio.play().catch(() => {});
  } catch {
    // alguns navegadores lançam ao mexer em currentTime antes do arquivo estar pronto
  }
}
