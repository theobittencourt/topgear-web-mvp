# Top Gear Test — Jogo de Corrida Web

## Objetivo
Corrida arcade estilo Top Gear (SNES): câmera em terceira pessoa atrás do carro, pista fechada, adversários controlados por IA, cronômetro de volta. Hoje tem também modo online com sala privada e servidor autoritativo.

## Stack
- **Client**: Three.js + Vite + TypeScript (deploy na Vercel)
- **Servidor**: Colyseus + Express + TypeScript (deploy no Fly.io, região `gru`)
- **Compartilhado**: física, geometria da pista e regras da corrida num módulo só, importado pelos dois lados

## Como rodar
```
npm install
npm run dev
```
Abre em `http://localhost:5174`.

Pro modo online, o servidor precisa estar de pé junto, em outro terminal:
```
cd server
npm install --legacy-peer-deps
npm run dev
```
Sobe em `http://localhost:2567`. O `--legacy-peer-deps` não é opcional (ver aprendizados).

Controles: **W** acelera, **S** freia/ré, **A/D** viram.

## Funcionalidades

### Pista e mundo
- [x] Pista oval (formato "estádio") com asfalto, meio-fio e grama
- [x] Mapa maior com subidas e descidas, com a pista e a grama se encaixando direito (sem buracos/flutuação)
- [x] Elevação suave e consistente em toda a pista (retas incluídas) — carro não afunda/flutua em nenhum trecho
- [x] Visual "cara de corrida arcade": meio-fio em zebra vermelho/branco, linha de chegada quadriculada, linha central tracejada, calçada de concreto, árvores, arquibancada, postes de luz, sombras ligadas
- [x] Túnel comprido na reta oposta à largada, com portais de concreto e luminárias de teto
- [x] Árvores em vários anéis, nuvens em camadas e montanhas no horizonte pra dar profundidade
- [x] 3 mapas configuráveis (Estádio Clássico, Circuito Litoral, Circuito Noturno), com painéis de patrocínio opcionais e iluminação noturna
- [x] Cenário todo desenhado com `InstancedMesh` — o mapa estádio saiu de ~1278 draw calls pra 28

### Carro e corrida
- [x] Física simples (aceleração, atrito, curva dependente da velocidade)
- [x] Câmera em terceira pessoa seguindo o carro
- [x] Colisão entre carros tipo "bumper car" (empurrão lateral proporcional à sobreposição)
- [x] Recuperação de pista: sair do asfalto por mais de meio segundo devolve o carro pro último ponto válido, com aviso "FORA DA PISTA!" (só no solo)
- [x] Largada em grid com countdown "3, 2, 1, VAI!"
- [x] Corrida de `TOTAL_LAPS` voltas, com tela de vitória e botão de reiniciar
- [x] 6 cores de carro pra escolher

### Modo solo
- [x] 9 carros adversários controlados por IA, com velocidades de cruzeiro diferentes
- [x] Bots competitivos (cruzeiro quase no máximo do jogador) e capazes de dar ré quando ficam travados

### Modo online
- [x] Sala privada com código pra compartilhar, de 5 a 10 carros
- [x] Servidor autoritativo: o client só manda intenção, o servidor simula a 30Hz e decide tudo
- [x] Host pode adicionar bots, remover jogadores e escolher quando largar
- [x] Fases sincronizadas (`waiting` → `countdown` → `racing` → `finished`), com reinício na mesma sala
- [x] Suavização da posição no client pra esconder o degrau dos pacotes de rede

### HUD
- [x] Velocímetro digital (km/h) com barra de tacômetro
- [x] Leaderboard ao vivo, minimapa, badge de posição, volta atual, última volta e melhor volta
- [x] Cara retrô SNES: painéis com borda branca grossa e sombra deslocada preta (sem blur), fonte monoespaçada em caps-lock, countdown com cores de semáforo
- [x] Tela inicial pra digitar o nickname (salvo no `localStorage`), seleção de modo, mapa e carro
- [x] Controles mobile por toque, com zoom por pinça e double-tap bloqueados

### Pendente
- [ ] Assets do Blender (hoje só primitivas geométricas, mesmo com visual melhorado)
- [ ] Colisão entre carros e recuperação de pista no modo ONLINE (hoje só no solo — dá pra cortar caminho pela grama numa sala online)
- [ ] Bots muito rápidos/precisos pra quem está aprendendo a dirigir — considerar dificuldade progressiva
- [ ] Countdown do client é fixo em 4×1s e ignora o `state.countdown` que o servidor já sincroniza
- [ ] Sem testes automatizados, sem lint, sem CI
- [ ] `main.ts` tem dois loops de render quase idênticos (solo e online), com o bloco de HUD/câmera duplicado

## Arquivos principais

