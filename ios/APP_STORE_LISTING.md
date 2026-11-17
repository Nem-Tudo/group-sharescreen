# Ficha da App Store — textos prontos

Tudo o que o App Store Connect pede na primeira versão, na ordem em que as
telas aparecem. Copie e cole. Os limites de tamanho da Apple estão entre
parênteses e todos os textos abaixo cabem neles.

Atenção a uma regra que muda o tom de tudo: **no iPhone não dá para
compartilhar a tela** (veja `README.md`, "Limitações conhecidas"). Nome,
subtítulo, descrição e capturas não podem prometer isso, senão a revisão
recusa pela regra 2.3 (metadados que não batem com o app). O que o iPhone faz:
entra nas salas, **assiste** a tela que outra pessoa compartilha do
computador, liga câmera e microfone, conversa no chat e nos grupos.

---

## Informações do app

**Nome** (30) — o nome na loja; no iPhone o ícone continua "Go Live".

```
GoLive: Salas e Chamadas
```

Alternativas, se esse estiver ocupado:
`GoLive: Assista Junto` · `GoLive - Salas ao Vivo` · `GoLive: Chamadas em Grupo`

**Subtítulo** (30)

```
Assista junto e converse
```

**Categoria principal:** Redes sociais
**Categoria secundária:** Entretenimento

**Direitos de conteúdo:** "Não, o app não contém, mostra nem acessa conteúdo
de terceiros" — o que aparece nas salas é transmitido pelos próprios usuários.

**Classificação etária** (questionário): marque **Sim** para:
- Conteúdo gerado por usuários
- Mensagens e chat entre usuários

e **Não / Nenhum** para todo o resto (violência, conteúdo sexual, jogos de
azar, compras, acesso irrestrito à web — o app só abre o próprio site, etc.).
Os termos já exigem 13 anos (seção 15); a Apple deve sugerir 13+.

---

## Preço e disponibilidade

- Preço: **Grátis**
- Disponibilidade: todos os países (ou só Brasil no começo, se preferir)
- Não marque compras dentro do app — o app não vende nada.

---

## Privacidade do app

**URL da política de privacidade:**

```
https://golive.nemtudo.me/terms
```

**Questionário "Coleta de dados"** — responda **Sim, coletamos dados** e marque:

| Tipo de dado | Vinculado ao usuário | Usado para rastreamento | Finalidade |
| --- | --- | --- | --- |
| Informações de contato → **E-mail** | Sim | Não | Funcionalidade do app |
| Informações de contato → **Nome** | Sim | Não | Funcionalidade do app |
| Identificadores → **ID do usuário** | Sim | Não | Funcionalidade do app |
| Conteúdo do usuário → **Outro conteúdo do usuário** (mensagens, grupos, fotos enviadas no chat) | Sim | Não | Funcionalidade do app |
| Localização → **Localização aproximada** (estimada pelo IP, para as estatísticas públicas) | Não | Não | Análise |
| Dados de uso → **Interação com o produto** | Não | Não | Análise |

**Rastreamento:** Não. O app não rastreia ninguém entre apps e sites de
outras empresas.

Observações:
- O áudio e o vídeo das chamadas **não** entram: passam direto entre os
  participantes e não são guardados (termos, seção 11).
- "Localização aproximada" não está no `PrivacyInfo.xcprivacy` do app hoje.
  Vale acrescentar lá na próxima versão para os dois baterem.
- A seção 11 dos termos cita login com Discord e Google; acrescentar a Apple
  ("Entrar com a Apple": identificador da conta e, se você permitir, o e-mail,
  que pode ser um endereço privado de retransmissão da Apple).

---

## Página da versão (1.x.x)

**Texto promocional** (170) — dá para trocar a qualquer hora sem nova revisão.

```
Entre numa sala, assista ao que seus amigos estão transmitindo do computador e converse por voz, câmera e chat. Grátis e sem complicação.
```

**Descrição** (4000)

