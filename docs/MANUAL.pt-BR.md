# Manual do Agent of Empires

O guia completo da interface, em português como o app. Requisitos e instalação estão no
[README](../README.md).

App desktop (Tauri 2) que mostra, num mapa em pixel art no estilo Age of Empires, as sessões do
Claude Code abertas nesta máquina, em que repositório cada uma está e o que está fazendo agora.

- Cada **repositório é uma base** no mapa: Centro da Cidade com telhado e bandeira na cor do
  projeto, território tracejado, mina de ouro e forja em volta de um pátio (base compacta, para caber
  muitas). As bases ficam em **terra aberta**, onde você quiser, como no Age of Empires III (a terra
  tem oito bases de largura, começa com seis fileiras e cresce para baixo, sempre com duas fileiras
  inteiras livres abaixo da base mais baixa, para construir, mudar bases de lugar e para os recrutas). Estradas de terra saem sozinhas do portão de cada base até a estrada principal, que
  leva à **praça** (poço, mercado, fogueira e carroça de feno); base longe pega carona na estrada
  de uma vizinha. O que não é base nem estrada é campo aberto, com manchas de terra batida,
  árvores e pedras.
- **Suas bases**: os repositórios principais ficam **fixos** no mapa, no lugar que você escolheu,
  mesmo sem agentes (salvo entre sessões). Repositório não fixo tem base temporária, que some quando
  o último agente sai.
  - **Mover**: arraste o Centro da Cidade para qualquer ponto: um fantasma do prédio mostra onde
    ele fica, vermelho onde não cabe (entre duas bases sempre sobra uma estrada). Perto de uma
    vizinha, ele se alinha com ela. Soltar sobre outra base troca as duas de lugar. Base movida fica
    fixa. Os aldeões vão a pé, pelas estradas, até o lugar novo.
  - **Aumentar o terreno**: passe o ponteiro na borda tracejada da base (ela acende e o cursor vira
    o de redimensionar) e arraste uma borda ou um canto, em qualquer vista. O terreno vai do tamanho
    de uma base nova até três lotes para cada lado, se alinha às vizinhas e a lotes inteiros, e fica
    vermelho onde não cabe. A base muda ao vivo enquanto você arrasta e fica fixa com o tamanho novo
    (mover a base leva o terreno junto). O que nasce na terra extra é gerado, sempre igual para o
    mesmo repositório e tamanho, e o que já estava de pé fica no lugar quando o terreno cresce:
    - O Centro da Cidade, a mina e a forja continuam juntos na borda de baixo, onde fica o portão.
    - A terra atrás deles vira uma **muralha** em volta do Centro da Cidade, com torres ao longo dos
      muros, torre de menagem com bandeira, salões encostados nos muros e um poço no pátio. Antes da
      era Fortaleza a muralha é uma paliçada de madeira, a não ser que você escolha **Muralha › Pedra**
      em Personalizar.
    - O resto vira **vila**: casas no estilo da base (cabanas no Descobrimento), celeiros, campos,
      árvores e a rua do pátio seguindo até as bordas.
    - Para voltar ao tamanho normal, arraste a borda de volta até ela encaixar no menor tamanho.
  - **Mover a praça**: arraste o mercado (ou o calçamento ao lado do poço). Ela vai para a terra
    aberta, onde ocupa duas fileiras de altura, com uma estrada até a mais próxima e uma estrada de
    folga das bases, ou volta para o lado da estrada principal (solte-a além da estrada). O lugar
    fica salvo. Quem está na fogueira, no mercado ou na fila de recrutas vai a pé até a praça nova.
  - **Base vizinha**: clique direito no Centro da Cidade › "Fundar base vizinha" funda outro
    repositório colado a este (à direita, à esquerda, embaixo ou em cima, o que estiver livre),
    para juntar os que andam juntos (UI ao lado do backend, por exemplo).
  - **Histórico de sessões** (clique direito no Centro da Cidade): as 20 conversas mais recentes do
    Claude Code no repositório (subpastas incluídas), com título, há quanto tempo e o último pedido.
    Cada uma se retoma **aqui no app** (escreva o próximo pedido), **no terminal** (`claude --resume`)
    ou **no Cursor**, sempre na pasta onde ela começou. Sessão ainda aberta só foca a aba dela: duas
    retomadas da mesma conversa nunca rodam juntas.
  - **Personalizar** (clique direito › "Personalizar base…", ou Configurações › Bases no mapa):
    - **Porte**, as eras do AoE III: Descobrimento (cabana de madeira) › Colonial › Fortaleza (duas
      torres) › Industrial (bandeiras) › Imperial (acabamento em ouro). Começa **pelo tamanho do
      repositório**, contado em arquivos no git: até 149 Descobrimento, 150 Colonial, 500
      Fortaleza, 1.500 Industrial, 4.000 Imperial. Escolher um porte fixa esse; "Pelo tamanho"
      volta a seguir o repositório.
    - **Estilo**, as cidades de Ragnarok Online: Prontera (pedra cinza e ameias, o padrão), Geffen
      (ardósia, telhado agudo e torre de cristal), Payon (madeira escura, telhados curvos e
      lanternas), Morroc (arenito, cúpula, toldos e minaretes), Aldebaran (tijolo claro e torre do
      relógio, com o ponteiro andando), Alberta (tábuas caiadas, madeira azul e farol aceso à noite),
      Lutie (neve no telhado, pingentes de gelo e pinheiro enfeitado), Einbroch (tijolo escuro,
      telhado de fábrica em dente de serra, chaminés fumegando e engrenagem girando), Juno (mármore,
      colunata, frontão e cúpula) e Umbala (troncos, palha e a grande árvore atravessando o telhado).
    - **Formato**, as proporções do Centro da Cidade, no 2D e no 3D: Padrão, Comprido (raso e baixo),
      Alto (sobrado estreito com um andar a mais de janelas), Atarracado (paredes baixas sob um
      telhadão) e Quadrado (planta quadrada, como um torreão). Nenhum formato passa da largura nem da
      profundidade da era, então o castelo nunca invade a mina, a forja ou a muralha. Começa
      **sorteado pelo nome do repositório**, como a cor do time; escolher um fixa esse.
    - **Tamanho do castelo** (vista 3D): Pequeno › Médio › Grande (muralha atrás do Centro da
      Cidade, com quatro torres de telhado na cor do time) › Colossal (muralha alta, torres maiores
      e torre de menagem com bandeira). Antes da era Fortaleza a muralha é uma paliçada de madeira.
      Começa **pelo tamanho e pela idade do repositório**: arquivos no git (250, 1.000, 4.000) e
      dias desde o primeiro commit (90, 180, 365) dão até 3 pontos cada, e cada 2 pontos sobem um
      tamanho. O castelo cresce para trás e para os lados; a porta fica sempre no pátio.
    - **Giro** (vista 3D): 0°, 90°, 180° ou 270°; clique direito › "Girar castelo" dá um quarto de volta.
    - **Muralha**, no 2D e no 3D: "Pela era" (paliçada de madeira até Colonial, pedra da Fortaleza em
      diante, com ameias e torres no telhado do time) ou "Pedra" (muralha de pedra em qualquer era).
    - **Dimensões** (vista 3D): três controles deslizantes, em % do que o formato dá. **Largura** e
      **Profundidade** vão de 70% a 130%, **Altura das paredes** de 70% a 160% (acima de 150% da
      altura da era, as paredes ganham uma segunda fileira de janelas). Largura e profundidade param
      no tamanho do maior castelo (Imperial Colossal), então o prédio nunca invade a mina, a forja
      nem os aldeões que trabalham na parede; girado, a face virada para o pátio continua no pátio.
      "Voltar ao formato" põe os três em 100%. A prévia 3D acompanha enquanto você arrasta.
    - O diálogo mostra a prévia animada na cor do repositório antes de aplicar; na vista 3D, a prévia
      é o castelo em 3D, com tamanho, dimensões, muralha e giro.
  - **Fixar, desafixar e remover da vila**: clique direito no Centro da Cidade, ou Configurações ›
    Bases no mapa (lista as fixas, as ocultas e as que têm agentes agora). Repositório removido some
    do mapa com os aldeões; os agentes dele continuam no painel. Colocar agente nele o mostra de novo.
  - **Menu da base** (clique direito em qualquer ponto dela): cada opção com ícone e nome numa linha;
    a explicação da opção sob o mouse aparece no pé do menu (a de uma opção desativada diz por quê).
    No topo, o campo **Treinar aldeão** já vem com o cursor: escreva a tarefa e Enter, e o aldeão
    sai na hora, no Cursor (o padrão de todo agente novo; seta para baixo desce para as opções).
    Embaixo, três grupos, sem repetir o que outro diálogo já faz: personalizar treino (o card do
    Centro da Cidade, para escolher onde ele roda e treinar vários de uma vez), mandar os recrutas que
    esperam ordem e histórico de sessões; personalizar base, girar castelo, mover e fundar vizinha;
    fixar, copiar caminho e remover da vila.
  - **Nome no mapa**: "Apelido no mapa" em Personalizar. Só o app muda: a pasta continua igual e
    aparece junto (no menu, no card, na dica do mapa e no painel). Vazio volta ao nome da pasta. O
    nome na etiqueta da base quebra em até duas linhas (nos `-`, `_`, `.` e entre palavras em
    camelCase) em vez de cortar.
  - **Incluir repositório**: "+ Adicionar repositório" nas Configurações (ou clique direito numa
    terra livre) abre a busca de repositórios; "Só fundar a base" fixa a base sem começar agente.
