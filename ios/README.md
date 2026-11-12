# Go Live para iOS (Capacitor)

A mesma ideia do `android/` e do `electron/`: uma **casca em volta do site
publicado**, não uma segunda cópia dele. O `capacitor.config.ts` aponta o
WKWebView para `https://golive.nemtudo.me`; toda a interface e todo o WebRTC
vêm de lá. O que é nativo está em `App/App/`:

| Arquivo | O que faz |
| --- | --- |
| `GoLiveViewController.swift` | Põe a página dentro da área segura (fora do notch e da barra de início) e pinta as faixas em volta com a cor da barra do site. Registra os plugins abaixo. |
| `AppChromePlugin.swift` | Gêmeo do Android: `setColors` (cor das faixas e da barra de status), `haptic` (Taptic Engine), `share` (folha de compartilhar do iOS). |
| `WebAuthPlugin.swift` | Login social com `ASWebAuthenticationSession`: usa os cookies do Safari, pega o retorno `golive://` sozinho e fecha. |
| `InAppReviewPlugin.swift` | Gêmeo do Android: o pedido de avaliação nativo (`lib/appReview.ts` decide quando). |
| `AppDelegate.swift` | Repassa o token do APNs para o `@capacitor/push-notifications`. |
| `Info.plist` + `*.lproj/InfoPlist.strings` | Textos de permissão (câmera, microfone, fotos) em pt/en/es, esquema `golive://`, áudio em segundo plano, `ITSAppUsesNonExemptEncryption = false`. |
| `App.entitlements` | Push (`production`) e Sign in with Apple. |
| `PrivacyInfo.xcprivacy` | O manifesto de privacidade que a Apple exige. |

O ícone (`Assets.xcassets/AppIcon.appiconset`) é gerado de `resources/ios/icon.svg`
(o mesmo desenho do `electron/build/icon.png`, redesenhado em vetor para sair
nítido em 1024 px, sem transparência — a Apple recusa ícone com alfa).

## O que mudou no site e na API por causa da App Store

- **O app iOS não vende nada** (`lib/storePolicy.ts`). Regra 3.1.1: plano digital
  vendido dentro de app iOS tem que ser compra da Apple. A saída é a regra
  3.1.3(f) — app gratuito que acompanha um serviço pago na web (VoIP é o próprio
  exemplo da Apple) — com a condição de não ter compra nem botão/link que leve a
  comprar. Então, só no app iOS: os botões "Pro" somem (`data-sells` + CSS desde o
  primeiro quadro), links para `/pro`, `/gift`, `/redeem`, `/partner/new` somem,
  essas páginas mostram "Indisponível no app", e as travas abrem um aviso neutro
  ("Este recurso faz parte do GoLive Pro") no lugar dos planos. Quem já assina
  pelo site continua com o Pro no app. Android e navegador não mudam.
- **"Continuar com a Apple"** (regra 4.8, obrigatória porque o app tem login com
  Google/Discord). No app iOS aparece sempre; no resto é o experiment
  `apple-login` (0%). Excluir a conta ou desconectar a Apple revoga o acesso na
  Apple (regra 5.1.1(v)). Código: `sharescreen-api/server/oauth.ts`.
- **Push no iPhone** vai direto para a Apple (APNs), sem Firebase:
  `sharescreen-api/server/apnsSender.ts`, assinaturas `kind: "apns"`.

## Passo a passo (uma vez só)

### 1. Instalar o pacote iOS do Capacitor

```bash
cd sharescreen
npm install @capacitor/ios@8.5.1
```

Depois faça commit do `package.json` e do `package-lock.json` — o build no
GitHub roda `npm ci` e precisa dele no lock.

### 2. Apple Developer (developer.apple.com → Certificates, Identifiers & Profiles)

