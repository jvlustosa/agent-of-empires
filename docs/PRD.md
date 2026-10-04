# PRD do Agent of Empires

Plano de produto: o que está sendo construído, por quê, e em que pé está. O guia da interface fica
no [Manual](MANUAL.pt-BR.md); requisitos e instalação, no [README](../README.md).

## Iniciativa: modelos 3D prontos na vista 3D

Atualizada em 2026-10-03.

### Problema

A vista 3D desenha tudo com primitivas (caixas, prismas, cones e cúpulas em cor chapada). Funciona,
mas parece montada com blocos. O visual de Age of Empires e Ragnarok Online vem de textura e
silhueta: prédios com detalhe (madeira, pedra, telhas, estandartes) e luz que conta a história.

### Objetivo

Trocar os elementos da vista 3D por modelos prontos da web, sem perder o que o mapa já faz: cor do
time, eras, estilos, formatos e tamanhos do castelo, animações (bandeiras, relógio, fogo, janelas
acesas à noite) e os pontos onde os aldeões trabalham.

### Regras

- **Só licença livre de verdade**: CC0 (ou CC-BY com crédito no README). O repositório é público.
  Nada extraído do Age of Empires (Microsoft) nem do Ragnarok (Gravity): o estilo pode lembrar, os
  arquivos não.
- **Tudo local**: os modelos ficam em `src/models/` e vão com o app. A CSP do Tauri
  (`default-src 'self'`) não deixa buscar nada fora, e o app funciona offline.
- **Leve**: só entram as peças usadas; kits low-poly pintados por uma paleta pequena (nada de
  texturas PBR nem normal maps); paletas desenhadas pequenas e sem mipmaps; peças de um mesmo prédio
  fundidas numa malha só, para não multiplicar draw calls.
- **Nunca quebra o mapa**: os modelos carregam em segundo plano. Até chegarem, ou se um faltar, o
  mapa desenha a versão procedural de antes.
- **O castelo continua paramétrico**: ele não vira um modelo fixo, porque perderia as 10 × 5 × 5 × 4
  combinações de estilo, era, formato e tamanho. Modelos entram como peças dentro da montagem atual.

### Como funciona

- `src/js/models.js` carrega os dois kits com o `GLTFLoader` (vendorizado em
  `src/vendor/three/addons/`, com o import `'three'` trocado por caminho relativo, porque a CSP
  bloqueia import map inline) e expõe `modelParts(nome, pintura)` → `{ geometry, material }`. Cada
  modelo vira uma geometria só (a porta do Kenney é uma segunda malha, fundida na carga), sem
  tangentes.
- Os dois kits pintam tudo por uma textura de paleta: uma grade de células em degradê (8 × 4 no
  KayKit, 16 × 4 no Kenney). Repintar uma célula muda a cor de tudo que a usa. KayKit: a célula azul
  (coluna 0 da linha de baixo) é a cor do time, em estandartes e telhados. Kenney: (3,2) é o reboco
  (cor da parede do estilo), (9,3) os montantes e molduras (madeira do estilo), (11,3) as tábuas e a
  porta, (3,3) o telhado (cor do time). Assim os 10 estilos mantêm as cores de antes e qualquer cor
  de time funciona.
- Cada pintura gera um material com a paleta desenhada pequena (256² no KayKit, 128² no Kenney) e
  sem mipmaps: os modelos amostram o meio das células, então nada sangra. As texturas originais
  (1024² e 512²) são descartadas sem subir para a GPU.
- Quando os modelos chegam, o `World3D` refaz o cenário, as bases e a prévia do diálogo
  (`markStatic`, chave das bases e da prévia zeradas).

### Etapas

| Etapa | Escopo | Fonte | Status |
|---|---|---|---|
| 1 | Mina de ouro, forja e árvores | KayKit Medieval Hexagon Pack (CC0) | **Concluída** em 2026-10-03 |
| 2 | Castelo por peças: paredes com porta e janelas, telhados de duas águas | Kenney Fantasy Town Kit (CC0) | **Concluída** em 2026-10-03 |
| 3 | Demais elementos: torres de canto do castelo, muralhas, chaminés, rochas, sino, praça (poço, mercado, carroça) | KayKit (rochas, poço, mercado), Kenney Fantasy Town e Castle Kit (CC0) | A fazer |
| 4 | Opcional: visual pintado à mão estilo Ragnarok; sprites pré-renderizados do 3D para as vistas 2D e ISO, como fazia o AoE II | Sketchfab (licença por modelo) ou geração (Hunyuan3D, Hyper3D) | Ideia |
| 5 | Aldeões animados no lugar dos bonecos de primitivas | KayKit Adventurers (CC0) | **Concluída** em 2026-10-03, corrigida em 2026-10-04 (CSP) |
| 6 | Montados: o Batedor e o batedor do claude-mem a cavalo | Quaternius, cavalo do Ultimate Animated Animal Pack (CC0) | **Concluída** em 2026-10-04 |

#### Etapa 1 (concluída)

- **Mina**: `building_mine` (rochedo com entrada, trilhos e carrinho), escala 16, frente para o
  pátio; estandartes na cor do time; pepitas de ouro ao pé da rocha, longe dos trilhos.
- **Forja**: `building_blacksmith` (casa com forno de cúpula e chaminé), escala 20; telhado na cor do
  time; o fogo pulsante e a luz da forja ficam na boca do forno (célula laranja da paleta, em
  x 0,07 a 0,35, y 0,07 a 0,38, z 0,36 nas unidades do modelo).
- **Árvores**: `tree_single_A` (pinheiro) e `tree_single_B` (abeto) alternados, um `InstancedMesh`
  para cada, escala 15, com uma leve variação de tom por árvore. Arbustos e pedras continuam
  procedurais (etapa 3).
- Os modelos somam 240 KB (glTF + bin + uma paleta PNG de 16 KB).