- **O império**: tudo o que segue vem de dado real desta máquina, nunca de pontos inventados.
  - **Recursos**, no canto do mapa como no AoE (últimos 7 dias, somando as bases do império):
    **ouro** = commits, **madeira** = linhas adicionadas, **comida** = horas de agente (tempo entre
    entradas do transcript com menos de 5 min de intervalo, por dia, no fuso da máquina), **pedra** =
    arquivos no git, **tokens** (cristal azul) = tokens dos agentes (entrada, saída e escrita de
    cache, cada resposta contada uma vez, subagentes incluídos; leitura de cache fica de fora,
    porque é o mesmo contexto relido a cada turno), **população** = agentes trabalhando agora.
  - **Balão de tokens da sessão**: sobre o Centro da Cidade de cada base com gasto na sessão do
    plano (a janela de 5 h dos limites), um balão mostra os tokens que os agentes dela gastaram
    desde que a janela abriu e quanto da sessão isso é ("23% da sessão"). A barra é a sessão
    inteira: a parte da base acesa (azul, âmbar ou vermelha, como a severidade do limite), o resto
    já usado em bege. A porcentagem divide a da sessão entre as bases pelo peso de cada tipo de
    token no preço da API (saída 5x, escrita de cache 1,25x, leitura de cache 0,1x), então é uma
    estimativa: os balões somam a barra "Sessão (5 h)" do painel, e o uso que o app não vê
    (claude.ai, app Desktop, sessões fora da pasta de repositórios) fica dividido entre elas. O balão dá um pulinho quando os tokens sobem;
    a dica do mapa (mouse no Centro da Cidade) explica o número. Sem limites (desligados ou
    nenhuma janela aberta), mostra só os tokens das últimas 5 h.
  - **Visão do império** (clique nos recursos, no botão do castelo ou tecla `I`): cada base com
    emblema, era e estilo, os quatro recursos e quando foi fundada (primeiro commit); "Ver no
    mapa" acende a base, "Pôr no mapa" fixa uma base explorada que não está no mapa.
  - **Névoa de guerra**: repositórios da pasta de repositórios (escolhida na primeira execução; `~/Code` por padrão) onde nenhum agente trabalhou ficam como ruínas
    na névoa, numa faixa abaixo da terra. Clicar nela abre a lista; "Explorar" escolhe a tarefa do
    primeiro agente, e a base sai da névoa quando ele chega.
  - **Minimapa**: com o mapa ampliado, aparece abaixo dos controles; clicar leva a vista até lá.
  - **Era pelo trabalho (XP)**: cada commit vale 1 XP e cada hora de agente no repositório vale 5;
    25, 150, 600 e 1.500 XP levam às eras Colonial, Fortaleza, Industrial e Imperial. A base sobe de
    era sozinha, com um feixe de luz dourada sobre o Centro da Cidade e uma fanfarra, e nunca volta
    (o app guarda a maior era alcançada, mesmo quando o Claude Code apaga transcripts antigos). Até a
    primeira contagem, vale o tamanho do repositório. A era escolhida à mão em "Personalizar" vence.
  - **Maravilhas**: o **Obelisco dos mil commits** e o **Farol das 24 horas de agente** surgem na base
    que chega a esses marcos e ficam para sempre.
  - **Conquistas** (10, na Visão do império): Fundador, Cidade-estado, Império, Era Imperial,
    Exército (5 agentes trabalhando juntos), Mina de ouro (100 commits na semana), Celeiro cheio
    (50 h de agente na semana), Explorador, Arquiteto e Maravilha.
  - **História** (na Visão do império): gráfico dos últimos 30 dias, uma linha por recurso (commits
    e tokens por dia, cada uma com o seu pico), e os acontecimentos com data: bases fundadas, eras,
    maravilhas e conquistas. Passe o mouse num dia para ver os números dele; fora do
    gráfico, a linha de baixo soma os 30 dias.
  - **Cor do time e apelido**: em "Personalizar base", escolha uma das 8 cores (ou a automática) e um
    apelido, que aparece no mapa, no card e na Visão do império.
  - **Seu uso** (pé da Visão do império): quantas vezes a Visão foi aberta na semana, a mediana do
    tempo até responder aprovações pelo painel e as sessões esquecidas (sua vez por mais de 30 min).
    Tudo fica no localStorage do app, sem rede.
  - Os números são relidos a cada minuto. O Rust guarda cache: o git só roda de novo quando o HEAD
    muda (ou a cada hora), e os transcripts são lidos só do ponto onde pararam (a primeira contagem
    leva cerca de 1 s; as seguintes, alguns milissegundos).