1. **Identifiers → App IDs → +**: Bundle ID explícito `me.nemtudo.golive`.
   Marque **Push Notifications** e **Sign in with Apple** (deixe "Enable as a
   primary App ID").
2. **Identifiers → Services IDs → +**: `me.nemtudo.golive.signin` (é o login com
   Apple pela web/API). Marque **Sign in with Apple → Configure**: Primary App ID
   = `me.nemtudo.golive`; Domains = `apigolive.nemtudo.me`; Return URL =
   `https://apigolive.nemtudo.me/auth/oauth/apple/callback` (tem que bater com o
   `OAUTH_CALLBACK_BASE` da API).
3. **Keys → +**: um nome qualquer, marque **Apple Push Notifications service
   (APNs)** e **Sign in with Apple** (configure com o App ID acima). Baixe o
   `.p8` — **só dá para baixar uma vez**. Anote o Key ID.
4. Anote o **Team ID** (canto de cima da página "Membership").

### 3. Variáveis da API (produção)

No `.env` da `sharescreen-api` em produção:

```
APNS_KEY=<conteúdo do .p8; pode ser em uma linha com \n, ou base64>
APNS_KEY_ID=<Key ID>
APNS_TEAM_ID=<Team ID>
APPLE_SIGNIN_CLIENT_ID=me.nemtudo.golive.signin
```

A mesma chave serve para os dois (a API usa `APNS_KEY`/`APNS_KEY_ID`/`APNS_TEAM_ID`
para o login também). Sem elas, o push no iPhone e o botão da Apple ficam
desligados, sem quebrar nada.

### 4. App Store Connect (appstoreconnect.apple.com)

1. **Apps → + → Novo app**: iOS, nome (se "Go Live" estiver ocupado, algo como
   "GoLive: Compartilhar Tela"), idioma principal Português (Brasil), Bundle ID
   `me.nemtudo.golive`, SKU qualquer (ex.: `golive-ios`).
2. **Usuários e acesso → Integrações → App Store Connect API → +**: função
   **Admin** (precisa ser Admin para o build criar o certificado de distribuição
   sozinho). Baixe o `.p8`, anote Key ID e Issuer ID.

### 5. Segredos do GitHub (repositório → Settings → Secrets and variables → Actions)

| Segredo | Valor |
| --- | --- |
| `APPLE_TEAM_ID` | Team ID |
| `ASC_KEY_ID` | Key ID da chave da **App Store Connect API** (passo 4.2, não a do APNs) |
| `ASC_ISSUER_ID` | Issuer ID |
| `ASC_KEY_P8` | conteúdo inteiro do `.p8` dessa chave |

## Publicar uma versão

1. Crie a tag como sempre (`npm run release`), que vira a versão do app.
2. GitHub → **Actions → Release iOS app → Run workflow**, com a tag (ex.:
   `v1.1.1`). Ele compila num Mac do GitHub, assina e sobe para o App Store
   Connect. O número do build é o número da execução.
3. Uns 10-30 min depois o build aparece no **TestFlight**. Instale pelo app
   TestFlight no iPhone e teste antes de mandar para revisão.
4. Na página da versão no App Store Connect, escolha o build e **Enviar para
   revisão**.

## O que preencher na ficha da App Store (primeira vez)

- **Capturas de tela**: iPhone 6,9" (1320 × 2868). Pelo menos 3: lista de salas,
  uma chamada com câmera, o chat/grupo. Nenhuma pode mostrar preço ou "Pro".
- **URL de suporte** e **URL da política de privacidade**: as páginas do site
  (`/terms`).
- **Privacidade do app** (as mesmas respostas do `PrivacyInfo.xcprivacy`):
  coleta e-mail, nome, ID do usuário e conteúdo do usuário (mensagens, fotos),
  todos vinculados à identidade, só para funcionalidade; dados de uso não
  vinculados, para análise. **Não** rastreia.
- **Classificação etária**: marque que tem conteúdo gerado por usuários e
  chat/comunicação entre usuários.
- **Notas para a revisão** (importante — a maioria das recusas vem daqui):
  - Uma **conta de teste** (usuário e senha) que já tenha um grupo e uma sala.
  - Explicar: "GoLive é um app de chamadas de vídeo e chat (VoIP). Os planos
    GoLive Pro são vendidos só no nosso site; o app não oferece compra nem links
    de compra, conforme a regra 3.1.3(f)."
  - Onde estão denunciar/bloquear usuário (exigência da regra 1.2 para apps com
    chat) e a exclusão de conta (Você → Excluir conta).

## Limitações conhecidas

- **Compartilhar tela não existe no iOS** (o WKWebView não tem
  `getDisplayMedia`). O botão cai na câmera, como em qualquer navegador de
  celular. Uma versão de verdade exigiria uma extensão ReplayKit (Broadcast
  Upload Extension) — um projeto à parte.
- **Segundo plano**: o modo `audio` mantém o som da chamada, mas o iOS para a
  câmera e pode silenciar o microfone do WKWebView quando o app sai da tela.
  Chamada com tela bloqueada como no WhatsApp exigiria CallKit + WebRTC nativo.
- **iPhone apenas** (`TARGETED_DEVICE_FAMILY = 1`): no iPad o app roda em modo de
  compatibilidade. Liberar iPad exige capturas de tela de iPad na ficha.
- **Não dá para compilar nem testar neste PC** (Windows): o build é sempre pelo
  GitHub Actions. Para depurar com cabo, só num Mac: `npm run ios:open`.

## Scripts

```bash
npm run ios:sync   # cap sync ios — copia config e lista de plugins para o projeto
npm run ios:open   # sync e abre no Xcode (só no Mac)
```