Critérios de aceite, todos verificados no Chrome headless com o app real e um backend Tauri falso:

- [x] Mina e forja respeitam os pontos de trabalho (mineiros em z 41 a 47, ferreiros em z 44 a 50):
  ninguém atravessa modelo.
- [x] Cor do time certa por base (verde, laranja e amarelo lado a lado).
- [x] Noite: a boca do forno brilha e ilumina o pátio.
- [x] Sem a pasta de modelos: `[models]` no console, mapa procedural, nada quebra.

#### Etapa 2 (concluída)

Decisão de fonte: o plano era o Quaternius Medieval Village MegaKit, trocado pelo Kenney Fantasy
Town Kit pela regra de leveza. O MegaKit tem 59 MB de glTF e 37 MB de texturas PBR, um único pedaço
de parede puxa 6 texturas (cerca de 8 MB, com normal maps) e o telhado 6 × 8 tem 2.749 vértices; o
visual semirrealista também destoaria do KayKit. O Kenney inteiro tem 2,8 MB, peças de 5 a 31 KB
(64 a 516 vértices) e uma paleta de 11 KB, no mesmo estilo low-poly.

- **Paredes** (`kitWalls`): as quatro faces do corpo em azulejos de peças de 1 unidade, mais ou
  menos tão largos quanto altos e em número ímpar, para porta e janelas ficarem centradas. Porta em
  arco no meio da frente; janelas um azulejo sim, outro não; formato alto ganha uma segunda fileira,
  com janela sobre a porta. Reboco nas cores do estilo; tábuas para a cabana da era 1 (menos Morroc)
  e para Umbala, que deixa de usar as toras procedurais. Todas as peças de um castelo são fundidas
  numa malha só.
- **Janelas acesas**: no kit, as vidraças são furos na parede. Atrás de cada abertura vai uma placa
  escura, todas fundidas numa malha `isWindow`, que acende à noite como antes.
- **Telhados**: o `gable()` usa a peça `roof-gable` (cumeeira girada para correr de frente para
  trás) esticada ao tamanho pedido. Os telhados principais (Prontera, Aldebaran, Alberta, Lutie, o
  frontão de Juno, a palha de Umbala) recebem a pintura do corpo, então o oitão sai na cor da parede e
  o beiral na madeira do estilo. Neve de Lutie, cumeeira de Umbala e o telhado do poço da praça saem
  inteiros na sua cor.
- **Ficam procedurais**: os telhados de cone, pagode, cúpula e dente de serra (Geffen, Payon,
  Morroc, Einbroch), as torres de canto e os detalhes de cada estilo (cristal, relógio, farol, árvore,
  chaminés, engrenagem); a prévia do diálogo de personalização passa a usar as peças também.
- Peso: 132 KB em disco (7 peças e a paleta). Por castelo, 2 draw calls para paredes e vidraças
  (antes, de 7 a 10 caixas) e cerca de 3 mil vértices; cada pintura, uma paleta de 64 KB na GPU. A
  paleta do KayKit, que na etapa 1 era copiada em 1024² por time (cerca de 5,6 MB na GPU cada),
  passou a 256² sem mipmaps (256 KB).

Critérios de aceite, verificados no Chrome headless com o app real e um backend Tauri falso:

- [x] Os 10 estilos com as peças, de dia, inclusive formatos comprido, alto e baixo, a cabana da
  era 1 e a era 5 colossal.
- [x] Noite: vidraças acesas.
- [x] Sem os modelos: `[models]` no console, castelo procedural como antes, nada quebra.

#### Etapa 3 (a fazer)

- Torres de canto do castelo e muralhas (tamanhos Grande e Colossal): peças de torre e muralha do
  Kenney (Castle Kit) ou do KayKit, sem perder o topo de cada estilo nem a bandeira.
- Chaminé de Prontera e Lutie (`chimney` do Fantasy Town Kit), rochas e poço do KayKit, sino.
- Mesma regra: só as peças usadas, fundidas por prédio.

#### Etapa 5 (concluída)

Os aldeões do 3D eram bonecos de primitivas (cápsula, esferas e caixas). Agora são personagens do
KayKit Adventurers, do mesmo autor da mina e da forja, em proporção chibi como os do Ragnarok.

- **Corte**: o pacote traz, em cada personagem, armas, escudos e 76 animações (3,6 MB por arquivo).
  `scripts/trim-villagers.mjs` (glTF Transform) guarda só o corpo, a capa e o chapéu; funde corpo e
  capa numa malha com esqueleto, o chapéu em outra; e quantiza os vértices. As 9 animações usadas vão
  uma vez só, num arquivo à parte, sem os canais que nunca saem do repouso. Ficaram cavaleiro,
  bárbaro, mago e ladina, de 120 a 145 KB cada, mais a paleta de cada um (15 KB) e 188 KB de
  animações: 790 KB em `src/models/kaykit-adventurers/`.
- **A paleta vai fora do `.glb`** (corrigido em 2026-10-04): no app, os aldeões continuavam de
  blocos. A CSP do Tauri (`default-src 'self'`, `img-src 'self' data:`) bloqueia as URLs `blob:` pelas
  quais o GLTFLoader lê imagens embutidas; sem a textura, o carregamento quebrava e o mapa ficava no
  boneco antigo. Nos testes no Chrome não havia CSP. Agora a paleta de cada personagem é um PNG ao
  lado do modelo, lido como as dos outros kits, e o teste no Chrome roda com a mesma CSP do app.
- **Visual**: personagem, chapéu e cores seguem o `look` do aldeão, o mesmo do 2D. Túnica e capa
  (e o chapéu do mago) ficam na cor do time; pele e cabelo são repintados na paleta de cada
  personagem, como nos prédios. Metade usa chapéu (elmo, gorro de urso, chapéu de mago). O cavaleiro
  leva a cor do time nos frisos da armadura e na capa. Com ids de sessão reais (UUID), os quatro
  saem na mesma proporção.