- Cada sessão é um **aldeão** com a túnica na cor do repositório (rosto, cabelo e chapéu variam por
  sessão). Ele anda até a frente de trabalho da atividade atual e trabalha lá:
  - **Lendo**: minera ouro na mina. **Terminal**: martela na forja. **Editando**: martela a parede
    do Centro da Cidade (ele cresce com o trabalho).
  - **Na web**: olha o horizonte com a luneta, na frente do pátio.
  - **Pensando, respondendo, planejando, delegando**: no Centro da Cidade, com balão do que faz
    (pergaminho na mão quando escreve ou planeja).
  - **Esperando você** (sua vez ou precisa de você): sai de perto de quem trabalha e entra no
    **cercado de espera**, à esquerda da porta, embaixo do sino, de frente para você: piso de pedra
    e uma cerca baixa separando de quem trabalha em frente ao Centro da Cidade.
  - Troca de ferramenta a cada poucos segundos não faz o aldeão atravessar a base toda hora: ele
    termina uma etapa de 2,5 s antes de ir para a próxima frente.
- **Pegar um aldeão**: segure o botão esquerdo num aldeão e arraste. Ele sai do chão pendurado
  pela cabeça, esperneia, balança atrás do ponteiro e fica por cima dos prédios; a sombra no chão
  mostra onde ele está. Solte e ele cai, quica, toma fôlego e volta andando para o que fazia. É só
  brincadeira: a sessão não percebe nada, nenhuma ordem sai e a seleção não muda. Clicar sem
  arrastar continua selecionando.
- **Selecionar e mandar para outro repositório**, como no AoE: clique num aldeão (ou no card, ou
  no "Aldeão ocioso"); **Shift+clique ou Ctrl+clique** somam (no mapa e nos cards); arraste uma
  caixa no chão; **Ctrl+A** (ou "Todos" na barra de seleção) pega todos, inclusive os que estão
  andando. Com aldeões selecionados, **clique** (ou botão direito) em qualquer ponto de uma base,
  edifício incluído, abre "Mandar para <repo>", com a ordem
  já escrita com o caminho do repositório. A ordem segue o caminho normal de cada sessão (aqui no
  app chega direto; no Cursor vai copiada e a aba abre; terminal não recebe) e só quem recebeu muda
  de base. Esc ou clique no chão limpa a seleção. Sem selecionar: clique direito no aldeão ›
  "Mandar para outro repositório" lista as bases do mapa (o menu dele agrupa Precisa de você,
  Ordens e Sessão).
  - Uma sessão do Claude Code nunca muda de pasta: ela trabalha no outro repositório por caminho
    absoluto (permissões fora da pasta aparecem como aprovação, como sempre).
  - **O mapa segue o trabalho de verdade**: o último arquivo editado na tarefa atual (ou desde a
    sua ordem) decide em que base o aldeão trabalha, com ou sem ordem. Sem edição, vale a ordem;
    sem ordem, a pasta da sessão. A túnica continua na cor do repositório de origem, e o card
    mostra "origem → onde trabalha". A ordem acaba com a sessão; mandar de volta para a base de
    origem desfaz.
- O **observador** (sessões do claude-mem) é um **batedor a cavalo**: cavalga pelas estradas, para
  ao lado de cada aldeão trabalhando e o escaneia.
