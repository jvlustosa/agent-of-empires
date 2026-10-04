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

Atualizada em 2026-10-03.

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
- **Leve**: nenhum arquivo de áudio no repositório. Cada faixa é sintetizada na primeira vez que
  toca (cerca de 1 s em release) e gravada como WAV no diretório de runtime; gravada à parte e
  renomeada, para que pulos rápidos nunca toquem um arquivo pela metade.

### Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Estilos, seis faixas lo-fi, Próxima e tecla M | **Concluída** em 2026-10-03, com testes do backend; sem teste no app real |