- **Animação**: cada pose é um clipe tocado no instante que os relógios do mapa mandam. O passo
  segue o `walkClock` do 2D e o golpe segue o período de cada frente, então as lascas saem no
  instante do golpe. Andar: `Walking_A`; parado: `Idle`; fogueira: `Sit_Chair_Idle`; picareta:
  `2H_Melee_Attack_Chop`; martelo: `1H_Melee_Attack_Chop`; luneta e pensar: `Use_Item` parado com a
  mão no rosto; pergaminho: `2H_Ranged_Aiming`; delegar: `1H_Ranged_Aiming`, apontando; pendurado
  pelo mouse: `Running_A`, pedalando no ar. A troca de clipe leva 0,15 s. O aceno é feito em código
  por cima do clipe: braço aberto para o lado e antebraço acenando, os dois quando travado, também
  sentado. O clipe de comemorar do pacote não servia, porque a mão ficava atrás da cabeça grande.
- **Ferramentas**: picareta, martelo, luneta e pergaminho continuam desenhados em código, presos aos
  ossos (mão direita, cabeça, peito).
- **Custo**: 1 draw call por aldeão (2 com chapéu), contra cerca de 10 do boneco antigo. Com 8
  aldeões e sombras, 23 draw calls em vez de 153; em troca, cerca de 4 mil triângulos por aldeão em
  vez de mil. Cada combinação de personagem, time, pele e cabelo pinta uma paleta de 128² (64 KB na
  GPU). Cada esqueleto tem uma textura de ossos pequena, liberada quando o aldeão sai.
- **Ficam procedurais**: o batedor a cavalo e os soldados (subagentes).

Critérios de aceite, verificados no Chrome headless com o app real e um backend Tauri falso, e
numa vitrine que roda o código do `World3D` pose a pose:

- [x] Todas as poses: mina (ouro no golpe), forja, obra, torre, Centro da Cidade (escrever, pensar,
  delegar), espera (aceno com um braço, dois quando travado), sentado, andando, pendurado.
- [x] Cor do time, pele e cabelo variam por aldeão.
- [x] Noite: a luz da forja ilumina os aldeões.
- [x] Sem a pasta: `[models]` no console, aldeões de primitivas como antes, nada quebra.
- [x] Com a CSP do app (`tauri.conf.json`) na página de teste, os modelos carregam sem erro.

#### Etapa 6 (concluída)

O Batedor (o herói das missões, ver [PRD do Batedor](PRD-batedor.md)) e o batedor do claude-mem
eram cavalos de caixas com um cavaleiro de cápsula.

- **Cavalo**: o cavalo branco do Quaternius (Poly Pizza, CC0): 4.400 vértices, sete peças de cor
  chapada. `scripts/trim-horse.mjs` guarda 4 das 26 animações (parado, passo, galope e pastando; o
  pacote traz cada uma duas vezes), funde as peças numa malha só e dá a cada peça uma célula de uma
  paleta que o `models.js` desenha, então a pelagem vem do `look.horse` do 2D (branco, castanho,
  preto) com 1 draw call. De 1,1 MB para 232 KB, em `src/models/quaternius/`, sem imagem embutida.
- **Cavaleiro**: o mesmo KayKit dos aldeões. O Batedor é o cavaleiro de elmo, a armadura na cor do
  nível e tabardo e capa berinjela; o do claude-mem é o personagem do seu `look`. Ele vai preso ao
  osso do tronco do cavalo, então balança com o galope. Não há clipe de montar: é o `Idle` com as
  pernas abertas em volta do lombo, feitas em código como o aceno.
- **Animação**: galope no passo do 2D (o `walkClock`), parado ou pastando 6 s a cada 14 s, e galope no
  ar quando pego pelo mouse.
- **Batedor**: manta berinjela com barra dourada presa ao tronco do cavalo; lança com a flâmula do
  Slack, escudo e penacho presos aos ossos do cavaleiro; aura e pergaminho como antes. Sem os
  modelos, as primitivas de antes.
- **Escala**: cavalo × 4,2, cavaleiro na escala dos aldeões (× 6,5).

Critérios de aceite, verificados no Chrome headless com o app real, a CSP do app e um backend falso,
e na vitrine pose a pose:

- [x] Herói parado, galopando e pastando; batedores branco, castanho e preto.
- [x] Os dois montados no mapa, perto da fogueira.

### Como validar

O app depende do Tauri para os dados. Para conferir a vista 3D, sirva `src/` com um `__TAURI__`
falso que devolva um snapshot com agentes em duas ou três bases (fixe as bases no meio do mapa pelo
`cpo.empireLayout` do localStorage) e fotografe com
`google-chrome-stable --headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --screenshot`.
Um relógio falso (meio-dia ou 21h) mostra dia e noite.

## Iniciativa: galeria de repositórios no Novo agente

Atualizada em 2026-10-03.

### Problema

A escolha do projeto no "Novo agente" era uma lista de nomes. Com 40 repositórios ou mais, nomes
parecidos (chat-juridico-ui, chat-juridico-admin…) não dizem o que cada um é, e o mapa já dá a cada
repositório uma identidade visual que a lista não mostrava.

### Como funciona

- **Galeria**: um card por repositório com o Centro da Cidade desenhado como no mapa (mesma era,
  estilo, forma e cor, em pixel art 2D, mesmo com o mapa em 3D), o nome, a atividade recente e o
  selo de agentes por cima do desenho.
- **Prévia** do escolhido, ao lado: resumo do README, o que ele usa, branch, arquivos alterados sem
  commit, último commit e quantos arquivos o git acompanha. Vem do comando `project_preview`, que só
  aceita pastas da própria lista de projetos (como o `deploy_agent`) e lê só o começo do README
  (16 KB).
