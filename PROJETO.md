# Top Gear Test — Jogo de Corrida Web

## Objetivo
MVP de corrida estilo Top Gear (SNES): câmera em terceira pessoa atrás do carro, pista fechada, carros adversários controlados por IA, cronômetro de volta.

## Stack
- Three.js + Vite + TypeScript
- Sem multiplayer nessa fase (projeto separado do `openworld-test`)

## Como rodar
```
npm install
npm run dev
```
Abre em `http://localhost:5174`.

Controles: **W** acelera, **S** freia/ré, **A/D** vira.

## Funcionalidades
- [x] Pista oval (formato "estádio") com asfalto, meio-fio e grama
- [x] Carro do jogador com física simples (aceleração, atrito, curva dependente de velocidade)
- [x] Câmera terceira pessoa seguindo o carro
- [x] Waypoints gerados automaticamente ao longo do centro da pista
- [x] 3 carros adversários controlados por IA, seguindo os waypoints com velocidades de cruzeiro diferentes
- [x] Colisão entre carros tipo "bumper car" (empurrão lateral proporcional à sobreposição, decai rápido, não trava a velocidade de condução)
- [x] Velocímetro (km/h) no HUD
- [x] Leaderboard ao vivo (canto superior direito) com colocação de todos os carros
- [x] Banner de "Volta X de N" ao cruzar a linha de chegada
- [x] Corrida com número total de voltas definido (`TOTAL_LAPS`), tela de vitória com o carro/cor vencedor e botão de reiniciar (recarrega a página)
- [x] Largada em grid (todos os carros lado a lado na mesma linha) com countdown "3, 2, 1, VAI!" antes de liberar o controle
- [x] Visual "cara de corrida arcade": carro com capô inclinado, aerofólio, faróis/lanternas emissivas; pista com meio-fio em zebra vermelho/branco, linha de chegada quadriculada, linha central tracejada, árvores e arquibancada ao redor; sombras ligadas
- [x] Mapa maior com subidas e descidas, com a pista e a grama se encaixando direito (sem buracos/flutuação) — ver aprendizados abaixo
- [x] Bots mais competitivos (cruzeiro quase no máximo do jogador) e capazes de dar ré quando ficam travados
- [x] HUD com cara retrô SNES: painéis com borda branca grossa e sombra deslocada preta (sem blur), fonte monoespaçada em caps-lock, velocímetro digital, leaderboard e banner de volta com essa mesma linguagem visual, countdown com cores tipo semáforo (vermelho/vermelho/amarelo/verde)
- [x] Elevação suave e consistente em toda a pista (retas incluídas) — carro não afunda/flutua mais em nenhum trecho
- [x] Recuperação de pista: se o jogador sair do asfalto por mais de meio segundo, é devolvido pro último ponto válido (perde a vantagem de qualquer atalho), com aviso "FORA DA PISTA!"
- [x] Mais árvores (dois anéis, cores variadas), nuvens e montanhas no horizonte pra dar profundidade
- [x] Carro não "pula" mais na pista (altura interpolada suavemente entre waypoints vizinhos, em vez de saltar pro waypoint mais próximo)
- [x] Vencedor da corrida determinado corretamente (ver bug corrigido abaixo)
- [x] Contagem de volta do jogador não trava mais perto das bordas da pista, e a recuperação de pista não entra mais em loop (ver bugs corrigidos abaixo)
- [x] Tela inicial estilo SNES pra digitar o nickname (salvo no `localStorage`, pré-preenchido em visitas futuras), com botão "Iniciar" que leva pro countdown/corrida normal
- [ ] Assets do Blender (hoje só primitivas geométricas, mesmo com visual melhorado)
- [ ] Bots atualmente muito rápidos/precisos pra quem está aprendendo a dirigir — considerar reduzir throttle de cruzeiro ou adicionar dificuldade progressiva