### Client (`src/`)
- `track.ts` — malha 3D da pista (asfalto, meio-fio, calçada, saias, túnel), elevação e cenário instanciado
- `car.ts` — modelo do carro (`createCarMesh`), `CarController` (jogador) e `AICarController` (segue waypoints)
- `collision.ts` — resolução de colisão entre carros por sobreposição de raio
- `raceTimer.ts` — `RaceProgress` (progresso/voltas no solo) e `LapClock` (só cronômetro, usado no online)
- `ui.ts` — HUD e todas as telas (DOM puro)
- `main.ts` — monta a cena, o fluxo de telas e os dois loops de jogo
- `network.ts` — conexão com o servidor Colyseus

### Servidor (`server/src/`)
- `index.ts` — HTTP + WebSocket
- `rooms/RaceRoom.ts` — simulação a 30Hz, lobby, bots, contagem de voltas e ranking
- `rooms/CarState.ts` / `rooms/RaceState.ts` — estado sincronizado

### Compartilhado (`server/src/shared/`, alias `@shared`)
- `physics.ts` — constantes e o passo de física do carro
- `trackGeometry.ts` — forma e traçado de cada pista, largada e vagas da grid
- `rules.ts` — voltas totais, limiares de waypoint, mínimo/máximo de carros

## Decisões e aprendizados

### Física, colisão e IA
- **Colisão "trava" vs "empurra"**: a versão antiga desacelerava a velocidade de condução no impacto (`speed *= 0.8`), o que dava sensação de carro "grudando" no outro. Trocamos por uma velocidade de empurrão separada (`bumpVelocity`), aplicada como impulso proporcional à profundidade da sobreposição e com decaimento rápido — o carro continua dirigindo normalmente mas é empurrado lateralmente, tipo bumper car / Mario Kart.
- IA de carros usa a técnica clássica "seguir o próximo waypoint": calcula o ângulo até o próximo ponto da pista e usa a diferença angular como input de direção (controlador proporcional simples). Suficiente pro MVP, sem pathfinding real.
- Progresso/ranking usa o mesmo sistema de waypoints da IA (não checkpoints separados): cada carro tem um índice do próximo waypoint, e o "score" pra ranking é `voltas * total_waypoints + índice_atual`. Funciona pra jogador e bots igual.
- **Rotação errada na largada**: o carro tinha a propriedade lógica `heading` correta desde o início, mas a rotação visual do `mesh` só era sincronizada dentro de `CarController.update()` — que só roda depois do countdown. Resultado: carro "nascia" com rotação visual zerada e só girava pra posição certa no primeiro frame de movimento. Corrigido setando `mesh.rotation.y` explicitamente na hora do spawn.
- **A e D estavam invertidos no teclado**: a física faz `heading -= steer`, ou seja **steer positivo gira pra direita** — e o `A` (esquerda) mandava `+1`. O detalhe traiçoeiro é que o controle mobile já usava a convenção certa (arrastar pra direita = steer positivo), então só o teclado estava trocado, e a IA também estava certa (ela calcula `-angleDiff`). Por isso o conserto foi no mapeamento das teclas, **não** no sinal da física: mexer na física teria feito os bots dirigirem pro lado errado.