- **Leve**: os desenhos saem uma vez por abertura do painel; a prévia é lida só para o repositório
  escolhido e guardada até fechar.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Galeria com o Centro da Cidade e prévia (README, stack, git) | **Concluída** em 2026-10-03 |
| 2 | Imagem do próprio repositório quando houver (screenshot ou og:image) | Ideia: poucos repositórios têm uma, e a CSP só aceita `data:` |


## Iniciativa: espera separada do trabalho na base

Atualizada em 2026-10-03.

### Problema

Quem espera você (sua vez ou travado numa pergunta) já saía do grupo em frente ao Centro da Cidade
para a fila de espera, mas a fila ficava colada nele, na mesma linha e no mesmo chão de terra. De
longe virava um grupo só, e não dava para ver de relance quantos estavam esperando.

### Como funciona

- **Cercado de espera** à esquerda da porta, embaixo do sino: piso de pedra (o mesmo da praça) e
  cerca baixa de madeira do lado do Centro da Cidade e na frente. O lado do pátio fica aberto, então
  o aldeão entra e sai pelo caminho de sempre, sem atravessar a cerca.
- As 10 vagas de espera ficam todas dentro do cercado, em duas fileiras; o chão de terra de quem
  trabalha agora começa depois da cerca.
- **Leve**: o piso é pintado na textura do chão que já existia (nenhuma malha a mais) e a cerca é
  uma geometria só, de ~20 caixas, compartilhada por todas as bases (uma chamada de desenho por
  base). No 2D e no ISO, a cerca é desenhada em blocos, como as muralhas.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Cercado com piso e cerca no 2D, ISO e 3D, vagas de espera dentro dele | **Concluída** em 2026-10-03 |

## Iniciativa: treinar aldeões na hora e vários de uma vez

Atualizada em 2026-10-03.

### Problema

Treinar um aldeão sempre passava pelo card do Centro da Cidade, e o card treinava um por vez. Para
pôr três agentes no mesmo repositório era preciso abrir o card três vezes. O clique direito na base
só levava ao mesmo card.

### Como funciona

- **Clique direito na base**: o menu abre com o campo "Treinar aldeão" já focado. Tarefa e Enter, e
  o aldeão sai no modo padrão de todo agente novo (Cursor). Logo abaixo, "Personalizar treino…" abre
  o card (onde ele roda e vários de uma vez). O "Personalizar…" da base passou a "Personalizar
  base…", para os dois não se confundirem.
- **Clique no Centro da Cidade**: o card ganhou uma fila de treino, como a do AoE. "+ Mais um aldeão"
  (ou Shift+Enter) põe outra linha, até 5; cada linha escrita vira uma sessão própria, no modo
  escolhido, e elas sobem uma depois da outra (o Cursor foca a janela a cada uma).
- **Decisão**: uma tarefa por aldeão, não a mesma tarefa repetida N vezes. Repetir a tarefa
  duplicaria o trabalho e poria os agentes no mesmo arquivo (o mapa já mostra esse conflito com
  espadas cruzadas).

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Campo de treino no clique direito, fila de até 5 no card | **Concluída** em 2026-10-03, sem teste no app real |

## Iniciativa: dimensões livres do Centro da Cidade

Atualizada em 2026-10-03.

### Problema

O Centro da Cidade só mudava de medida por opções fixas: 5 formatos (proporções) e 4 tamanhos na
vista 3D. Não dava para deixar o prédio um pouco mais largo, mais raso ou mais alto do que o formato
escolhido.

### Como funciona

- **Personalizar base › Dimensões (3D)**: três controles deslizantes em % do que o formato dá
  (100% = como está). Largura e profundidade de 70% a 130%, altura das paredes de 70% a 160%, de 5
  em 5. A prévia 3D acompanha enquanto arrasta; "Voltar ao formato" põe os três em 100%.
- **Decisões**: só o Centro da Cidade e só na vista 3D (como tamanho e giro); a altura do telhado
  segue o formato. Os controles mexem por cima do formato e do tamanho, não os substituem.
- **Limite**: largura e profundidade nunca passam do maior castelo que os tamanhos já constroem
  (era Imperial, Colossal), levando em conta o giro. Assim o prédio não invade a mina, a forja nem
  os aldeões que martelam a parede. Paredes nunca ficam abaixo de 6 unidades, mais altas que um
  aldeão. Acima de 150% da altura da era, as paredes ganham a segunda fileira de janelas.
- **Giro**: o castelo girado agora se posiciona pela medida que fica de frente para o pátio. Antes
  usava sempre a profundidade, e um castelo girado mais largo que fundo avançava sobre o pátio.
- Guardado no layout (`designs[repo].width/depth/height`), só quando diferente de 100.
- **Leve**: sem malha nova. Mexer no controle reconstrói só a prévia, e as geometrias que cada
  reconstrução cria (inclusive as paredes do kit fundidas, que antes ficavam para trás ao
  redimensionar o terreno) agora são liberadas.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Largura, profundidade e altura das paredes no 3D, com prévia ao vivo | **Concluída** em 2026-10-03, verificada no Chrome headless com o app real e backend Tauri falso |
| 2 | Opcional: refletir largura e altura no 2D e no ISO (o desenho cabe numa caixa de 40 × 36) | Ideia |

## Iniciativa: push e merge à vista no mapa

Atualizada em 2026-10-03.

### Problema

Quando um agente publicava código (push) ou juntava branches (merge), o mapa mostrava só o balão
genérico de terminal, igual a um `ls`. Uma das ações mais importantes da sessão passava batido.

### Como funciona

- O backend lê o transcript e reconhece `git push`, `git merge` e `gh pr merge`, inclusive no meio
  de uma cadeia (`git merge x && git push`) e os feitos por subagentes. Só conta o comando que deu
  certo: push recusado ou negado não vira festa. Texto entre aspas (mensagem de commit que fala em
  "git push") não conta, nem `--dry-run` ou `git merge --abort`.