- **O que depende de você** vem primeiro, em três níveis (contadores no topo e seções na lista):
  - **Precisa de você agora** (vermelho): pergunta, plano ou aprovação bloqueando a sessão. O
    **sino da cidade** sobe e toca ao lado do Centro da Cidade e o território da base pulsa vermelho.
  - **Sua vez** (âmbar): o Claude terminou e espera seu próximo pedido. O card mostra há quanto
    tempo e a última coisa que ele disse; no mapa, o aldeão fica no cercado de espera, ao lado do
    Centro da Cidade, acenando, com anel âmbar no chão e uma etiqueta de quanto tempo espera.
  - **Trabalhando**: nada a fazer por você.
  - **Emotes**, como os do Ragnarok: quando algo acontece com um aldeão, um emote animado salta
    sobre a cabeça dele: **/!** pede aprovação (ele dá um pulo de susto), **/?** fez uma pergunta,
    **/ho ♪** terminou e é a sua vez, **GG** terminou uma tarefa de mais de 10 min (pula duas
    vezes, com brilhos), **THX** quando você aprova ou responde, **OK!** quando você manda uma
    tarefa nova e **/an** (veia de raiva) quando outro agente mexe no mesmo arquivo. **PUSH** (azul)
    e **MERGE** (roxo) aparecem quando ele publica ou junta branches com sucesso (`git push`,
    `git merge`, `gh pr merge`) e ficam no ar por 10 min, com o aldeão pulando de tempos em tempos;
    só somem antes se ele travar, brigar por um arquivo ou receber tarefa nova. Enquanto ele
    espera você, o emote volta a cada 15 s e o humor piora com a espera: **/swt** (suor) depois de
    5 min bloqueado, **/sob** (T_T chorando) depois de 15 min, **/…** depois de 5 min na sua vez e
    **/zzz** depois de 30 min (este a cada 45 s). A arte é própria, no estilo do jogo.
- **Aldeão ocioso**, como no AoE: o botão no canto do mapa conta quem está na sua vez e, a cada
  clique (ou tecla `.`), seleciona o próximo, do que espera há mais tempo para o mais recente. Com o
  mapa ampliado, ele centraliza no aldeão.
- Na base por até 30 min depois do último prompt; passado isso o aldeão vai para a praça (poço,
  mercado, tocos em volta da fogueira, carroça) com o balão de "sua vez".
- **Clique no Centro da Cidade**: abre um card pequeno, como o painel de um prédio no AoE, para
  **treinar um aldeão ali**: escreva a tarefa e escolha "No Cursor" (ou Enter, o padrão), "No app"
  ou "No terminal" (esse sem tarefa só abre o claude). **Vários de uma vez**, como a fila de treino
  do AoE: "+ Mais um aldeão" (ou Shift+Enter) põe outra linha de tarefa na fila, até 5; cada linha
  escrita vira uma sessão própria no repositório, todas trabalhando ao mesmo tempo, no modo
  escolhido (linha vazia fica de fora, × tira da fila). O card mostra era, estilo e quem está na base,
  em duas listas: **Aguardando você** (vermelho se precisa de você, âmbar com há quanto tempo é a sua
  vez) e **Trabalhando** (o que cada um faz), com a tarefa; clicar numa linha abre aquela tarefa.
  "Mais opções…" abre o diálogo completo e "Personalizar base" o de porte e estilo.
- **Colocar um agente para trabalhar**: escreva a tarefa na barra de jogo (o chip "novo" já aponta
  a vila), recrute um aldeão (botão do aldeão na barra de jogo,
  abaixo) e mande para uma base, arraste o botão até a base, clique no **Centro da Cidade** de uma base (o card
  acima), em "+ Agente" ou Ctrl+K. Passar o mouse ou clicar na terra livre não faz nada: a área de
  construir só aparece em "Construir". Busque o
  repositório na pasta de repositórios, escreva a tarefa e escolha onde ele trabalha:
  - **Aqui no app** (padrão): o app hospeda o `claude` como a extensão do Cursor faz (`-p
    --input-format stream-json --permission-prompt-tool stdio`). Começa na hora; permissões e
    perguntas com opções (AskUserQuestion) viram cartões no painel, sem prazo; em "sua vez",
    "Seguir em frente" e "Responder…" enviam a próxima mensagem daqui. "Abrir no Cursor" para o
    processo e retoma a mesma sessão numa aba.
  - **No Cursor**: abre uma aba do Claude já preenchida e você confirma com Enter (a extensão não
    aceita enviar prompt vindo de link).
  - **No terminal**: abre um terminal novo na pasta do projeto já rodando `claude "<tarefa>"` (sem
    tarefa, só o `claude`), sem copiar nada. Usa `$TERMINAL` ou o primeiro instalado entre
    xdg-terminal-exec, kitty, konsole, gnome-terminal, ptyxis, kgx (Console do GNOME), alacritty,
    wezterm, foot e xterm. A tarefa vai como argumento, nunca por shell.
  Enquanto o agente não chega, a terra escolhida mostra o alicerce tracejado ("Nova base"), ou o
  Centro da Cidade mostra a barra de treinamento ("Novo aldeão"). Repositório que já tem base
  sempre treina lá, mesmo clicando noutra terra. Os repositórios aparecem numa galeria, cada um com o
  seu Centro da Cidade como está no mapa (era, estilo, forma e cor), do mais recente para o mais
  antigo (último transcript do Claude ou último movimento do git, o que for mais novo), com um selo
  de quantos agentes estão nele agora (verde se algum trabalha). Ao lado, a prévia do escolhido: o
  primeiro parágrafo do README (ou a descrição do `package.json`, `Cargo.toml` ou `pyproject.toml`),
  com o que ele usa (Next.js, Rust, Jekyll…), o branch, quantos arquivos estão alterados sem commit
  e o último commit. A busca filtra a cada tecla, sem acento e por palavras ("chat ui"); setas para
  cima e para baixo andam uma linha, esquerda e direita um card (quando o cursor do texto já está na
  ponta), e Enter escolhe.
