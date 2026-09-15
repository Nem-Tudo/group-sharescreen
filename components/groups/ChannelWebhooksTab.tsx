"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { MdAdd, MdContentCopy, MdDeleteOutline, MdExpandMore, MdRefresh } from "react-icons/md";
import { UserAvatar } from "@/components/UserAvatar";
import { WebhookTag } from "@/components/WebhookTag";
import { dangerButton, inputClass, primaryButton, secondaryButton } from "@/components/groups/dialogKit";
import {
  createGroupWebhook,
  deleteGroupWebhook,
  listGroupWebhooks,
  regenerateGroupWebhookToken,
  removeGroupWebhookAvatar,
  updateGroupWebhook,
  uploadGroupWebhookAvatar,
  webhookUrl,
  type GroupChannel,
  type GroupDetail,
  type GroupWebhook,
} from "@/lib/groupsApi";
import { isSupportedAvatarImage, prepareAvatarImage } from "@/lib/avatarImage";
import { copyText } from "@/lib/clipboard";
import { useT } from "@/lib/useI18n";

// A room's webhooks — the "Webhooks" tab of its settings (see
// ChannelSettingsDialog). Discord's screen: a list of them, each opening into
// its name, its picture, the room it posts to, and its URL. Everything here
// takes "manage webhooks"; see the API's webhookStore.ts for what a webhook is.

/** Discord's limits, mirrored from the API's webhookStore — the API is what enforces them. */
const MAX_PER_ROOM = 15;
const NAME_MAX = 80;