- O aldeão reage com um emote em letras, no estilo dos outros: **PUSH** em azul com setas subindo,
  **MERGE** em roxo com brilhos. Pula duas vezes na hora e de novo a cada 6 s.
- **Fica no ar por 10 min**, em loop. Os emotes de rotina (fim de turno, espera) não o derrubam; só
  o que é mais urgente: travou numa pergunta ou aprovação, outro agente mexeu no mesmo arquivo, você
  mandou tarefa nova ou veio outro push/merge.
- Abriu o mapa depois do push? Se ainda está dentro dos 10 min, o emote aparece com o tempo que
  sobra.
- **Leve**: nenhuma requisição a mais, o evento vem no snapshot que já existe; no 3D, 8 texturas
  por emote, geradas uma vez.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Detecção no backend, emotes PUSH e MERGE no 2D, ISO e 3D | **Concluída** em 2026-10-03, com testes do backend; sem teste no app real |

## Iniciativa: git e branch à vista no mapa

Atualizada em 2026-10-04.

### Problema

Push e merge já viravam festa, mas o resto do trabalho com git (status, diff, commit, checkout,
rebase, `gh pr create`) aparecia como terminal comum. E não dava para saber, olhando o mapa, se o
agente mexia na main ou numa branch própria.

### Como funciona

- **Atividade "No git"**: quando o comando Bash em andamento roda `git` ou `gh` (em qualquer ponto de
  uma cadeia, com `VAR=x` na frente ou caminho completo), a atividade vira `git` em vez de
  `terminal`. Usa o mesmo leitor de shell do push e merge: `echo "git push"` ou texto entre aspas não
  conta.
- O aldeão continua na **forja**, mas com balão de **forquilha laranja** (a cor do git, `#f05033`) no
  lugar do de terminal, no 2D, ISO e 3D. O chip do card diz "No git", e a etapa fica laranja na
  linha do tempo.
- **Branch**: o Claude Code grava `gitBranch` em cada linha do transcript; o backend guarda a última
  não vazia e manda no snapshot (`branch`). Se não é `main`, `master` nem `HEAD` (detached), o nome
  aparece em laranja com ícone de branch no card e no rótulo do aldeão (ao passar o mouse ou
  selecionar). Na main, nada muda.
- **Leve**: nenhuma requisição nem leitura de arquivo a mais (a branch vem do transcript que já é
  lido); um ícone 5 × 5 e um SVG embutido no CSS.
- Limite conhecido: a branch só muda quando o transcript ganha uma linha nova. Trocar de branch na
  mão com a sessão parada só aparece no próximo turno.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Atividade `git` (balão, chip, linha do tempo) e branch no card e no rótulo | **Concluída** em 2026-10-04, com testes do backend e verificada no Chrome headless com o app real e backend Tauri falso (2D e 3D; o ISO usa o mesmo desenho do 2D) |
| 2 | Opcional: marca da branch visível no mapa sem passar o mouse (bandeirinha no aldeão) | Ideia |

## Iniciativa: pegar um aldeão com o mouse

Atualizada em 2026-10-03.

### Problema

Segurar um aldeão e arrastar não fazia nada: o mapa só respondia a clique (selecionar) e a ordens.
A ideia é poder brincar com os aldeões, com reação de verdade, sem mexer no trabalho deles.

### Como funciona

- Segurar o botão esquerdo num aldeão (ou no batedor) e arrastar mais de 5 px pega a unidade.
  Clicar sem arrastar continua selecionando; o clique que vem depois de soltar é ignorado. Os
  soldados (subagentes) não são pegos.
- **Só para mostrar**: nada vai ao backend, nenhuma ordem sai, a sessão não sabe, a seleção não
  muda. Enquanto está na mão, o aldeão não pensa nem anda; balões e emotes de espera seguem.
- Na mão: sobe 8 px em 140 ms, pendurado pela cabeça sob o ponteiro, esperneando e agitando o braço
  (no 3D, os dois braços, de frente para a câmera). Balança como um pêndulo puxado pela velocidade
  lateral do ponteiro e volta com mola. A sombra fica no chão, embaixo dele.
- Fica por cima de tudo, porque está na mão: no 2D é desenhado por último; no 3D é desenhado de
  novo sobre o quadro pronto (camada própria, depth limpo), só enquanto há alguém no ar.
- Ao soltar: cai com gravidade, quica uma vez, toma fôlego por 350 ms e volta andando até onde foi
  pego, seguindo a viagem que fazia. Se a viagem mudou enquanto estava na mão (sessão acabou,
  mandado para outra base), refaz o caminho a partir de onde caiu.
- No 2D o balanço não gira a pixel art, que ficaria borrada: o sprite é desenhado num canvas pequeno
  e copiado linha a linha, cada linha deslocada em pixels inteiros.
- **Leve**: nenhuma requisição e nenhum asset; um canvas de 32 × 40 reaproveitado no 2D e uma
  passada extra de render no 3D só com aldeão no ar.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Pegar, balançar, soltar e voltar ao trabalho no 2D, ISO e 3D | **Concluída** em 2026-10-03, verificada no WebKitGTK com backend falso |

## Iniciativa: trilha lo-fi com faixa pulável

Atualizada em 2026-10-04.

### Problema

A trilha eram só os cinco temas da vila, sempre na mesma ordem e sem como pular. Para quem deixa o
app aberto o dia todo ao lado do Claude Code, faltava variedade e música de fundo para trabalhar.

### Como funciona

- **Dois estilos** em Configurações › Som: **Lo-fi** (padrão) e **Temas da vila** (os cinco temas
  no clima de Ragnarok). A escolha fica salva.