- **Subagentes** viram soldados com lança escoltando o aldeão que os chamou; a flâmula da lança tem
  a cor do que o subagente está fazendo.
- **Duas sessões no mesmo arquivo** nas últimas 2 h: espadas cruzadas sobre os dois aldeões.
- Sessão nova sai pela porta do Centro da Cidade do seu repositório (base nova sobe do chão antes);
  sessão encerrada entra por ela. Base sem ninguém é abandonada e a terra dela volta a ser mato. O
  mapa sempre deixa lugar para mais uma base: ao passar o mouse na terra livre, o tracejado mostra
  onde ela nasceria, e a terra cresce uma faixa para baixo quando enche.
- **Clique** no aldeão ou no card traz a janela do Cursor/VS Code por cima, já na aba daquela
  sessão. Sessões de terminal e SDK não têm aba e mostram um aviso.
- **Aprovar pelo painel**: quando uma sessão pede permissão para uma ferramenta, o pedido aparece no
  topo do painel com o comando completo e Aprovar / Negar / Responder no Cursor. Sem resposta em
  60 s, o diálogo normal do Cursor aparece. Com o app fechado, nada muda.
- **Barra de jogo**, centralizada embaixo do mapa, como o painel de comando do AoE: dois botões
  de ícone (castelo e aldeão, com a dica no mouse) e o campo de comando.
  - **Construir** (castelo, ou tecla `B`): busca um repositório da pasta de repositórios; ao escolher, a base dele segue o
    ponteiro como fantasma e o clique constrói ali (base fixa, sem agente). Repositório que já está
    no mapa muda de lugar. Esc ou botão direito cancelam.
  - **Recrutar aldeão**, como treinar no AoE: clique no botão do aldeão (ou clique direito na terra
    livre › "Recrutar aldeão aqui") e um **recruta** entra pela estrada e faz fila na praça, abaixo
    da fogueira (ou fica onde você clicou), com túnica crua e a etiqueta "novo". Ele já nasce
    **selecionado**: o próximo clique numa base o manda para lá. Ele ainda não tem sessão nem
    repositório; quando tiver, abre no Cursor (o padrão de todo agente novo: aba já preenchida, você
    confirma com Enter lá).
    - **Pelo menu**: clique direito no recruta › "Mandar trabalhar em" lista as bases do mapa;
      escolha uma e escreva a tarefa. "Outro repositório…" busca na pasta de repositórios: a base nasce e ele
      vai até lá. Com vários selecionados, o menu vale para todos. Clique direito numa base também
      oferece "Mandar o recruta para cá".
    - **Mandar trabalhar**: selecione (clique, Shift+clique, caixa ou Ctrl+A) e clique numa base. A
      ordem "Mandar para <repo>" pede a tarefa; cada recruta vira uma sessão nova que **começa na
      pasta do repositório** (lê o CLAUDE.md dele, como qualquer outra), com essa tarefa. Ele anda
      até o Centro da Cidade com a etiqueta "→ repo"; quando a sessão aparece, ela assume o lugar
      do recruta na estrada e ganha a cor do repositório. Recrutas e agentes vivos podem ir na
      mesma ordem. Recruta enviado sai da seleção e não recebe outra ordem (a sessão já começou).
    - **Mover**: com recrutas selecionados, botão direito no chão: eles vão para lá, lado a lado.
    - **Arrastar o botão**: no chão, o recruta nasce onde você soltar; numa base (ou num aldeão
      dela), abre o card do Centro da Cidade (escreva a tarefa e Enter), sem recruta. Agente no
      Cursor ou no terminal continua no card, em "+ Agente" e no Ctrl+K.
    - **Dispensar**: botão direito no recruta › "Dispensar". Recrutas vivem só no mapa aberto: fechar o app
      dispensa os que não foram mandados.
- **Comando** (na barra de jogo, tecla `/`): o chip à esquerda do campo diz para quem vai, com o
  retrato do aldeão (a moldura diz o estado: vermelho precisa de você, âmbar é a vez dele). O menu
  dele tem os **agentes** vivos e **Novo agente em** com as vilas do mapa (as mais movimentadas
  primeiro, e a última escolhida fica lembrada); com uma vila, o chip mostra "novo" e o retrato do
  próximo aldeão já na cor dela, e Enter abre a aba do Claude no Cursor na pasta dela, já com a tarefa. "Outro
  repositório…" abre a busca de repositórios com o texto. Agente hospedado no app recebe na hora;
  sessão do Cursor vai copiada e a aba abre (a extensão não aceita comando de fora). Shift+Enter
  quebra a linha e o campo cresce até cinco. **Atalhos** (numa linha embaixo, só com agente vivo):
  Seguir, Sincronizar com a main (fetch + rebase só dos próprios commits, sem stash nem `add -A`,
  para em conflito, nunca faz push sem perguntar), Testar e Resumir; a dica de cada um mostra o
  pedido inteiro.
- **Push na main bloqueado de verdade** nos agentes hospedados no app: `--disallowedTools` com
  `git push origin main`, `HEAD:main`, `+main`, `--force` e `-f` (a regra barra antes da aprovação).
- **Andamento da tarefa** (os agentes daqui não mantêm lista de etapas, então tudo sai das ações):
  - **Linha do tempo**: um bloco por ação desde o seu pedido, na cor do tipo (leitura, edição,
    terminal, web). Muitos blocos verdes seguidos = provavelmente preso num ciclo de teste.
  - **Fase**: Explorando › Implementando › Testando › Respondendo, pela mistura das últimas 8 ações
    (no card).
  - **Arquivos tocados** na sessão e **conflito**: dois agentes que editaram o mesmo arquivo nas
    últimas 2 h ganham aviso laranja (card, espadas cruzadas no mapa e contador no topo).