### Geometria da pista e elevação
- **Elevação com geometria de baixa resolução gera "montanha quebrada"**: a primeira tentativa aplicou elevação por vértice numa `ShapeGeometry` comum, mas essa geometria só tem vértices nos cantos das retas (não subdivide ao longo de segmentos retos), então a subida virou uma rampa distorcida e pontuda em vez de suave. Resolvido reconstruindo o asfalto como uma "fita" de triângulos usando os mesmos pontos de alta resolução já usados pro meio-fio.
- **Culling escondendo a pista**: depois de trocar pra geometria customizada, a pista sumiu — a ordem de vértices dos triângulos ficou de "costas" pra câmera (backface culling do material padrão). Resolvido com `material.side = THREE.DoubleSide`.
- **Bug sério de elevação — carro "andando por baixo da pista"**: a função de elevação (baseada no ângulo em relação ao centro da pista) estava sendo calculada *separadamente* pra borda externa e pra borda interna em cada ponto da malha. Como as duas bordas têm ângulos ligeiramente diferentes num mesmo trecho, a elevação de cada uma divergia — a superfície ficava torta através da largura da pista, e o carro (que usa a fórmula direto na sua própria posição) não batia com o que a malha desenhava ali. Corrigido calculando **uma única elevação por índice** (usando o ponto médio entre as duas bordas) e aplicando esse mesmo valor nos dois lados da fita.
- **Pista incompatível com a grama**: a onda de elevação original oscilava pra cima E pra baixo do zero, então em pontos baixos a pista "afundava" abaixo do nível da grama (que é sempre plana). Corrigido deslocando a onda pra cima (nunca fica negativa) e adicionando uma "saia" vertical que fecha o vão entre a borda elevada da pista e o nível da grama.
- **A causa raiz de quase todo bug de elevação/waypoint**: `Shape.getPoints(N)` do Three.js **não subdivide segmentos retos** (`lineTo`) — só distribui pontos nas curvas (`absarc`). Cada reta da pista (que é a maior parte do percurso!) virava só 2 pontos, então os waypoints e os pontos da malha praticamente pulavam de um canto ao outro nas retas. Isso explicava o carro afundando em alguns trechos e até o "fora da pista" disparando na largada (o waypoint mais próximo podia estar a 50+ unidades). Corrigido trocando `.getPoints(N)` por `.getSpacedPoints(N)`, que distribui por comprimento de arco real. *(Hoje nem o `getSpacedPoints` é usado — ver "Amostragem da pista" abaixo — mas a lição de espaçar por comprimento de arco continua sendo a razão de tudo funcionar.)*
- **Frequência da elevação precisa ser inteira**: os multiplicadores em `elevationAt` têm que ser números inteiros de ciclos por volta. Com um valor não-inteiro (tipo 1.5), a função não fecha o ciclo exatamente onde a pista dá a volta completa (`t=0` e `t=1` têm que dar o mesmo valor) — sobra um salto discreto de elevação bem naquele ponto, e o carro literalmente "teleporta" pra cima/baixo ali.
- Pra desenhar decorações "flat" (linha de chegada, faixas de zebra) alinhadas com a pista, é mais simples usar geometria 3D (caixas) com `rotation.y` do que `PlaneGeometry` + `rotation.x`, porque a composição de rotações do Three.js em planos já achatados é contra-intuitiva.

### Contagem de voltas
- **Bug do leaderboard na largada**: o leaderboard só fica correto se todos os carros começarem do mesmo ponto de progresso. Tínhamos espalhado os bots pela pista pra evitar sobreposição na largada, o que fazia o ranking inicial já sair errado. Resolvido colocando todos na mesma linha de largada (grid lateral) com o mesmo índice de progresso.
- **Bug do vencedor errado**: a linha de chegada *visual* e o ponto usado internamente pra contar "completou uma volta" eram lugares **diferentes** da pista — o código verificava um índice fixo e arbitrário do array de waypoints, que fica na ponta da reta, não onde o quadriculado foi desenhado. Corrigido calculando o índice do waypoint mais próximo da largada uma única vez e usando esse mesmo índice pras duas coisas.
- **Bug "não conta meus rounds"**: dois problemas somados. (1) O limiar de distância pra "alcançar" um waypoint era de 8 unidades, menor que a metade da largura da pista (9) — um jogador dirigindo perto da borda (ao contrário dos bots, que seguem o centro) podia nunca chegar perto o suficiente, travando o contador. Corrigido aumentando pra 14 e comparando só no plano (x,z). (2) A recuperação de pista devolvia o carro com a *mesma direção* que ele tinha ao sair — que já estava errada, apontando pra fora — e ele saía de novo imediatamente, em loop. Corrigido realinhando com a direção real da pista naquele ponto.

### Código compartilhado entre client e servidor
- **Por que existe**: física, geometria da pista e regras da corrida estavam copiadas à mão em `src/` e em `server/src/`, com comentários "PRECISA bater com..." e nada garantindo que batessem. Bastava mudar o `cornerRadius` de um mapa e esquecer do outro lado pros bots do servidor dirigirem por cima da grama — sem erro nenhum aparecer, só comportamento estranho. Agora existe `server/src/shared/`, importado pelos dois lados pelo alias `@shared`.
- **Por que mora dentro de `server/`**: o Dockerfile do servidor faz `COPY src ./src`, então código dentro de `server/src/` já vai junto no build sem mexer em nada do deploy. Uma pasta `shared/` na raiz do repositório precisaria mudar o contexto de build do Docker e o comando de deploy. O servidor é a autoridade no multiplayer, então faz sentido ele ser o dono dessa definição.
- **Amostragem da pista virou matemática pura**: `stadiumPoints` reimplementa o que o `THREE.Shape(...).getSpacedPoints(n)` fazia, andando o comprimento de arco de um retângulo de cantos arredondados (4 retas + 4 arcos de quarto de volta). Foi comparado com a versão antiga nos 3 mapas e em 5 contornos diferentes: desvio máximo de **0.0002 unidades** numa pista de 24 de largura. O ganho é que o servidor não precisa mais carregar o `three` inteiro só pra saber onde fica a pista.
- Cuidado ao mexer: os arquivos de `shared/` são compilados pelos **dois** tsconfigs (o do client é ESM/bundler, o do servidor é CommonJS/ES2020). Nada de API de ES2023 pra cima ali dentro, e nada de importar `three`.

