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
- [ ] Colisão do carro com a borda da pista (hoje é possível sair pro gramado — e com as subidas/descidas agora existem trechos tipo "penhasco" ao sair da pista, então isso ficou mais importante)
- [ ] Assets do Blender (hoje só primitivas geométricas, mesmo com visual melhorado)

## Arquivos principais
- `src/track.ts` — geração da pista, waypoints do centro, meio-fio em zebra, linha de chegada, cenário (árvores/arquibancada)
- `src/car.ts` — modelo do carro (`createCarMesh`), `CarController` (física do jogador) e `AICarController` (segue waypoints)
- `src/collision.ts` — resolução de colisão entre carros por sobreposição de raio
- `src/raceTimer.ts` — `RaceProgress`: acompanha progresso/voltas de cada carro (jogador e bots) e calcula um score usado pro ranking
- `src/ui.ts` — velocímetro, HUD de volta, leaderboard, banner de volta, countdown de largada e tela de vitória
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