- **Zoom da interface** nas configurações (75% a 160%) ou Ctrl+= / Ctrl+- / Ctrl+0. Zoom nativo do
  webview, então os cliques no mapa continuam certos. Layout responsivo: abaixo de 980px o
  comando vira barra no topo e a lista vai para baixo do mapa. O mapa tem zoom próprio no canto
  (ou Ctrl + rodinha sobre ele).
- **Navegar pelo mapa**, como num jogo: a **rodinha** aproxima e afasta no ponteiro (Shift + rodinha
  anda para o lado); **setas ou WASD** andam (no mapa inteiro, aproximam antes); **arrastar com o
  botão do meio**, ou **Espaço + arrastar**, puxa o mapa; o minimapa leva a vista até onde clicar.
  As teclas só valem com o foco no mapa: nunca enquanto você digita, num diálogo ou no painel.
- **Três vistas do mapa** (tecla `V` troca, o botão 2D/ISO/3D nos controles do mapa, ou
  Configurações › Vista do mapa); a escolha fica salva:
  - **De cima**: o mapa clássico em pixel art.
  - **Isométrica**: a mesma pixel art em losango, com prédios, árvores e aldeões em pé, estilo
    Ragnarok Online. Q e E giram um quarto de volta.
  - **3D, estilo Age of Empires III** (three.js, embutido em `src/vendor/three/`, carregado só
    quando escolhido): terreno com morros e floresta em volta, um rio correndo pela floresta ao norte
    (onde o império nunca cresce), estradas e pátios de terra batida, sol
    com sombras e noite com janelas acesas, Centro da Cidade em 3D por era e estilo (telhado na cor do
    time, torres, bandeiras, cristal de Geffen, relógio de Aldebaran), mina, forja com fogo,
    aldeões e batedor em 3D, praça com poço, mercado e fogueira, e as ruínas sob a
    névoa. A mina (com os estandartes na cor do time e ouro ao pé da rocha), a forja (ferreiro com
    forno de cúpula, telhado na cor do time, fogo aceso na boca do forno) e os pinheiros são modelos
    prontos do KayKit Medieval Hexagon Pack (CC0), em `src/models/kaykit/`. As paredes do Centro da
    Cidade (porta em arco, janelas com moldura que acendem à noite, reboco nas cores do estilo ou
    tábuas na cabana e em Umbala) e os telhados de duas águas (oitão na cor da parede, telhado na cor
    do time) são montados com peças do Fantasy Town Kit da Kenney (CC0), em `src/models/kenney/`,
    no tamanho, formato e era do castelo. Os aldeões são personagens animados do KayKit Adventurers
    (CC0), em `src/models/kaykit-adventurers/`: cavaleiro, bárbaro, mago ou ladina, com a túnica e a
    capa na cor do time, pele e cabelo de cada um e, em metade deles, elmo, gorro de urso ou chapéu
    de mago. Os modelos carregam em segundo plano e, até chegarem (ou
    se faltarem), o mapa mostra as versões desenhadas em código. Os aldeões trabalham com o corpo todo: picareta acima da cabeça na mina (ouro voando),
    martelo na bigorna (faíscas) e na parede do Centro da Cidade (poeira), luneta varrendo o
    horizonte, pergaminho aberto nas mãos ao responder ou planejar, mão no queixo ao pensar, braço
    apontando ao delegar; quem espera você acena com o braço aberto (os dois, quando está travado). A rodinha aproxima no ponteiro e a câmera abaixa ao chegar perto, como no jogo; Q e E giram
    45°; setas/WASD e botão do meio (ou Espaço + arrastar) andam. Clicar, arrastar base, seleção por
    caixa, clique direito e o minimapa funcionam igual. Sem WebGL, o app avisa e fica na vista atual.
  - É sempre o mesmo mundo: estradas, caminhos e posições vêm da simulação do mapa; as vistas só
    desenham.
- **Só o mapa** (tecla `F` ou ⛶ nos controles): esconde a coluna de comando e o painel, e o mapa
  ocupa a janela inteira. Os recursos, o aldeão ocioso e os controles continuam por cima do mapa.
- **Recolher o painel** (» no topo do painel ou Ctrl+B): o painel vira uma faixa fina com "Agentes";
  clicar nela (ou Ctrl+B de novo) reabre. Em Configurações › Exibição › **Lado do painel**, ele vai
  para a direita (padrão) ou para a esquerda do mapa. As duas escolhas ficam salvas.
- **Clique na tarefa** (aldeão ou card): painel mínimo com o tempo da tarefa ("trabalhando há 12min"),
  Aprovar/Negar quando há pedido, os atalhos, um campo de comando e "Abrir no Cursor".
- **Mouse em cima liga os dois lados**: passar num card (ou pedido de aprovação) acende o aldeão (seta,
  anel amarelo e rótulo com a tarefa) e a base dele no mapa; passar no aldeão marca o card no painel.
- **Clique direito** na terra livre oferece fundar uma base ali; num repositório da galeria, escolher ou
  abrir o claude num terminal. O menu do navegador nunca aparece no mapa.
- **"…" na tarefa** (card do painel ao passar o mouse, rótulo do aldeão selecionado, ou clique
  direito no aldeão ou no card):
  - **Aprovar / Negar** primeiro quando há aprovação pendente no painel (clicar no aldeão travado já
    abre esse menu).
  - **Seguir em frente** (em "sua vez"): foca a aba e copia o pedido "siga em frente… liste as
    melhores opções, recomende uma e continue". A extensão ignora prompt para aba já aberta, então
    é colar e Enter.
  - **Responder…** (agente aqui do app, na vez dele) ou **Dar comando…** (os outros casos): nunca os
    dois, que dariam no mesmo. **Mandar para…** lista as bases com a cor de cada uma.
  - **Abrir no Cursor** foca a aba da sessão; num agente do app, **Levar para o Cursor** para o
    processo aqui e retoma a sessão numa aba.
  - **Tirar do mapa**: sem matar nada; só para quem está em "sua vez", e volta sozinho se voltar a
    trabalhar. Tem Desfazer; os fechados ficam em "N fechados · Mostrar".
  - **Encerrar sessão**: SIGTERM no processo do Claude (salva o transcript e sai), com
    confirmação em dois cliques. Só sinaliza PIDs registrados como sessão, com início conferido.
  - Mesmo formato do menu da base: ícone e nome, explicação no pé.
