import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Termos de Uso e Privacidade",
  description:
    "Termos de uso e política de privacidade do GoLive: como o serviço de transmissão de tela, câmera e voz em grupo funciona e quais dados são tratados.",
  alternates: {
    canonical: "/termos",
  },
  robots: {
    index: true,
    follow: true,
  },
};

const sectionClass = "mt-8 first:mt-0";
const h2Class = "text-lg font-semibold text-zinc-950 dark:text-zinc-50";
const pClass = "mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";
const ulClass = "mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400";
const linkClass = "underline underline-offset-2 hover:text-zinc-900 dark:hover:text-zinc-100";

export default function TermosPage() {
  return (
    <div className="flex flex-1 justify-center bg-zinc-50 px-4 py-16 dark:bg-black">
      <main className="w-full max-w-2xl">
        <Link href="/" className={`text-sm font-medium text-zinc-500 ${linkClass}`}>
          ← Voltar para o GoLive
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
          Termos de Uso e Privacidade
        </h1>
        <p className={pClass}>
          Estes termos explicam como o GoLive (
          <a href="https://golive.nemtudo.me" className={linkClass}>
            golive.nemtudo.me
          </a>
          ) funciona e o que acontece com seus dados ao usá-lo. Ao acessar o site ou entrar em
          uma sala, você concorda com o que está descrito aqui.
        </p>

        <section className={sectionClass}>
          <h2 className={h2Class}>1. O que é o GoLive</h2>
          <p className={pClass}>
            O GoLive é um serviço gratuito para transmitir tela, câmera ou voz para outras
            pessoas na mesma sala, direto do navegador, sem necessidade de instalar nada. É
            possível usar sem se cadastrar: basta escolher um nome e entrar ou criar uma sala.
          </p>
          <p className={pClass}>
            A conexão de áudio/vídeo entre os participantes é feita ponto a ponto (WebRTC). O
            servidor do GoLive atua apenas como intermediário para as pessoas se encontrarem na
            sala (sinalização) — ele não grava, armazena nem tem acesso ao conteúdo da tela,
            câmera ou voz transmitidos.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>2. Salas</h2>
          <p className={pClass}>
            Qualquer pessoa pode criar ou entrar em uma sala informando um identificador (de 1 a
            32 letras, números, &quot;-&quot; ou &quot;_&quot;). Se a sala já existir, você entra nela.
          </p>
          <ul className={ulClass}>
            <li>
              <strong>Salas públicas</strong> aparecem na lista de{" "}
              <Link href="/rooms" className={linkClass}>
                salas públicas
              </Link>{" "}
              para qualquer visitante encontrar e entrar.
            </li>
            <li>
              <strong>Salas privadas</strong> não são listadas publicamente, mas continuam
              acessíveis a qualquer pessoa que tenha o link ou souber o nome da sala — não é um
              recurso de segurança, apenas de descoberta.
            </li>
          </ul>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>3. Conta e uso como convidado</h2>
          <p className={pClass}>
            Você pode usar o GoLive apenas com um nome de exibição temporário (convidado) ou criar
            uma conta com usuário e senha. Também é possível entrar/criar conta usando Discord ou
            Google, quando esses botões estiverem disponíveis. Uma conta criada por login social
            fica sem senha e só pode ser acessada por aquele provedor, até que uma senha seja
            definida.
          </p>
          <p className={pClass}>
            Você é responsável por manter sua senha em sigilo e por tudo o que acontecer usando
            sua conta.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>4. Chat</h2>
          <p className={pClass}>
            As salas têm um chat de texto, com suporte a envio de GIFs. As mensagens de uma sala
            ficam guardadas (em disco ou Redis, dependendo do servidor) enquanto a sala existir,
            até um limite de histórico, e são apagadas quando a sala é encerrada.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>5. Regras de uso</h2>
          <p className={pClass}>Ao usar o GoLive, você concorda em não:</p>
          <ul className={ulClass}>
            <li>Transmitir ou compartilhar conteúdo ilegal, ou que viole direitos de terceiros;</li>
            <li>
              Transmitir ou enviar no chat conteúdo de exploração infantil, pornografia não
              consentida, violência extrema, discurso de ódio ou assédio;
            </li>
            <li>Usar o serviço para golpes, phishing ou distribuição de malware;</li>
            <li>
              Fazer spam, flood de mensagens ou tentar sobrecarregar/burlar o funcionamento do
              serviço;
            </li>
            <li>Se passar por outra pessoa ou entidade de forma enganosa.</li>
          </ul>
          <p className={pClass}>
            Como a mídia transmitida (tela, câmera, voz) não passa pelos servidores do GoLive,
            não há como moderar esse conteúdo em tempo real — a responsabilidade pelo que é
            transmitido é de quem transmite. Já o chat pode ser moderado, incluindo filtro de
            palavras banidas.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>6. Moderação e banimentos</h2>
          <p className={pClass}>
            Para manter o serviço utilizável, o GoLive mantém sistemas de moderação, incluindo:
          </p>
          <ul className={ulClass}>
            <li>Filtro de palavras banidas no chat;</li>
            <li>
              Bloqueio automático de comportamento abusivo (ex.: flood de conexões/mensagens);
            </li>
            <li>Banimento de contas e de endereços IP, temporário ou permanente;</li>
            <li>
              Verificação anti-bot invisível (Google reCAPTCHA v3) nas ações sensíveis — criar
              conta, entrar na conta e entrar/criar uma sala. Não há desafio de imagens nem
              qualquer interação: o Google atribui uma pontuação de confiança e o servidor decide.
              Navegar pelo site, ver a lista de salas ou o mapa não passam por essa verificação.
            </li>
          </ul>
          <p className={pClass}>
            Este site é protegido pelo reCAPTCHA. Aplicam-se a{" "}
            <a
              className={linkClass}
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Política de Privacidade
            </a>{" "}
            e os{" "}
            <a
              className={linkClass}
              href="https://policies.google.com/terms"
              target="_blank"
              rel="noopener noreferrer"
            >
              Termos de Serviço
            </a>{" "}
            do Google.
          </p>
          <p className={pClass}>
            Contas ou IPs podem ser suspensos ou banidos a qualquer momento, a critério da
            administração, em caso de violação destes termos.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>7. Dados que coletamos</h2>
          <p className={pClass}>Dependendo de como você usa o GoLive, podemos tratar:</p>
          <ul className={ulClass}>
            <li>
              <strong>Nome de convidado</strong>, guardado só no seu navegador (localStorage) para
              te reconhecer na próxima visita;
            </li>
            <li>
              <strong>Dados de conta</strong>: nome de usuário, nome de exibição, senha (guardada
              com hash, nunca em texto puro) e os IPs usados para acessar a conta;
            </li>
            <li>
              <strong>Login social</strong>: quando você entra com Discord ou Google, recebemos o
              identificador da conta no provedor e, se o provedor confirmar que é verificado, seu
              e-mail — usado para vincular ou reconhecer sua conta no GoLive;
            </li>
            <li>
              <strong>Endereço IP</strong>, usado para segurança (banimentos, limite de taxa) e
              para estimar uma localização aproximada (arredondada, sem precisão de endereço) que
              alimenta as estatísticas públicas de uso;
            </li>
            <li>
              <strong>Mensagens de chat</strong> enviadas nas salas, conforme a seção 4;
            </li>
            <li>
              <strong>Dados de uso</strong>, via analytics (Umami), como eventos de navegação e
              contagem de acessos.
            </li>
          </ul>
          <p className={pClass}>
            O conteúdo transmitido por tela, câmera ou voz não é coletado nem armazenado pelo
            GoLive — ele trafega diretamente entre os participantes da sala.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>8. Estatísticas públicas</h2>
          <p className={pClass}>
            O GoLive mantém um painel público de estatísticas de uso (Grafana), com números
            agregados como quantidade de conexões por região aproximada — sem nenhum dado que
            identifique uma pessoa individualmente.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>9. Apoiadores e parceiros</h2>
          <p className={pClass}>
            Quem apoia o projeto financeiramente pode ter seu nome e o valor apoiado exibidos
            publicamente no site, como forma de agradecimento. O GoLive também pode exibir
            anúncios de parceiros em algumas salas, com estatísticas de exibição e cliques
            associadas a esses anúncios.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>10. Idade mínima</h2>
          <p className={pClass}>
            O GoLive não é direcionado a crianças. Ao usar o serviço, você declara ter idade
            mínima permitida pela legislação do seu país para consentir com o tratamento de dados
            aqui descrito (em geral, 13 anos, respeitando exigências locais).
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>11. Serviço &quot;como está&quot;</h2>
          <p className={pClass}>
            O GoLive é oferecido gratuitamente, sem garantias de disponibilidade, desempenho ou
            ausência de erros. O serviço pode sair do ar, mudar ou ser descontinuado a qualquer
            momento, sem aviso prévio. Na máxima medida permitida por lei, o GoLive não se
            responsabiliza por danos decorrentes do uso ou da impossibilidade de uso do serviço,
            nem pelo conteúdo transmitido por terceiros.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>12. Alterações destes termos</h2>
          <p className={pClass}>
            Estes termos podem ser atualizados conforme o serviço evolui. Mudanças relevantes
            serão refletidas nesta página, que deve ser revisada periodicamente.
          </p>
        </section>

        <section className={sectionClass}>
          <h2 className={h2Class}>13. Contato</h2>
          <p className={pClass}>
            Dúvidas, solicitações sobre seus dados ou denúncias podem ser enviadas pelo Discord{" "}
            <a
              href="https://discord.gg/nemtudo"
              target="_blank"
              rel="noopener noreferrer"
              className={linkClass}
            >
              discord.gg/nemtudo
            </a>
            .
          </p>
        </section>

        <p className="mt-10 text-xs text-zinc-400 dark:text-zinc-600">
          Última atualização: 23 de agosto de 2026.
        </p>
      </main>
    </div>
  );
}