- **Seis faixas lo-fi originais**, compostas como notas em `src-tauri/src/music.rs`, como os temas:
  cada uma com tom, andamento (68 a 88 bpm), swing e instrumento de melodia próprios. Instrumentos
  novos no sintetizador: piano elétrico (Rhodes, por modulação de fase, com tremolo), vibrafone,
  caixa e chimbal; o bumbo e o aro reaproveitam o "dum" e o "tek" do darbuka. Acordes com 9ª
  (`m9`, `maj9`, `9`, `7b9`), com a 9ª soando em cima do acorde.
- **Som de fita** só no lo-fi: afinação que ondula (wow e flutter), agudos cortados em 5 kHz, notas
  até 6 ms fora da grade, chiado e estalos de vinil. A bateria entra depois de dois compassos.
- **Mixagem medida**: Rhodes ~33%, baixo ~28%, melodia 15 a 40% da energia; pico abaixo de 0,35
  com o volume em 100%.
- **Pular**: botão **Próxima ⏭** sob o volume e tecla **M** no mapa. O nome da faixa aparece ao
  lado (evento `music_track`; `get_music_track` cobre o recarregar com F5). Cada estilo começa por
  uma faixa diferente a cada vez.
- **Liga e desliga no mapa**: a nota ♪ no canto superior direito (fim dos controles do mapa) é o
  mesmo interruptor de Configurações › Som; desligada, fica apagada e riscada de vermelho.
- **Leve**: nenhum arquivo de áudio no repositório. Cada faixa é sintetizada na primeira vez que
  toca (cerca de 1 s em release) e gravada como WAV no diretório de runtime; gravada à parte e
  renomeada, para que pulos rápidos nunca toquem um arquivo pela metade.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Estilos, seis faixas lo-fi, Próxima e tecla M | **Concluída** em 2026-10-03, com testes do backend; sem teste no app real |
| 2 | Nota ♪ no canto superior direito do mapa liga e desliga a trilha (o mesmo interruptor de Configurações › Som) | **Concluída** em 2026-10-04, conferida no Chrome headless nos dois estados; sem teste no app real |

## Iniciativa: o Batedor, guerreiro líder da aldeia

Atualizada em 2026-10-03. Tem PRD próprio: [PRD do Batedor](PRD-batedor.md).

Um cavaleiro com o logo do Slack no escudo lê as fontes com que foi equipado (Slack, Gmail, Notion,
pelos conectores da conta do Claude), traz missões prontas para as bases e ganha experiência com o
tempo. Só lê; nenhuma missão começa sem o usuário treinar o aldeão.

| Etapa | Escopo | Status |
|---|---|---|
| 1 a 4 | Ronda, missões, cavaleiro no mapa com aura, equipamento (conectores, skills, rotinas), diário e níveis | **Concluídas** em 2026-10-03; falta a ronda de verdade no app |
| 5 | Prestar contas: acompanhar o aldeão e deixar o rascunho de resposta na thread de origem | Proposta |

## Iniciativa: comandar pelo celular

Atualizada em 2026-10-03.

### Problema

Longe do computador, um agente parado esperando aprovação ou resposta fica parado até você voltar.
O app não tinha nenhuma entrada de rede: só o socket Unix local dos pedidos de aprovação.

### Decisão de canal

Página web servida pelo próprio app na rede de casa (e no Tailscale), pareada por QR code. As
alternativas ficaram de fora: o bot do Telegram passaria nomes de repositório, comandos e trechos
dos pedidos pelos servidores do Telegram; o Remote Control do Claude controla só sessões abertas
com `--remote-control`, não o mapa, e deixa de fora os agentes que o app hospeda (modo `-p`).

### Como funciona

- **Painel Celular**: botão com ícone de celular no topo da sidebar (verde, com um ponto, quando
  ligado). Liga e desliga, mostra o QR code, a rede (Wi-Fi, cabo ou Tailscale, quando há mais de
  uma), se o celular está conectado, Copiar link e Trocar o código.
- **No celular**: quem precisa de você (Aprovar / Negar, perguntas com opções), os agentes por
  urgência, Responder para os agentes que rodam no app na vez deles, e "+ Novo agente" (projeto da
  lista e tarefa; roda "aqui no app"). Atualiza a cada 2 s com a página aberta e para quando ela
  vai para o fundo; vibra quando chega pedido novo.
- **Servidor** (`src-tauri/src/phone.rs`): HTTP/1.1 sem dependência nova, uma requisição por
  conexão, na porta 47380 (outra livre se ocupada, guardada para o QR valer depois de reiniciar).
  Volta a servir ao abrir o app se estava ligado. A página fica em `src/mobile/` e vai embutida no
  binário, junto com `kinds.js` e a fonte.
- **QR code** desenhado no próprio app (`src/js/qr.js`, modo byte, correção M, versões 1 a 10),
  porque a CSP não deixa buscar nada fora.

### Regras de segurança

- Desligado por padrão; desligar fecha a porta na hora.
- Só responde a endereços privados (10/8, 172.16/12, 192.168/16), Tailscale (100.64/10) e
  localhost; o resto cai sem resposta. IPv4 apenas.
- Código de pareamento de 256 bits, em `phone.json` (0600). Vai no `#fragmento` do link, que o
  navegador nunca envia; a página guarda e manda como `Authorization: Bearer`. Comparação em tempo
  constante; código errado espera 400 ms. Trocar o código derruba o celular pareado.
- O celular só faz o que o painel já faz: aprovar ou negar (nunca "Responder no Cursor"), mandar o
  próximo turno a um agente hospedado e criar agente só em pasta da lista de projetos. O estado
  enviado não leva pid, pasta nem arquivos editados.
- Limites: 16 conexões ao mesmo tempo, 5 s de leitura, 16 KB de cabeçalho, 64 KB de corpo,
  4000 caracteres por mensagem. Página com CSP `default-src 'none'`, `nosniff`, `no-referrer`.