- **Limites do plano**: barras de uso da sessão (janela de 5 h) e da semana, com quando reiniciam
  (no fuso da máquina). Só com a opção ligada (na primeira execução ou nas Configurações), buscados a cada 1 min no mesmo endpoint do `/usage` do Claude Code, com o
  token dele (só leitura, via stdin do curl); sem rede, mantém a última leitura (ou a cópia de
  `~/.claude.json`, se for mais nova) e avisa a idade. O mouse sobre as barras mostra a hora da leitura.
  - **Limite quase no fim**: a partir de 90%, a barra fica vermelha e uma faixa vermelha aparece
    acima das barras com o limite, o percentual e quando reinicia; os balões dos Centros da Cidade
    também ficam vermelhos. Ao cruzar os 90% chega uma notificação do sistema (uma por janela de
    limite; clicar nela abre o mapa). A faixa some quando o limite reinicia.
  - **Limite reiniciado**: quando uma janela que tinha passado de 75% reinicia, chega uma notificação
    do sistema (`notify-send`; clicar nela abre o mapa). O app busca os limites 20 s depois do horário
    de reinício, sem esperar a próxima busca. Ao abrir o app (ou voltar para a janela), uma corneta toca a
    carga, um aviso aparece e as barras reiniciadas brilham em dourado. A corneta segue o "Som quando
    um Claude para".
- **Configurações** (engrenagem no topo do painel, abre uma aba lateral):
  - **Agrupar por projeto**: a lista ganha seções por projeto (no mapa cada repositório já é uma base).
  - **Mostrar limites do Claude**: desligar também para a consulta à API, a única chamada de rede do app.
  - **Som quando um Claude para** (ligado por padrão): harpa subindo e acorde de sino ao terminar o
    turno, como missão entregue, e bipe duplo quando passa a precisar de você. Sessões SDK ficam
    mudas. Sintetizado no Rust (`src-tauri/src/sound.rs`) e tocado pelo `pw-play`, porque o WebAudio
    fica mudo no WebKitGTK; `src/js/sfx.js` tem a mesma partitura em WebAudio, para o navegador.
  - **Trilha sonora** (ligada por padrão), em dois estilos:
    - **Lo-fi** (padrão): seis faixas originais para trabalhar, com Rhodes, baixo, bateria boom-bap
      com swing, chiado de vinil e o som de fita gasta (afinação que ondula, agudos abafados, notas
      um pouco fora da grade): Café das três (vibrafone), Chuva no vidro (harpa e flauta em meio
      tempo), Commit de madrugada (caixa de música), Merge sem conflito (koto e flauta), Ônibus
      noturno (vibrafone sobre cordas) e Build verde (violão de nylon). A bateria entra depois de
      dois compassos.
    - **Temas da vila**: cinco temas no clima da trilha de Ragnarok Online, um por estilo de
      cidade: Prontera (valsa de flauta e harpa), Geffen (caixa de música em mi dórico), Payon
      (flauta pentatônica, koto e tambor), Morroc (escala hijaz, alaúde e darbuka) e Aldebaran
      (valsa de caixa de música com o relógio). Não é a OST de verdade.
    - Cada estilo toca as faixas em sequência e em loop, começando por uma diferente a cada vez. O
      nome da faixa aparece embaixo do volume; **Próxima ⏭** (ou a tecla **M** no mapa) pula para a
      seguinte, que leva cerca de um segundo para começar na primeira vez.
    - Tudo é escrito como notas em `src-tauri/src/music.rs` e sintetizado ali, sem arquivo de áudio
      no app. A música pausa quando a janela vai para a bandeja, volta quando ela abre, e para junto
      com o app.
  - As escolhas ficam salvas.
- **⟳ Atualizar** (ou F5 / Ctrl+R, ou "Atualizar" na bandeja) relê tudo do zero e recarrega a tela.
- A luz do mapa e o relógio seguem o relógio da máquina, com amanhecer e anoitecer graduais.
  À noite acendem as janelas, a forja e a fogueira. Sem nuvens: o céu fica limpo sobre o mapa.

## Primeira execução

Na primeira vez, o assistente **Fundar o império** abre por cima do mapa, em quatro passos:

1. **Reconhecimento**: confere o Claude Code, o histórico de sessões, o git, o editor (Cursor ou VS
   Code), o terminal, a extensão de foco do GNOME e o WebGL, cada um com o conserto em uma linha.
2. **Repositórios**: a pasta onde o app procura repositórios git (e um nível abaixo). Vem sugerida
   a partir de onde suas sessões do Claude Code rodaram; `~/Code` quando não há histórico.
3. **Primeiras bases**: os repositórios com atividade recente do Claude vêm marcados e viram bases
   fixas, para o mapa não abrir vazio.
4. **Integrações**, cada uma dizendo o que mexe na máquina: aprovar pelo painel (o hook abaixo),
   limites do plano, abrir ao iniciar a sessão e som.

"Pular introdução" não liga nada. Depois, **Objetivos** no topo do painel lateral trazem cinco
missões, como o tutorial do AoE (treinar um aldeão, ver o que ele faz, responder a um pedido, trocar
a vista e mudar uma base de lugar), e cada uma se cumpre quando você faz aquilo de verdade. A tecla
`?` lista todos os atalhos. Configurações › "Rever a introdução" abre o assistente de novo.

## Atalho e ícone

