import { translate } from "@/lib/i18n";

// The badge after a webhook's name — the same shape as BotTag, in its own
// colour: a bot is an account somebody runs, a webhook is a URL something
// outside posts to, and the two should not read as one thing.

export function WebhookTag({ className = "" }: { className?: string }) {
  return (
    <span
      title={translate("webhook.tagTitle")}
      className={`inline-flex shrink-0 items-center self-center rounded bg-zinc-600 px-1 py-px text-[10px] leading-3.5 font-bold tracking-wide text-white dark:bg-zinc-500 ${className}`}
    >
      WEBHOOK
    </span>
  );
}
