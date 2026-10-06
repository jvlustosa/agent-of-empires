# PRD do Batedor, o guerreiro líder

Atualizado em 2026-10-03. Plano de produto só do Batedor; as outras iniciativas ficam no
[PRD](PRD.md), o guia de uso no [Manual](MANUAL.pt-BR.md#o-batedor).

## Problema

O que vira código chega espalhado: tickets no Slack, bugs relatados num canal, ideias em outro,
e-mails de cliente, páginas do Notion. Alguém precisa ler tudo, separar o que dá para resolver com
código, achar o repositório certo e escrever a tarefa para o agente. E, quando o trabalho termina,
quase nunca alguém volta para responder a quem pediu.

## Objetivo

Um herói na aldeia: o **Batedor**, cavaleiro com o logo do Slack no escudo. Ele lê as fontes com que
foi equipado, traz **missões** prontas para as bases e fica mais experiente com o tempo. É o guerreiro
líder: a única unidade que não é sessão, nunca vai embora e responde pelo ciclo inteiro, da demanda
à entrega.

## Regras

- **Só lê.** A ronda é um `claude -p` com `--restricted` (ignora os arquivos de configuração do
  usuário, então nenhuma regra `allow` antiga vale para ele), `--tools ""` (nenhuma ferramenta
  embutida: nada de Bash, edição ou web), e só as ferramentas de leitura dos conectores equipados em
  `--allowedTools`. As de escrita (enviar, responder, rascunhar, apagar, criar página) ficam em
  `--disallowedTools` mesmo assim.
- **Nada começa sozinho.** O que ele lê é texto de terceiros e pode trazer instruções escondidas
  (prompt injection). Por isso uma missão nunca abre um agente: o usuário lê a tarefa, ajusta no Novo
  agente e só então manda o aldeão. O relatório passa por um esquema JSON (`--json-schema`) e é
  conferido de novo no Rust: bases fora da aldeia, links fora dos hosts dos conectores e campos
  grandes demais são descartados ou cortados.
- **Privacidade (LGPD).** A missão guarda um resumo técnico e os links, nunca as mensagens. O prompt
  proíbe nome, e-mail, telefone, CPF, CNPJ e endereço de pessoa ou cliente. `--no-session-persistence`:
  o que ele leu não vira transcript em `~/.claude/projects`. Missão sem novidade há 30 dias some.
- **Sem infraestrutura.** Usa os conectores da conta do Claude do usuário (claude.ai › Configurações ›
  Conectores). Não tem app no Slack, token de bot nem servidor.
- **Respeita o plano.** Teto de US$ 3 por ronda (preço de tabela, `--max-budget-usd`), 40 turnos e
  8 minutos. Rotinas esperam enquanto um limite do plano passa de 80%.
- **Repositório público.** Nenhum canal, cliente ou empresa no código: fontes, skills e rotinas são
  configuração do usuário.
- **Leve.** Pixel art desenhada em código no 2D e no ISO. No 3D, o cavalo do Quaternius (232 KB,
  uma malha pintada por paleta) e o cavaleiro do KayKit que os aldeões já usam, mais quatro texturas
  pequenas (escudo, bandeira, pergaminho, aura) sem mipmaps; até os modelos carregarem, primitivas.

## Como funciona

### No mapa

- **O cavaleiro**: cavalo branco com manta berinjela e barra dourada, lança erguida com a bandeira
  do ChatJurídico (o balão azul com a marca branca, 7 x 8 px no mapa e o dobro de detalhe no painel
  e no 3D, onde a lança é mais alta para a bandeira passar do capacete), penacho vermelho e o escudo
  com o logo do Slack, que nunca sai espelhado. A armadura acompanha o nível: couro (1 e 2), ferro
  (3 e 4), aço (5 e 6), ouro (7). Nas três vistas. No 3D,
  o cavalo galopa no passo do 2D, fica parado ou pasta de vez em quando, e o cavaleiro do KayKit
  monta com as pernas abertas em volta do lombo; lança, escudo e penacho vão presos aos ossos dele.
- **A aura**, sempre ligada: brilho dourado e anel no chão, pulsando, com faíscas girando e partículas
  subindo. À noite ela também entra como luz, por cima do escuro, igual à fogueira e às janelas.
- **A ronda no mapa**: com missões abertas, ele cavalga até cada base que as recebeu (as urgentes
  primeiro), para ao lado da porta do Centro da Cidade por 5 a 8 s, depois dá uma volta pela aldeia e
  recomeça. Sem missões, patrulha as bases e a praça. Enquanto lê as fontes, sai pela estrada
  principal e some na névoa; volta pelo mesmo caminho quando a ronda termina.
- **Pergaminhos**: um sobre a cabeça dele quando há missões abertas; um sobre o Centro da Cidade de
  cada base com missão ("2 missões", borda vermelha se alguma é crítica ou alta). Clicar no
  pergaminho da base abre o painel só com as missões dela.
- **Na barra de baixo**: botão com o escudo, a tecla K no canto e o número de missões abertas
  (vermelho se há urgente). Clique leva a câmera até ele, com a seta, e abre as sugestões dele na
  barra lateral; duplo clique abre o painel. Clicar no cavaleiro no mapa abre o painel nas Rotinas.
  Ele pode ser pego com o mouse como os aldeões.
- **Pixel art definida**: no mapa o cavaleiro tem contorno escuro de 1 pixel, então não some em
  nenhum chão; no painel ele aparece no dobro do detalhe (reflexo e brilho dourado na viseira, o
  mini-logo no tabardo, rédea, mechas da crina, losangos dourados na manta, rebites no escudo).
- **Personagem principal na barra lateral**: sempre acima dos agentes, um cartão de herói com o
  retrato detalhado (abre o equipamento), "O Batedor" e a classe, nível com barra de XP em pixel, o
  que ele está fazendo ("Patrulhando · próxima ronda amanhã 09:00" ou "Em campo, lendo Slack…"), o
  que carrega em ícones (fontes, skills, rotinas) e **Enviar**, **Rotinas**, **Habilidades** e **Ir
  até ele**. Embaixo, as sugestões: as missões abertas, das urgentes para as baixas, com **Treinar
  em <base>** e **Descartar**. O título "Sugestões (N)" recolhe a lista (▾/▸) e a escolha fica
  salva, para o herói não empurrar os agentes para baixo quando há muitas missões.

### O painel (tecla K)

- **Cabeçalho**: retrato, título e nível, barra de experiência, como foi a última ronda (missões
  novas, com novidade, custo aproximado em tokens, o que não conseguiu ler) e **Enviar batedor**.
- **Missões**: abertas primeiro, por gravidade. Cada uma traz gravidade, tipo (bug, melhoria,
  ideia), bases, a evidência numa frase, os links de origem (abrem no navegador pelo `xdg-open`, só
  links já salvos e conferidos de novo), a tarefa para o aldeão e **Treinar aldeão em <base>**, que
  abre o Novo agente com a tarefa preenchida. Quando o agente começa, a missão vira "levada".
  **Descartar** e **Reabrir** também estão lá.
- **Equipamento**, a aba que abre primeiro: o desenho da janela de equipamento do Ragnarok Online
  (faixa de título, abas, espaços em pílula em volta do personagem, Status embaixo) nas cores do
  app: madeira escura, bordas de bronze, dourado no que está escolhido. Abas Geral e Bolsa.
  - **Geral**: o cavaleiro no meio, com a aura (com o mapa em 3D, é o próprio herói do mapa em 3D,
    girando devagar: cavalo, cavaleiro KayKit da armadura do nível, manta, lança, escudo e penacho,
    num canvas WebGL só dele a 30 quadros por segundo enquanto a aba está aberta; nas outras vistas,
    a pixel art), e dez espaços em volta, desenhados em pixel (borda
    em camadas, cantos em degrau, relevo; vazio afundado, escolhido em dourado). A cabeça leva as
    skills (Elmo, Viseira, Penacho, que abrem nos níveis 1, 3 e 5); Escudo, Lança, Capa e Botas
    levam conectores, qualquer um em qualquer espaço, escolhido pelo usuário (o Slack vai no Escudo,
    onde está o logo); Anel e Amuleto, as rotinas; a Armadura não se equipa, vem com o nível. Clicar
    num espaço abre o editor dele embaixo da janela: num de conector, a lista do que dá para pôr ali,
    o que ler, ligar e desligar, trocar ou tirar. Escrever o primeiro alvo liga o conector e apagar
    todos desliga (sem alvo o interruptor fica travado). A edição é fluida: o painel se redesenha a
    cada mudança, mas o foco e o cursor voltam ao mesmo controle, o primeiro clique depois de digitar
    não se perde, e uma ronda que termina no meio da digitação não tira o campo. Equipamento e
    Rotinas dividem um rascunho só: cada aba mostra o que a outra mudou. "Alterações por salvar" só
    aparece com mudança de verdade (desfazer à mão limpa); **Salvar** fica apagado sem mudança,
    **Desfazer** volta ao salvo, e fechar o painel salva (se não der, fica aberto com o motivo).
    Embaixo, o **Status**,
    com os seis atributos do Ragnarok contando coisas reais: FOR (missões levadas), AGI (rondas em
    7 dias), VIT (rondas com relatório), INT (skills equipadas), DES (das missões decididas, quantas
    você levou), SOR (missões urgentes achadas); ao lado, nível, XP, missões, fontes, rotinas e o
    tamanho da aldeia.
  - **Bolsa**: os conectores vinculados à sua conta do Claude, lidos da lista que o Claude Code
    guarda em `.claude.json` (`claudeAiMcpEverConnected`, só os nomes). Os que o batedor sabe
    carregar (Slack, Gmail, Notion, Google Drive, Google Calendar e os de `scout-connectors.json`) vão para um espaço livre com um clique; os outros, apagados, "sem
    leitura segura ainda", até alguém mapear quais ferramentas deles só leem. Embaixo, as skills de
    `~/.claude/skills`, que um clique equipa no próximo espaço livre da cabeça.
  - **Espaço de skill** (Elmo, Viseira, Penacho): vazio, a lista das skills, com busca a partir de 7
    skills (sem acento, nome e descrição; a mesma busca filtra a Bolsa). Equipado, o nome, a
    descrição, o peso na ronda ("5.970 caracteres: ≈ 1.493 tokens em cada ronda", em amarelo quando
    passa dos 8.000 que a ronda lê) e **Editar instruções**; a lista vai para "Trocar por outra
    skill", recolhida, como nos conectores. O editor abre o SKILL.md sem o front matter numa caixa de
    texto. O texto entra no mesmo rascunho do equipamento (Salvar, Desfazer, fechar salva) e o aviso
    diz qual skill falta salvar. `save_scout_skill` regrava o arquivo com o mesmo front matter, numa
    troca atômica no arquivo real (se for link, continua link), e recusa se ele mudou desde que o
    painel o abriu: um editor ou um instalador não perdem o que escreveram. Fechar o editor e abrir
    de novo relê o arquivo quando não há nada por salvar.
- **Rotinas**: uma linha por rotina, de propósito enxuta: nome e uma frase com a próxima ronda
  ("hoje 14:00", "amanhã 09:00", "seg 09:00"), o horário e as fontes que lê; o interruptor, **Rodar
  agora** (a ronda fora do horário) e **Editar**. Editar abre um formulário de quatro linhas: Nome,
  Quando (frequência, das, às, seg a sex), Lê (só as fontes ligadas; nenhuma escolhida lê todas) e
  Procura (o prompt da rotina, até 1.000 caracteres, que vai junto com as regras e as skills), com
  **Ver o texto completo** (o prompt exato daquela rotina) e **Tirar a rotina**. Uma primeira versão
  com quatro caixas lado a lado, setas e uma faixa de 24 horas ficou carregada demais e saiu.
- **Habilidades**: o que ele sabe fazer em português claro (cada fonte que lê, cada skill com a
  descrição, triagem, roteamento, tarefa pronta, memória, rotinas), as regras de toda ronda e as
  **instruções completas**: o texto exato que ele recebe na próxima ronda, montado pelo backend
  (`scout_prompt`), sem rodar nada. O que vem do equipamento tem um botão: cada fonte e cada skill,
  **Editar** (a skill já abre nas instruções); cada espaço de skill livre, **Equipar**; as rotinas,
  **Editar** na aba Rotinas. A lista mostra o rascunho, como a janela de equipamento.
- **Diário**: cada ronda, missão levada e missão descartada, com a experiência que rendeu.

### Uma ronda

1. `start_scout` recebe as bases do mapa, que o Rust confere contra a lista de repositórios, e
   lê de cada uma o resumo do README e o stack.
2. O prompt leva as bases, cada fonte com o ponto de onde ler (a última ronda que deu certo, por
   conector; na primeira, 7 dias), as missões já conhecidas (para juntar em vez de repetir), a
   experiência (o que o usuário levou e o que descartou), as skills equipadas e o foco da rotina.
3. O relatório volta como `structured_output`; `merge` junta a demanda já conhecida (mesmo id ou
   mesmo link) somando fontes e subindo a gravidade, cria as novas e ordena por gravidade.
4. Tudo vai para `<config>/scout.json` e sai como o evento `scout` para o painel e o mapa.

### Experiência

| Feito | XP |
|---|---|
| Ronda que voltou com relatório | 5 |
| Missão nova | 10, mais 15 se crítica ou alta |
| Missão que um aldeão levou | 30 |
| Missão descartada | 2 |

Níveis: Escudeiro (0), Batedor (60), Cavaleiro (180), Cavaleiro veterano (400), Paladino (750),
Campeão (1250), Lenda da aldeia (2000). Espaços de skill: 1 no nível 1, 2 no 3, 3 no 5. Levada e
descartada valem XP uma vez por missão. As 15 últimas levadas e as 15 últimas descartadas entram no
prompt: é assim que a experiência muda o que ele traz, e não só o título.

### Rotinas

Até 2, uma por joia (Anel e Amuleto), cada uma com frequência (15 min a 1 vez por dia), horário
local, só dias úteis, as fontes que lê (vazio = todas as ligadas) e um prompt próprio. Um laço confere a cada minuto, também com o mapa na bandeja; uma rotina que volta com
missão crítica ou alta manda notificação do sistema.

## Etapas

| Etapa | Escopo | Status |
|---|---|---|
| 1 | Ronda sob demanda no Slack, missões no painel, Treinar aldeão com a tarefa | **Concluída** em 2026-10-03 |
| 2 | O cavaleiro no mapa (2D, ISO e 3D), aura, pergaminhos nas bases, botão na barra de baixo | **Concluída** em 2026-10-03 |
| 3 | Equipamento: Gmail e Notion, skills, rotinas com notificação | **Concluída** em 2026-10-03 |
| 4 | Diário, experiência e níveis; aprende com missões levadas e descartadas | **Concluída** em 2026-10-03 |
| 4b | Equipamento no desenho do Ragnarok em pixel art, conectores em qualquer espaço, Google Drive, rotinas como fluxo, aba Habilidades com o prompt exato, personagem principal na barra lateral | **Concluída** em 2026-10-04 |
| 4c | Edição fluida do equipamento e das rotinas: foco preservado, clique depois de digitar, abas em sincronia, salvar ao fechar, Desfazer, "Ver o texto completo" depois de salvar | **Concluída** em 2026-10-04 |
| 4d | Bandeira do ChatJurídico na lança, no lugar da flâmula com as cores do Slack, nas três vistas e no painel | **Concluída** em 2026-10-04 |
| 4e | Equipar e editar skills: busca, peso de cada uma na ronda, instruções editadas no painel (mesmo rascunho do equipamento), atalhos na aba Habilidades | **Concluída** em 2026-10-04; falta salvar uma skill de verdade no app |
| 4f | Google Calendar (reuniões que já aconteceram; link reescrito para calendar.google.com, porque o redirecionador de google.com abriria qualquer site) e conectores próprios em `scout-connectors.json`, na pasta de config e fora do repositório: só ferramentas do próprio conector, domínios simples, arquivo com erro fica de fora inteiro | **Concluída** em 2026-10-04; falta uma ronda real com eles |
| 5 | **Prestar contas**: o líder acompanha o aldeão e responde a quem pediu | Proposta: a próxima |
| 6 | Convocar a tropa: missão de várias bases vira um esquadrão com um briefing só | Ideia |
| 7 | Alerta na hora por Socket Mode, para crítico, sem esperar a ronda | Ideia |

### Critérios de aceite das etapas 1 a 4

- [x] 12 testes no Rust: junção de missões, links aceitos, canais, rotinas, níveis e espaços,
  equipamento, leitura de skill e datas do prompt. A suíte inteira (77) passa sem warnings.
- [x] Cavaleiro, aura de dia e de noite, pergaminhos e etiqueta nas vistas 2D, ISO e 3D (Chrome
  headless com um backend Tauri falso).
- [x] A ronda no mapa: praça, base com missão crítica, a outra base, volta pela aldeia.
- [x] As três abas do painel, os interruptores e o botão na barra de baixo.
- [x] Etapa 4c: 38 checagens com clique e teclado de verdade (Chrome headless, backend falso que
  imita `check_equipment`). O clique perdido depois de digitar e o "Ver o texto completo" vazio
  foram reproduzidos no código anterior antes da correção.
- [x] Etapa 4e: no Rust, um teste novo (o front matter fica intacto ao salvar) e uma checagem a mais
  na leitura (um corpo que começa com lista "- " não perde mais o traço); dez cenários no Chrome headless
  com backend falso: busca no espaço e na Bolsa, editor com foco, aviso por salvar, salvar, skill
  acima de 8.000, Editar e Equipar a partir de Habilidades. A suíte inteira (92) passa.
- [ ] Salvar uma skill de verdade no app (Tauri) e conferir o SKILL.md no disco.
- [ ] **Ronda de verdade no app**, contra o Slack. Não testada aqui: `--restricted` junto com os
  conectores do claude.ai não foi conferido (o modo automático bloqueou o teste com `claude`
  aninhado). Se o batedor voltar dizendo que não achou o Slack, é por aí que se começa.

## Etapa 5: prestar contas (a feature do líder)

### Problema

Hoje o ciclo para no meio. A missão vira aldeão, o aldeão abre um PR, e quem relatou no Slack nunca
fica sabendo. O batedor também não sabe se a missão que trouxe deu em algo: "levada" é um sinal fraco.

### Como funciona

1. **Elo missão e aldeão.** Treinar aldeão guarda qual sessão nasceu da missão: o id do agente
   quando ele roda no app; nos modos Cursor e terminal, a primeira sessão nova naquela base nos
   30 s seguintes.
2. **O líder acompanha.** Quando essa sessão termina o turno, ele confere o repositório: commits
   novos, a branch, o PR aberto (`gh pr list --head`, se o `gh` estiver instalado) e o id do ticket
   citado no commit. A missão passa a **pronta para entregar**, com o link do PR e o resumo da última
   resposta do aldeão.
3. **Prestar contas.** Para cada mensagem de origem, ele escreve uma resposta curta em pt-BR
   ("Corrigido no PR #123, entra no próximo deploy"), que você lê e ajusta no painel. Com um clique,
   ela vira **rascunho na própria thread do Slack** (`slack_send_message_draft`); quem envia é você,
   no Slack. Gmail ganha o mesmo com `create_draft`.
4. **Experiência e medida.** Missão entregue vale 50 XP, o feito mais valioso. O diário mostra o
   **tempo de resposta** (do primeiro relato até a entrega) de cada missão e a mediana por base.
   As entregues entram no prompt como o sinal mais forte do que vale trazer.

### Por que esta

- Transforma o batedor de um feed em responsabilidade: quem pediu recebe resposta, sem o dev sair
  do mapa.
- Mede o que importa para o time: quanto tempo uma demanda leva para virar entrega.
- Fecha o aprendizado com um sinal forte (entregue), no lugar de um fraco (levada).

### Regras próprias

- É a única escrita que o batedor faz, e só como rascunho, só depois do clique, só nas threads de
  onde a missão veio (canal e ts tirados do link já salvo, nunca do texto do modelo).
- O rascunho passa pelas mesmas regras de privacidade: nada de nome, e-mail ou dado de cliente, nem
  detalhe de código além do link do PR.
- A ronda de leitura continua sem nenhuma ferramenta de escrita; a entrega é outra chamada, com
  `--allowedTools` só para o rascunho.

### Critérios de aceite

- [ ] Missão treinada no app, no Cursor ou no terminal fica ligada à sessão em até 30 s.
- [ ] Sessão que termina com commit ou PR deixa a missão pronta para entregar, com o link do PR.
- [ ] O rascunho aparece na thread de origem no Slack e nada é enviado sozinho.
- [ ] O diário mostra o tempo de resposta, e a entrega rende 50 XP uma vez.

### Em aberto

- No modo Cursor a sessão nasce fora do app: a ligação por base e tempo erra se dois aldeões
  começarem juntos na mesma base. Alternativa: um marcador na tarefa que o coletor reconhece no
  primeiro prompt da sessão.
- Sem `gh`, o PR não aparece; fica o commit com o id do ticket.

## Como validar

- **Mapa e painel**: o mesmo harness do PRD geral (frontend servido com um `__TAURI__` falso), com
  um `get_scout` que devolve missões, diário e equipamento. No Chrome headless o
  `requestAnimationFrame` para sob tempo virtual: para ver o cavaleiro andar, rode `think` e `step`
  num `setInterval` no próprio harness.
- **Ronda de verdade**: abra o app, tecla K, Equipamento, ligue o Slack com um canal, Salvar, e
  Enviar batedor. O cavaleiro sai pela estrada; em 1 a 3 minutos volta com o relatório e um aviso.