O ícone em pixel art sai de `scripts/gen-icon.py` (arte 32x32 ampliada sem suavização), que grava os
ícones do Tauri e os de `icons/<tamanho>/`. `scripts/install.sh` copia esses ícones para
`~/.local/share/icons/hicolor/` e cria o atalho `~/.local/share/applications/agent-of-empires.desktop`.
Abrir de novo com o app rodando (dock, menu ou autostart) só traz a janela existente: é instância única.

### Como o clique acha a janela certa

A extensão do Claude Code atende `cursor://anthropic.claude-code/open?session=<id>` revelando a aba
que já hospeda a sessão. Mandada para a janela errada, ela retomaria a sessão num segundo processo.
O id da janela vem do `/proc/<pid>/environ` do processo `claude`: o extension host de cada janela
exporta `VSCODE_PROCESS_TITLE="extension-host (user) <pasta> [<windowId>-<hostId>]"`, e o Cursor
roteia a URL pelo `&windowId=`. Sem esse id, o app primeiro foca a pasta (`cursor <cwd>`) e depois
manda a URL. O CLI é chamado sem `ELECTRON_RUN_AS_NODE` e `VSCODE_*`, que vazam quando o app é aberto
de um terminal do editor.

Dois pré-requisitos (o assistente da primeira execução confere o segundo):

- **Cursor confiando na extensão**: `"extensions.confirmedUriHandlerExtensionIds": ["anthropic.claude-code"]`
  no `settings.json` do Cursor. Sem isso ele abre um diálogo "permitir esta URI?" na janela de destino
  (que costuma estar atrás) e a URL fica parada.
- **Janela vir para frente no GNOME/Wayland**: o GNOME não deixa um app focar outro, e o Electron do
  Cursor só usa token de ativação ao iniciar. A extensão
  [Activate Window By Title](https://extensions.gnome.org/extension/5021/activate-window-by-title/)
  faz isso pelo shell: o app chama `activateBySuffix(" - <pasta> - Cursor")`, e o sufixo do título
  identifica a janela do projeto qualquer que seja a aba ativa. Sem ela, a aba é focada mas a janela fica atrás.

## Aprovações pelo painel

Ligado na primeira execução, o app instala em `~/.claude/settings.json` um hook `PermissionRequest`
que roda o próprio binário, `agent-of-empires --permission-hook` (timeout 75 s), e guarda o arquivo
anterior em `settings.json.agent-of-empires.bak`. Os outros hooks e a ordem das chaves ficam iguais;
um `settings.json` que não é JSON válido nunca é alterado. O hook repassa o pedido por um socket privado
(`$XDG_RUNTIME_DIR/agent-of-empires/permission.sock`, pasta 0700 e socket 0600) e espera a
decisão por até 60 s. Qualquer falha, app fechado ou "Responder no Cursor" resulta em saída vazia:
o Claude Code mostra o diálogo dele como sempre. `AskUserQuestion` e `ExitPlanMode` nunca passam
pelo painel. Um pedido novo reabre a janela se ela estiver escondida na bandeja.

Sessões abertas antes da instalação do hook continuam sem ele até serem reiniciadas (o Claude Code
lê os hooks ao iniciar a sessão). Para desligar, desmarque em Configurações › "Rever a introdução", ou remova a entrada
`--permission-hook` do `settings.json`.

## Instalar e rodar

```bash
./scripts/install.sh            # compila e instala em ~/.local (binário, ícones e atalho no menu)
./scripts/install.sh --uninstall
```

Para desenvolver: `cd src-tauri && cargo run`. Abrir ao iniciar a sessão é opcional: liga na primeira
execução ou no menu da bandeja (`~/.config/autostart/Agent of Empires.desktop`).
Fechar a janela só esconde o app na bandeja e a monitoração continua. "Sair" encerra de verdade.

Testes: `cd src-tauri && cargo test --release`.

## De onde vêm os dados

Tudo é lido localmente. A única chamada de rede é a dos limites do plano, e só com ela ligada. As
escolhas da primeira execução ficam em `~/.config/dev.fontenele.agent-of-empires/config.json`; o
layout do mapa, no armazenamento local do app.

| Fonte | O que dá |
|---|---|
| `~/.claude/sessions/<pid>.json` | sessões vivas (PID + `procStart` conferidos no `/proc`), status `busy`/`idle`/`waiting` |
| `~/.claude/projects/<cwd>/<sessionId>.jsonl` | ferramenta em execução, título (`ai-title`), último pedido, modelo |
| `.../<sessionId>/subagents/agent-*.jsonl` + `.meta.json` | subagentes ativos, tipo e descrição |
| `<repo>/.git/index` (só o cabeçalho de 12 bytes) | quantos arquivos o git rastreia: o porte sugerido da base |
| `git log --since=7.days.ago --numstat`, `git rev-list` | ouro e madeira da semana, total de commits e o primeiro commit (fundação) |
| `~/.claude/projects/<repo>/*.jsonl` (só os `timestamp`) | horas de agente da semana (comida), o total em disco (XP); sessão numa subpasta conta para o repositório |
| `~/.claude/projects/<repo>/*.jsonl` e `subagents/` (o `usage` das respostas) | tokens da semana, da janela de 5 h do plano e por dia (História) |
| `git log --since=30.days.ago` | commits por dia para a História |

Uma thread em Rust confere tudo a cada 1 s, lendo só os bytes novos de cada transcript, e emite
o evento `snapshot` para a janela apenas quando algo muda. `CLAUDE_CONFIG_DIR` troca a pasta base.

## Limites

- Só enxerga o Claude Code (CLI, VS Code, SDK). Conversas do claude.ai e do app Desktop não gravam nesses arquivos.
- O transcript chega com 1 a 3 s de atraso em relação ao que o agente faz.
- O status `waiting` (diálogo de permissão aberto no editor) é o único sinal de aprovação pendente fora do hook.