- HTTP sem TLS: na rede local o tráfego (e o código) pode ser lido por quem está na mesma rede. O
  painel avisa para usar Wi-Fi público só pelo Tailscale, que criptografa.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Painel na sidebar com QR, servidor local, página do celular com aprovações, respostas e novo agente | **Concluída** em 2026-10-03, com testes do backend e das duas telas no Chrome headless com backend falso; falta testar num celular de verdade |
| 2 | Avisos com a página fechada (push precisa de HTTPS; alternativa: ntfy no Tailscale) | Ideia |
| 3 | HTTPS pelo `tailscale serve`, para tirar o aviso de rede aberta | Ideia |

### Como validar

- `cargo test phone::` cobre a lista de endereços aceitos, as interfaces oferecidas, o código e o
  leitor HTTP (corpo grande, cabeçalho cortado, corpo curto).
- Página do celular: um servidor Node falso com as mesmas rotas serve `src/mobile/`; o Chrome
  headless em 390 px abre `/#t=<código>`, e um script toca Aprovar, responde a pergunta, manda uma
  resposta e cria um agente. O servidor confere o corpo de cada POST.
- Painel: `src/` servido com um `__TAURI__` falso; o `zbarimg` lê o QR direto da captura de tela e
  tem de devolver o link com o código.

## Iniciativa: muralha em volta da aldeia

Atualizada em 2026-10-04.

### Problema

A borda do mapa abria como floresta, e mesmo com a muralha ligada o 3D seguia com mata do lado de
fora. O pedido: em volta da aldeia, muralha, não árvores, e com cara de mais segura.

### Como funciona

- **Muralha é o padrão** de Configurações › Exibição › Borda do mapa; Floresta segue como opção.
  A escolha agora é salva como `mapEdge: 'wall' | 'forest'`; mapas salvos antes (com
  `hasBorderWall: false`, quando a floresta era o padrão) abrem com a muralha.
- **Sem árvores do lado de fora**: com a muralha, o 3D não planta a mata nos morros em volta (as
  520 árvores de fundo saem); fora dela fica campo aberto.
- **Mais segura, nas três vistas**: uma torre a cada 70 px de muro (eram 110) e um portão mais
  largo, com as torres livres da estrada.
- **Mais segura, no 3D**: muro de 17 de altura e 6 de espessura (eram 12 e 4) sobre um rodapé mais
  largo, ameias maiores, torres de 28 (eram 22). O portão vira casa de portão: as duas torres da
  estrada 35% mais altas, uma passarela com ameias entre elas a 24 do chão (o Batedor a cavalo
  passa por baixo) e a grade levadiça erguida na face de fora.
- **Leve**: muros, rodapés e passarela fundidos numa malha só; ameias, torres, telhados e grade
  instanciados. A muralha inteira custa 5 draw calls (eram 8), e a mata de fundo some.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Muralha como padrão, sem mata do lado de fora, muro reforçado e casa de portão no 3D | **Concluída** em 2026-10-04, verificada no Chrome headless com backend falso nas vistas 3D, 2D e ISO |
| 2 | Casa de portão também no 2D e no ISO (passarela entre as torres) | Ideia |

## Iniciativa: terreno redimensionável, com a base se adaptando

Atualizada em 2026-10-04.

### Problema

O terreno de uma base já crescia arrastando a borda (até três lotes para cada lado), e a terra extra
virava muralha e vila. Mas o Centro da Cidade ficava do tamanho de uma base nova (num terreno 3 × 3
ele sumia no meio da muralha), o terreno não diminuía abaixo de um lote, a muralha, os salões e as
torres se refaziam a cada pixel arrastado, e boa parte da terra nova ficava em grama vazia. O pedido:
redimensionar o terreno nos dois sentidos, com o prédio e o resto da base se adaptando, rearrumando
melhor e criando mais coisas.

### Como funciona: o Centro da Cidade cresce (etapa 1)

- **Quanto cresce**: `plot.js` mede quantos tamanhos de núcleo o terreno tem a mais (largura mais
  profundidade) e chega ao crescimento total por volta de três lotes para cada lado. 2 × 1 ou
  1 × 2 lotes dão cerca de 30%, 2 × 2 cerca de 55%. É contínuo e acompanha o arrasto ao vivo.
- **3D**: no crescimento total, paredes 60% e telhado 40% mais altos (as torres acompanham, e acima
  de 150% da altura da era vem o segundo andar de janelas), até o dobro da profundidade e até 30%
  mais largo. A frente fica no pátio: o prédio cresce para trás, para dentro da muralha.
- **2D e ISO**: o desenho ganha linhas e colunas inteiras, então o pixel art continua nítido.
  Paredes 60% e telhado 40% mais altos, torres na mesma medida, largura até 30% e o segundo andar
  de janelas acima de 150% da altura.
- **Limites**: a largura voltada para o pátio continua presa à do maior castelo (Imperial Colossal
  no 3D; no 2D, o imperial com torres, 48 px), então mina, forja, sino e os aldeões que martelam a
  parede ficam livres. Para trás, `plot.js` reserva até 36 px do pátio da muralha, sempre aquém da
  torre de menagem e dos salões, e afasta o poço (no mínimo 21 px do fundo do prédio). Sem muralha
  (terreno que só cresceu para os lados), o prédio fica mais alto e mais largo, mas não mais fundo.
- **Decisões**: só o Centro da Cidade cresce; mina, forja, pátio, rotas e pontos de trabalho dos
  aldeões não mudam (escalar a base inteira foi descartado por mexer em tudo isso). O crescimento
  soma por cima de porte, tamanho, formato e dimensões. A prévia de Personalizar e a visão geral
  mostram o prédio sem o crescimento, como numa base nova.
- **Leve**: nenhuma malha nem sprite novo, é o mesmo prédio paramétrico com outras medidas. O 3D só
  reconstrói a base quando o terreno muda, como antes.

### Como funciona: meio lote, base estável e vila mais cheia (etapa 2)

