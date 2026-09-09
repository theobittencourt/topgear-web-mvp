/**
 * Regras da corrida — fonte única pro client e pro servidor.
 *
 * Antes cada constante daqui existia duas vezes (uma em `src/`, outra em `server/src/`) com um
 * comentário "PRECISA bater com..." e nada garantindo que batia mesmo.
 */

/** Voltas pra terminar a corrida. */
export const TOTAL_LAPS = 3;

/**
 * Distância pra considerar que um carro "alcançou" um waypoint de progresso.
 *
 * Precisa ser MAIOR que a metade da largura da pista: quem dirige colado na borda (jogador humano,
 * ao contrário dos bots que seguem o centro certinho) nunca chegaria perto o bastante do waypoint
 * do meio, e a contagem de voltas travava.
 */
export const WAYPOINT_RADIUS = 14;

/** Limiar mais apertado, usado pela IA pra trocar de waypoint alvo (ela sim segue o centro). */
export const BOT_WAYPOINT_RADIUS = 8;

/** Mínimo/máximo de carros numa sala online (o lobby do client mostra os mesmos números). */
export const MIN_RACERS = 5;
export const MAX_RACERS = 10;

/** Duração da contagem regressiva de largada, em segundos. */
export const COUNTDOWN_SECONDS = 4;