export function ChannelWebhooksTab({ detail, channel }: { detail: GroupDetail; channel: GroupChannel }) {
  const t = useT();
  const groupId = detail.group.id;
  const [webhooks, setWebhooks] = useState<GroupWebhook[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listGroupWebhooks(groupId).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(result.error);
        setWebhooks([]);
        return;
      }
      setWebhooks(result.webhooks.filter((w) => w.channelId === channel.id));
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, channel.id]);

  function replace(next: GroupWebhook) {
    // Moved to another room: it leaves this list.
    setWebhooks((list) =>
      (list ?? []).flatMap((w) => (w.id === next.id ? (next.channelId === channel.id ? [next] : []) : [w]))
    );
  }

  async function create() {
    setBusy(true);
    setError(null);
    const result = await createGroupWebhook(groupId, channel.id, t("webhook.defaultName"));
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setWebhooks((list) => [...(list ?? []), result.webhook]);
    setOpen(result.webhook.id);
  }

  const full = (webhooks?.length ?? 0) >= MAX_PER_ROOM;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {channel.kind === "text" ? t("webhook.tabIntroText") : t("webhook.tabIntroVoice")}
      </p>
      <div>
        <button type="button" onClick={() => void create()} disabled={busy || full || webhooks === null} className={primaryButton}>
          <span className="flex items-center gap-1.5">
            <MdAdd className="h-4 w-4" />
            {t("webhook.newWebhook")}
          </span>
        </button>
        {full && <p className="mt-1.5 text-xs text-zinc-500">{t("webhook.limitReached", { max: MAX_PER_ROOM })}</p>}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {webhooks === null ? (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      ) : webhooks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-6 text-center text-sm text-zinc-500 dark:border-zinc-700">
          {t("webhook.noneYet")}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {webhooks.map((webhook) => (
            <WebhookRow
              key={webhook.id}
              detail={detail}
              webhook={webhook}
              expanded={open === webhook.id}
              onToggle={() => setOpen((current) => (current === webhook.id ? null : webhook.id))}
              onChanged={replace}
              onDeleted={() => setWebhooks((list) => (list ?? []).filter((w) => w.id !== webhook.id))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function WebhookRow({
  detail,
  webhook,
  expanded,
  onToggle,
  onChanged,
  onDeleted,
}: {
  detail: GroupDetail;
  webhook: GroupWebhook;
  expanded: boolean;
  onToggle: () => void;
  onChanged: (next: GroupWebhook) => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const groupId = detail.group.id;
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(webhook.name);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "token" | null>(null);

  async function run(work: () => Promise<{ ok: true; webhook: GroupWebhook } | { ok: false; error: string }>, done?: string) {
    setBusy(true);
    setMessage(null);
    const result = await work();
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    onChanged(result.webhook);
    if (done) setMessage({ ok: true, text: done });
  }

  async function onPickAvatar(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedAvatarImage(file)) {
      setMessage({ ok: false, text: t("groups.groupDialogs.useAPngJpegWebpGif") });
      return;
    }
    try {
      const prepared = await prepareAvatarImage(file);
      await run(() => uploadGroupWebhookAvatar(groupId, webhook.id, prepared.dataUrl));
    } catch {
      setMessage({ ok: false, text: t("common.couldNotReadThatImage") });
    }
  }

  async function copyUrl() {
    const copied = await copyText(webhookUrl(webhook));
    setMessage(copied ? { ok: true, text: t("webhook.urlCopied") } : { ok: false, text: t("common.couldNotComplete") });
  }

  async function remove() {
    setBusy(true);
    const result = await deleteGroupWebhook(groupId, webhook.id);
    setBusy(false);
    if (!result.ok) {
      setConfirm(null);
      setMessage({ ok: false, text: result.error });
      return;
    }
    onDeleted();
  }

  const nameChanged = name.trim() !== "" && name.trim() !== webhook.name;
  const created = new Date(webhook.createdAt).toLocaleDateString();

  return (
    <li className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
      >
        <UserAvatar src={webhook.avatarUrl} name={webhook.name} size={36} userId={null} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{webhook.name}</span>
            <WebhookTag />
          </span>
          <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
            {t("webhook.createdBy", { name: webhook.createdBy.name, date: created })}
          </span>
        </span>
        <MdExpandMore className={`h-5 w-5 shrink-0 text-zinc-400 transition ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-col items-center gap-1.5">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                title={t("webhook.changeAvatar")}
                className="cursor-pointer rounded-full transition hover:opacity-80 disabled:cursor-wait"
              >
                <UserAvatar src={webhook.avatarUrl} name={webhook.name} size={72} userId={null} />
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => void onPickAvatar(e)} />
              {webhook.avatarUrl && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => removeGroupWebhookAvatar(groupId, webhook.id))}
                  className="cursor-pointer text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  {t("common.removeImage")}
                </button>
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (nameChanged) void run(() => updateGroupWebhook(groupId, webhook.id, { name: name.trim() }), t("common.saved2"));
                }}
                className="flex flex-col gap-1.5"
              >
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.name")}</span>
                <div className="flex gap-2">
                  <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} className={inputClass} />
                  <button type="submit" disabled={busy || !nameChanged} className={`${primaryButton} shrink-0`}>
                    {t("common.save")}
                  </button>
                </div>
              </form>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("webhook.room")}</span>
                <select
                  value={webhook.channelId}
                  disabled={busy}
                  onChange={(e) => void run(() => updateGroupWebhook(groupId, webhook.id, { channelId: e.target.value }))}
                  className={inputClass}
                >
                  {detail.channels.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.kind === "text" ? `# ${room.name}` : `🔊 ${room.name}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copyUrl()} className={secondaryButton}>
              <span className="flex items-center gap-1.5">
                <MdContentCopy className="h-4 w-4" />
                {t("webhook.copyUrl")}
              </span>
            </button>
            {confirm === "token" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => regenerateGroupWebhookToken(groupId, webhook.id), t("webhook.urlRegenerated"))}
                  className={dangerButton}
                >
                  {t("webhook.confirmRegenerate")}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className={secondaryButton}>
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirm("token")} className={secondaryButton}>
                <span className="flex items-center gap-1.5">
                  <MdRefresh className="h-4 w-4" />
                  {t("webhook.regenerateUrl")}
                </span>
              </button>
            )}
            {confirm === "delete" ? (
              <>
                <button type="button" disabled={busy} onClick={() => void remove()} className={dangerButton}>
                  {t("webhook.confirmDelete", { name: webhook.name })}
                </button>
                <button type="button" onClick={() => setConfirm(null)} className={secondaryButton}>
                  {t("common.cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm("delete")}
                className={`${secondaryButton} !border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400`}
              >
                <span className="flex items-center gap-1.5">
                  <MdDeleteOutline className="h-4 w-4" />
                  {t("webhook.delete")}
                </span>
              </button>
            )}
          </div>

          {confirm === "token" && <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("webhook.regenerateHint")}</p>}
          {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("webhook.usageHint")}</p>
        </div>
      )}
    </li>
  );
}