- **Meio lote**: o terreno diminui até 64 × 60. Mais estreito ou mais raso que um lote, a base usa um
  segundo arranjo de núcleo (`SMALL_CORE` em `empire.js`, medidas em `plot.js`): Centro da Cidade a
  80% no 2D e a 70% no 3D, mina e forja pequenas nos cantos (sprites novos de 14 px no 2D, os modelos
  a 50% no 3D), construtores na frente do prédio, um banco no lugar do cercado de espera, sem
  bandeira e sem as muralhas de Grande e Colossal. A placa com o nome fica acima do terreno. O
  arranjo vale por base (`layoutOf`), e tudo que antes lia posições fixas (aldeões, rotas, portão,
  sino, maravilhas, luzes, cliques, fantasma ao mover, 3D) passou a ler o da base.
- **Troca de arranjo**: ao cruzar o tamanho de um lote, o núcleo mantém o centro onde estava e os
  aldeões vão a pé para os lugares novos (antes só se mudavam quando o núcleo andava). O ímã do
  arrasto ganhou o meio lote.
- **Base estável**: a muralha cresce em degraus de 8 px; os salões do fundo nascem da torre de
  menagem para fora, os laterais do núcleo para cima, e as torres se espaçam a partir da ponta perto
  do núcleo (do meio, no muro do fundo). Crescendo para trás de 2 em 2 px, cada passo tirava do lugar
  36% do que estava de pé; agora tira 7% (quase só o muro do fundo, que anda com o terreno).
- **Vila mais cheia**: as rolagens que já davam casa, campo, celeiro e árvore continuam iguais (nada
  que existia some); a faixa que dava grama vazia agora dá palheiro, lenha, barraca de feira com
  toldo na cor do time, moinho com pás girando ou lagoa. Grama vazia caiu de 38% para 15% das
  rolagens; um terreno 3 × 3 passou de 69 para 97 coisas.
- **Leve**: os itens novos são primitivas pequenas no 3D (o moinho tem 4 pás num só grupo girando) e
  retângulos no 2D; nenhum modelo novo.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Centro da Cidade cresce com o terreno no 2D, ISO e 3D, com o pátio da muralha reservado | **Concluída** em 2026-10-04, verificada no Chrome headless com backend falso (terrenos 1 × 1, 3 × 1, 2 × 2 e 3 × 3, e um redimensionamento ao vivo de 1 × 1 para 3 × 3) nas vistas 3D, 2D e ISO, comparando com o código sem crescimento |
| 2 | Diminuir até meio lote com núcleo rearrumado, muralha e salões estáveis no arrasto, vila com 5 tipos novos | **Concluída** em 2026-10-04, verificada no Chrome headless com backend falso: arrasto de mouse de 1 lote para meio lote e de volta (2D e 3D, aldeões nos lugares certos), terrenos 64 × 60, 100 × 70 e 120 × 200 nas três vistas, sem erros na página; estabilidade e densidade medidas com script sobre o `plot.js` antigo e o novo |
| 3 | Opcional: aldeões sentados no banco do meio lote, como na fogueira da praça | Ideia |

## Iniciativa: custo dos tokens em preço de API

Atualizada em 2026-10-04.

### Problema

A barra de recursos e o topo da Visão do império davam o mesmo peso a cinco números, quando o que
importa no dia a dia é o ouro (commits) e os tokens. E os tokens não diziam quanto valem: o pedido
foi mostrar o uso de tokens num gráfico, quanto ele custaria pago por requisição na API do Claude e
quanto a assinatura está subsidiando.

### Como funciona

- **Foco em ouro e tokens**: a barra no canto do mapa mostra só ouro, tokens e população; o topo
  da Visão do império mostra ouro e tokens da semana em destaque. Madeira, comida e pedra continuam
  na tabela de bases.
- **Custo em API**: `empire.rs` lê o modelo de cada resposta no transcript e precifica pela tabela
  de preços de lista (platform.claude.com, outubro de 2026): entrada, saída, escrita de cache de
  5 min (1,25x a entrada) e de 1 h (2x), leitura de cache (o preço de cada modelo: 0,025x no Fable
  5.1, 0,05x no Opus 5.5, 0,1x nos outros) e o dobro em modo rápido. Cada resposta conta uma vez,
  como os tokens. Modelo desconhecido de uma família conhecida usa o preço atual da família;
  `<synthetic>` não custa nada. O custo sai por dia no `DayStats.costUsd`.
- **Assinatura**: `usage.rs` lê só `subscriptionType` e `rateLimitTier` das credenciais do Claude
  Code (nunca o token) e dá o preço de tabela: Pro US$ 20, Max 5x US$ 100, Max 20x US$ 200 por mês.
  Team e Enterprise ficam sem comparação (preço por contrato).
- **Na Visão do império**: seção "Tokens e custo · últimos 30 dias" logo abaixo dos totais, com
  três cartões (custo em API, assinatura, subsidiado e quantas vezes o que você paga), uma barra
  "você paga / subsidiado" e o gráfico diário em duas linhas, tokens e custo, cada uma na sua
  escala (sem eixo duplo). O gráfico da História ficou só com commits.
- **Decisões**: 30 dias contra um mês de assinatura, sem ratear. Só entram as sessões nos
  repositórios da pasta de repositórios, como o resto do império: as sessões de fundo de plugins
  (o observador do claude-mem tem 4,5 GB de transcripts) ficariam caras de ler e não são trabalho
  numa base, então o subsídio mostrado é um piso.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Barra e topo da Visão focados em ouro e tokens; custo em API por modelo, assinatura e subsídio com gráfico diário | **Concluída** em 2026-10-04, testes do Rust (preços por modelo, cache de 5 min e 1 h, modo rápido, plano) e contagem real desta máquina (US$ 3.138 em 30 dias contra US$ 100 do Max 5x); interface verificada no Chrome headless nos três casos (subsidiado, assinatura mais cara, plano desconhecido) |