```
O GoLive é o lugar para assistir junto e conversar em grupo.

Alguém compartilha a tela do computador — um filme, um jogo, uma aula, um trabalho — e todo mundo na sala assiste ao vivo, com voz, câmera e chat. No iPhone você entra em qualquer sala com um toque, assiste em tela cheia e participa da conversa.

SALAS
• Salas públicas para encontrar gente nova, e salas privadas com código para os amigos
• Assista às transmissões em alta qualidade, inclusive com o som da transmissão
• Fale pelo microfone, ligue a câmera ou só converse pelo chat
• Veja quem está na sala e quem está falando

GRUPOS E CONVERSAS
• Grupos com canais de texto e salas próprias, para a sua turma ou comunidade
• Conversas privadas com amigos
• Mencione pessoas, reaja a mensagens e envie fotos e GIFs
• Notificações quando alguém chama você ou fala com você

PERFIL E AMIGOS
• Escolha seu nome de exibição e sua foto
• Adicione amigos e veja quando eles estão online
• Bloqueie quem você não quer por perto

FEITO PARA FUNCIONAR
• Entre com sua conta GoLive, com a Apple, com o Google ou com o Discord
• A mesma conta funciona no iPhone, no computador e no navegador
• O áudio e o vídeo das chamadas vão direto entre os participantes e não são gravados pelo GoLive

Para transmitir a sua tela, use o GoLive no computador (golive.nemtudo.me ou o app para Windows). No iPhone, você assiste e conversa.
```

> Revise a lista antes de enviar e tire o que não existir no app (por
> exemplo, GIFs ou fotos no chat). Cada item precisa ser verdade no iPhone.

**Palavras-chave** (100) — separadas por vírgula, sem espaço. Sem nome de
concorrente (a Apple recusa marcas de terceiros aqui).

```
assistir junto,chamada,vídeo,chat,grupo,sala,transmissão,amigos,voz,live,câmera,reunião
```

**URL de suporte:**

```
https://golive.nemtudo.me/terms
```

> A Apple quer um jeito de contato nessa página. Hoje a seção 22 dos termos
> aponta para o Discord. Um e-mail de suporte lá deixa a revisão mais
> tranquila.

**URL de marketing** (opcional):

```
https://golive.nemtudo.me
```

**Copyright:**

```
2026 Go Live
```

---

## Informações para a revisão do app

**Login necessário:** Sim. Preencha com a conta de teste (usuário e senha),
que já precisa estar num grupo com algumas mensagens e ter uma sala.

**Contato:** seu nome, telefone e e-mail.

**Notas** — em inglês, que é a língua de quem revisa:

```
GoLive is a free group video-call and chat app (VoIP): people join rooms, talk by voice, camera and text, and watch a screen that another participant shares from a computer.

TEST ACCOUNT
The demo account above is already a member of a group with messages and has a room. You can also create a new account or use Sign in with Apple.

PURCHASES (Guideline 3.1.3(f))
The app does not sell anything and has no purchase buttons or links. GoLive Pro is an optional plan sold only on our website, and the iOS app neither mentions its price nor links to it. People who already subscribe on the web keep their benefits in the app.

USER-GENERATED CONTENT (Guideline 1.2)
- Block a user: open their profile and tap "Bloquear".
- Report a user or message: [FILL IN once reporting ships — see note below].
- Moderation: banned-word filter, automatic flood protection, and account/IP bans by our moderators. Contact: [support email].

ACCOUNT DELETION (Guideline 5.1.1(v))
"Você" tab > Settings > "Excluir conta". It deletes the account and revokes Sign in with Apple.

SCREEN SHARING
Sharing your own screen is not available on iPhone (WKWebView has no screen capture). On iPhone you join rooms, watch what others share, and talk by voice, camera and chat. The app description says so.

BACKGROUND AUDIO
The "audio" background mode keeps the call's audio playing when the app goes to the background during a call.
```

---

## Checklist da primeira submissão

- [ ] App criado no App Store Connect (Bundle ID `me.nemtudo.golive`, SKU `golive-ios`)
- [ ] Chave "GitHub CI" (Admin) gerada e secrets no GitHub
- [ ] Build enviado pelo workflow "Release iOS app" e testado no TestFlight
- [ ] Capturas de iPhone 6,9" (1320 × 2868) ou 6,7" (1290 × 2796), pelo menos 3, sem "Pro" nem preço
- [ ] Textos acima colados, revisados contra o que existe de fato no app
- [ ] Privacidade e classificação etária respondidas
- [ ] Conta de teste criada e preenchida nas notas
- [ ] Denunciar usuário/mensagem disponível (regra 1.2) — **ainda não existe no app**
- [ ] E-mail de suporte publicado na página de suporte
- [ ] Build escolhido na versão → Enviar para revisão
