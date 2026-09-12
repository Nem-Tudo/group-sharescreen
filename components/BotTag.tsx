// The badge after a bot account's name.
//
// Whether somebody is a bot is its own field on the wire (`bot: true`, see the
// API's accountModels.ts's AccountDoc.bot) rather than one of their flags;
// this is the one place that decides how it looks.

export function BotTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="Conta bot"
      className={`inline-flex shrink-0 items-center self-center rounded bg-indigo-600 px-1 py-px text-[10px] leading-3.5 font-bold tracking-wide text-white ${className}`}
    >
      BOT
    </span>
  );
}