### Multiplayer
- **O servidor é a única autoridade** de posição, velocidade, volta, ranking e vencedor. Uma versão anterior deixava o client recontar as voltas por conta própria a partir da posição sincronizada — e como o client ainda *suaviza* essa posição pra renderizar, cada jogador podia contar a volta num frame diferente e ver um leaderboard diferente. Hoje o `CarState` sincroniza `lapCount` e `progress` prontos, e o client só espelha. O único cálculo local que sobrou é o **tempo** de volta (`LapClock`), disparado pela mudança do `lapCount` que veio do servidor.
- **Valor de rede nunca entra na simulação sem `Number.isFinite`**: `Math.max`/`Math.min` **propagam NaN** em vez de barrar, então um clamp normal deixava passar `steer = NaN` de um pacote malformado. Isso virava `heading` NaN, depois `x`/`z` NaN, e aquele carro sumia da pista pelo resto da corrida, sem volta. O `clampFinite` do `RaceRoom` existe por isso.
- **Input só é enviado quando muda**: antes saía um pacote por frame (60/s por jogador, ~600/s numa sala cheia) repetindo o mesmo valor. O WebSocket é confiável e ordenado, então o servidor simplesmente segue com o último valor recebido. Detalhe: o cache de "já mandei isso" precisa ser invalidado quando a corrida (re)começa, porque o servidor zera o input no spawn.
- **A vaga na grid é decidida pelo servidor** (`gridSlot`). O client chutava (`0` pra si mesmo, `cars.size + 1` pros outros), o que dava vagas trocadas em relação ao servidor pra quem entrava depois do host.
- **`display: none` que nunca voltava**: o overlay do countdown se escondia no fim da sequência e o `start()` não restaurava o `display`. No solo isso nunca apareceu porque reiniciar recarrega a página — mas no online o reinício reaproveita a mesma sala, e a segunda corrida largava sem contagem nenhuma na tela. Moral: componente de UI reaproveitado precisa se re-inicializar no `start`, não só no construtor.
- Reiniciar a corrida no solo só dá `location.reload()` — mais simples e sem risco de estado zumbi (timers, colisões, física) do que resetar tudo manualmente.

### Performance
- **O maior gargalo era draw call, não polígono**: cada árvore/montanha/nuvem era um `Group` com meshes e materiais próprios — ~300 árvores × 3 peças, 92 montanhas e ~180 esferas de nuvem davam mais de 1.200 draw calls e ~700 materiais distintos por frame. Trocando por `InstancedMesh` (com cor por instância via `setColorAt` onde ela varia), o mapa estádio foi pra **28 draw calls e 19 materiais**, com 1.259 objetos dentro de 9 instâncias.
- **Luz dinâmica custa em todo material da cena, não só no que ela ilumina**: o mapa noturno tinha ~20 `PointLight` (uma por poste, mais as do túnel), e cada uma entra no shader de *todos* os materiais. Reduzido pra 8 acendendo só 1 a cada N postes, com intensidade e alcance maiores pra compensar — as luminárias continuam todas visíveis porque o "bulbo" é material emissivo, que não custa nada. As constantes `NIGHT_LAMP_LIGHT_EVERY` e `TUNNEL_LIGHT_EVERY` em `track.ts` regulam isso.
- Ao instanciar um objeto que era um `Group` com filhos em alturas locais e escala uniforme no pai, a matriz da instância vira posição `(x, alturaLocal * escala, z)` com aquela mesma escala — não dá pra só copiar a altura local.

### Build e deploy
- **`npm ci` não funciona no servidor**: o grafo de dependências do Colyseus 0.16 tem uma dependência opcional (`@pm2/io`) que some do lockfile de forma inconsistente, mesmo com lockfile recém-gerado (bug conhecido do npm com dependências opcionais). Por isso o Dockerfile e o `nixpacks.toml` usam `npm install --legacy-peer-deps`, igual ao que se usa em dev.
- **Dependência que ninguém importa ainda pode ser obrigatória**: ao limpar o `package.json` do servidor, tirar `@colyseus/redis-driver` e `@colyseus/redis-presence` passou no typecheck e quebrou no boot — o pacote `colyseus` faz `require()` deles no topo do próprio `index.js`, não de forma preguiçosa. Só dá pra descobrir isso **subindo o servidor**; typecheck e build passam numerinho.
- **Hibernação mata WebSocket**: na Railway o modo "serverless" derrubava conexão no meio da corrida. No Fly.io o `fly.toml` fica com `auto_stop_machines = false` e `min_machines_running = 1` de propósito.
- O client precisa da env var `VITE_SERVER_URL` em produção porque client (Vercel) e servidor (Fly) ficam em domínios diferentes. Sem ela, o fallback aponta pro mesmo host na porta 2567, o que só serve em dev/rede local.