## Arquivos principais
- `src/track.ts` — geração da pista, waypoints do centro, meio-fio em zebra, linha de chegada, cenário (árvores/arquibancada)
- `src/car.ts` — modelo do carro (`createCarMesh`), `CarController` (física do jogador) e `AICarController` (segue waypoints)
- `src/collision.ts` — resolução de colisão entre carros por sobreposição de raio
- `src/raceTimer.ts` — `RaceProgress`: acompanha progresso/voltas de cada carro (jogador e bots) e calcula um score usado pro ranking
- `src/ui.ts` — velocímetro, HUD de volta, leaderboard, banner de volta, countdown de largada, tela de vitória e tela inicial de nome (`createNameEntryScreen`)
- `src/main.ts` — monta a cena, posiciona os carros em grid na largada, integra tudo, define `TOTAL_LAPS` e roda o loop principal

## Decisões e aprendizados
- **Colisão "trava" vs "empurra"**: a versão anterior desacelerava a velocidade de condução no impacto (`speed *= 0.8`), o que dava sensação de carro "grudando" no outro. Trocamos por uma velocidade de empurrão separada (`bumpVelocity`), aplicada como impulso proporcional à profundidade da sobreposição e com decaimento rápido — o carro continua dirigindo normalmente mas é empurrado lateralmente, tipo bumper car / Mario Kart.
- **Rotação errada na largada**: o carro tinha a propriedade lógica `heading` correta desde o início, mas a rotação visual do `mesh` só é sincronizada dentro de `CarController.update()` — que só roda depois do countdown. Resultado: carro "nascia" com rotação visual zerada e só girava pra posição certa no primeiro frame de movimento. Corrigido setando `mesh.rotation.y` explicitamente na hora do spawn.
- **Elevação com geometria de baixa resolução gera "montanha quebrada"**: a primeira tentativa aplicou elevação por vértice numa `ShapeGeometry` comum, mas essa geometria só tem vértices nos cantos das retas (não subdivide ao longo de segmentos retos), então a subida virou uma rampa distorcida e pontuda em vez de suave. Resolvido reconstruindo o asfalto como uma "fita" de triângulos usando os mesmos pontos de alta resolução (120 segmentos) já usados pro meio-fio.
- **Culling escondendo a pista**: depois de trocar pra geometria customizada, a pista sumiu — a ordem de vértices dos triângulos ficou de "costas" pra câmera (backface culling do material padrão). Resolvido com `material.side = THREE.DoubleSide`.
- IA de carros usa a técnica clássica "seguir o próximo waypoint": calcula o ângulo até o próximo ponto da pista e usa a diferença angular como input de direção (controlador proporcional simples). Suficiente pra MVP, sem pathfinding real.
- Progresso/ranking usa o mesmo sistema de waypoints da IA (não checkpoints separados): cada carro tem um índice do próximo waypoint, e o "score" pra ranking é `voltas * total_waypoints + índice_atual`. Funciona pra jogador e bots igual, independente de onde cada um começou na pista.
- **Bug corrigido**: o leaderboard só fica correto se todos os carros começarem do mesmo ponto da pista (mesmo `spawnIndex`/`startIdx`) — tínhamos espalhado os bots pela pista pra evitar sobreposição na largada, o que fazia o ranking inicial já sair errado (quem nascia mais à frente aparecia "na frente" sem ter dirigido nada). Resolvido colocando todos lado a lado na mesma linha de largada (grid lateral, perpendicular ao sentido da pista) com o mesmo índice de progresso.
- Reiniciar a corrida só dá `location.reload()` — mais simples e sem risco de estado zumbi (timers, colisões, física) do que tentar resetar tudo manualmente.
- Pra desenhar decorações "flat" (linha de chegada, faixas de zebra) alinhadas com a pista, é mais simples usar geometria 3D (caixas) com `rotation.y` do que `PlaneGeometry` + `rotation.x`, porque a composição de rotações do Three.js em planos já achatados é contra-intuitiva. Só usamos plano+rotation.x quando a orientação já é simétrica (ex: linha de chegada bem no início reto).
- **Bug sério de elevação — carro "andando por baixo da pista"**: a função de elevação (baseada no ângulo em relação ao centro da pista) estava sendo calculada *separadamente* pra borda externa e pra borda interna da pista em cada ponto da malha. Como a borda externa e a interna têm ângulos ligeiramente diferentes num mesmo "trecho" da pista, a elevação de cada uma divergia — a superfície ficava torta através da largura da pista, e o carro (que usa a fórmula direto na sua própria posição) não batia com o que a malha realmente desenhava ali. Corrigido calculando **uma única elevação por índice** (usando o ponto médio entre a borda externa e interna) e aplicando esse mesmo valor nos dois lados da "fita" da pista — agora a pista fica reta através da largura (só varia ao longo do percurso), e bate exatamente com a altura calculada pro carro.
- **Pista incompatível com a grama**: a onda de elevação original oscilava pra cima E pra baixo do zero, então em pontos baixos a pista "afundava" abaixo do nível da grama (que é sempre plana). Corrigido deslocando a onda pra cima (nunca fica negativa) e adicionando uma "saia" vertical (parede) que fecha o vão entre a borda elevada da pista e o nível da grama nos trechos em que a pista sobe.
- **A causa raiz de quase todo bug de elevação/waypoint**: `Shape.getPoints(N)` do Three.js **não subdivide segmentos retos** (`lineTo`) — só distribui pontos nas curvas (`absarc`). Resultado: cada reta da pista (que é a maior parte do percurso!) virava só 2 pontos (início e fim), então os "waypoints" e os pontos da malha da pista praticamente pulavam de um canto ao outro nas retas, sem nada no meio. Isso explicava o carro ainda afundando em alguns trechos (elevação interpolada linearmente ao longo de uma reta inteira, em vez de seguir a curva suave da fórmula) e até o bug de "fora da pista" disparando bem na largada (o waypoint mais próximo de um carro no meio de uma reta podia estar a 50+ unidades de distância, porque não existia nenhum waypoint ali perto). Corrigido trocando todo `.getPoints(N)` por `.getSpacedPoints(N)`, que distribui pontos por comprimento de arco real do caminho inteiro, incluindo as retas.
- **Carro "pulando" tipo paralelepípedo**: mesmo depois do fix acima, a altura do carro ainda saltava porque `CarController` simplesmente copiava a altura do waypoint mais próximo (`findNearestWaypoint`) — toda vez que o waypoint mais próximo mudava (o que acontece a cada poucos metros), a altura pulava de um valor pro outro em vez de variar suave. Corrigido com `sampleTrackElevation`: acha o waypoint mais próximo, projeta a posição do carro no segmento vizinho (o anterior ou o seguinte, o que estiver mais perto) e interpola a elevação entre os dois — a mesma lógica de como a malha da pista é desenhada (interpolação linear entre pontos vizinhos), então não há mais degrau nenhum.
- **Bug do vencedor errado**: a linha de chegada *visual* (o quadriculado, desenhado em `startPosition`) e o ponto usado internamente pra contar "completou uma volta" (`RaceProgress` verificava `nextIndex === 0`, um índice fixo e arbitrário do array de waypoints) eram lugares **diferentes** da pista. Os carros cruzavam o quadriculado visualmente sem a volta contar, porque o índice 0 do array fica em outro ponto da pista (a ponta da reta, não o meio onde a linha de chegada foi desenhada). Corrigido calculando o índice do waypoint mais próximo da `startPosition` (`startIdx`) uma única vez e usando esse mesmo índice tanto pra desenhar a linha de chegada quanto como referência de "volta completa" em `RaceProgress` — agora os dois estão sempre no mesmo lugar físico da pista, pra todos os carros.
- **Bug "não conta meus rounds" (contagem de volta travando pro jogador)**: dois problemas se somavam. (1) O limiar de distância pra "alcançar" um waypoint de progresso era de 8 unidades, menor que a metade da largura da pista (9 unidades) — um jogador dirigindo perto da borda (não bem no centro, ao contrário dos bots que seguem a linha certinha) podia nunca chegar perto o suficiente do waypoint do centro, travando o contador. Corrigido aumentando o limiar (14) e comparando só no plano (x,z), ignorando a elevação. (2) Quando o carro saía da pista e a recuperação o devolvia, ela usava a *mesma direção* que o carro tinha ao sair — que já estava errada (apontando pra fora!) — fazendo ele sair de novo imediatamente, em loop, sem nunca progredir de fato. Corrigido: a recuperação agora realinha o carro com a direção real da pista naquele ponto (calculada a partir dos waypoints), não com o heading (possivelmente errado) que o carro tinha antes.
