"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAdminGifts,
  parseUsernameList,
  revokeAdminGift,
  updateAdminGift,
  type AdminGiftRow,
} from "@/lib/adminApi";
import { downloadGiftCard, downloadGiftCardsPdf, groupGiftCode } from "@/lib/giftCardImage";
import { formatLocale } from "@/lib/i18n";
import { useI18n } from "@/lib/useI18n";

// Every gift minted from the admin panel, not only the ones made this visit
// (which is all GiftPanel above it remembers). Where an unredeemed code is
// revoked or given an expiry, and where the printable sheet of the ones still
// waiting comes from.

type Filter = "all" | AdminGiftRow["status"];
const FILTERS: Filter[] = ["all", "paid", "delivered", "expired", "revoked"];

/** yyyy-mm-dd for a date input, in local time. */
function toDateInput(at: number | null): string {
  if (!at) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The end of the picked day, local time — "expira em 10/10" includes the 10th. */
export function fromDateInput(value: string): number | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
}

function formatDate(at: number | null): string {
  if (!at) return "—";
  try {
    return new Date(at).toLocaleDateString(formatLocale(), { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return "—";
  }
}

const STATUS_CLASS: Record<AdminGiftRow["status"], string> = {
  paid: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  delivered: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  expired: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  revoked: "bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

function GiftListRow({ gift, onChanged }: { gift: AdminGiftRow; onChanged: () => void }) {
  const { t, tc } = useI18n();
  const [expiry, setExpiry] = useState(toDateInput(gift.expiresAt));
  const [allowed, setAllowed] = useState(gift.allowed.join(", "));
  const [blocked, setBlocked] = useState(gift.blocked.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Expiry can still be moved on an expired code: that is how one is revived.
  const editable = gift.status === "paid" || gift.status === "expired";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dirty = expiry !== toDateInput(gift.expiresAt);
  const accessDirty = allowed !== gift.allowed.join(", ") || blocked !== gift.blocked.join(", ");

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2.5 text-xs dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CLASS[gift.status]}`}>
          {t(`admin.giftList.status.${gift.status}`)}
        </span>
        <span className="font-medium text-zinc-700 dark:text-zinc-300">
          {gift.planTitle} · {tc("common.dayCount", gift.days)}
          {gift.trialOnly ? ` · ${t("admin.giftPanel.trialBadge")}` : ""}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("admin.giftList.createdOn", { value: formatDate(gift.createdAt) })}
          {gift.from ? ` · ${gift.from.displayName}` : ""}
        </span>
      </div>

      <code className="break-all rounded-md bg-zinc-50 px-2 py-1.5 font-mono text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {groupGiftCode(gift.code)}
      </code>

      {gift.status === "delivered" && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("admin.giftList.redeemedBy", {
            name: gift.to ? `${gift.to.displayName} (@${gift.to.username})` : "—",
            date: formatDate(gift.deliveredAt),
          })}
        </span>
      )}
      {gift.status === "revoked" && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {t("admin.giftList.revokedOn", { value: formatDate(gift.revokedAt) })}
        </span>
      )}

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-zinc-600 dark:text-zinc-400" htmlFor={`exp-${gift.giftId}`}>
            {t("admin.giftList.expiresOn")}
          </label>
          <input
            id={`exp-${gift.giftId}`}
            type="date"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          />
          {dirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => updateAdminGift(gift.giftId, { expiresAt: fromDateInput(expiry) }))}
              className="rounded-md bg-zinc-950 px-2.5 py-1 font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
            >
              {t("admin.giftList.saveExpiry")}
            </button>
          )}
          {!dirty && gift.expiresAt && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(() => updateAdminGift(gift.giftId, { expiresAt: null }))}
              className="rounded-md px-2 py-1 text-zinc-500 hover:text-zinc-900 disabled:opacity-50 dark:hover:text-zinc-100"
            >
              {t("admin.giftList.noExpiry")}
            </button>
          )}
          <span className="flex-1" />
          <button
            type="button"
            disabled={busy}
            onClick={() => void downloadGiftCard(gift.planId, gift.code)}
            className="rounded-md border border-zinc-300 px-2.5 py-1 font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {t("admin.giftPanel.downloadImage")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(t("admin.giftList.confirmRevoke"))) return;
              void run(() => revokeAdminGift(gift.giftId));
            }}
            className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {t("admin.giftList.revoke")}
          </button>
        </div>
      )}
      {editable ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            {t("admin.giftList.allowedLabel")}
            <input
              value={allowed}
              onChange={(e) => setAllowed(e.target.value)}
              placeholder={t("admin.giftList.usernamesPlaceholder")}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1 text-zinc-600 dark:text-zinc-400">
            {t("admin.giftList.blockedLabel")}
            <input
              value={blocked}
              onChange={(e) => setBlocked(e.target.value)}
              placeholder={t("admin.giftList.usernamesPlaceholder")}
              className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            />
          </label>
          {accessDirty && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  updateAdminGift(gift.giftId, {
                    allowedUsernames: parseUsernameList(allowed),
                    blockedUsernames: parseUsernameList(blocked),
                  })
                )
              }
              className="rounded-md bg-zinc-950 px-2.5 py-1 font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950"
            >
              {t("admin.giftList.saveAccess")}
            </button>
          )}
        </div>
      ) : (
        (gift.allowed.length > 0 || gift.blocked.length > 0) && (
          <span className="text-zinc-500 dark:text-zinc-400">
            {gift.allowed.length > 0 && `${t("admin.giftList.allowedLabel")}: ${gift.allowed.map((u) => `@${u}`).join(", ")}`}
            {gift.allowed.length > 0 && gift.blocked.length > 0 && " · "}
            {gift.blocked.length > 0 && `${t("admin.giftList.blockedLabel")}: ${gift.blocked.map((u) => `@${u}`).join(", ")}`}
          </span>
        )
      )}
      {error && <span className="text-red-500">{error}</span>}
    </li>
  );
}

export function GiftListPanel({ refreshKey }: { refreshKey: number }) {
  const { t } = useI18n();
  const [gifts, setGifts] = useState<AdminGiftRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("paid");
  const [error, setError] = useState<string | null>(null);
  const [buildingPdf, setBuildingPdf] = useState(false);

  const load = useCallback(() => {
    fetchAdminGifts()
      .then((rows) => {
        setGifts(rows);
        setError(null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const shown = useMemo(
    () => (gifts ?? []).filter((g) => filter === "all" || g.status === filter),
    [gifts, filter]
  );
  const printable = shown.filter((g) => g.status === "paid");

  async function downloadPdf() {
    setBuildingPdf(true);
    try {
      await downloadGiftCardsPdf([...printable].reverse());
    } catch {
      setError(t("admin.giftPanel.couldNotBuildPdf"));
    } finally {
      setBuildingPdf(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.giftList.title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as Filter)}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
          >
            {FILTERS.map((f) => (
              <option key={f} value={f}>
                {f === "all" ? t("admin.giftList.all") : t(`admin.giftList.status.${f}`)}
                {gifts ? ` (${gifts.filter((g) => f === "all" || g.status === f).length})` : ""}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void downloadPdf()}
            disabled={buildingPdf || printable.length === 0}
            title={t("admin.giftList.pdfHint")}
            className="rounded-lg border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            {buildingPdf ? t("admin.giftPanel.buildingPdf") : t("admin.giftPanel.downloadAllPdf")}
          </button>
          <button
            type="button"
            onClick={load}
            className="rounded-lg px-2 py-1 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            {t("admin.giftList.refresh")}
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
      {gifts === null && !error && <p className="mt-3 text-xs text-zinc-500">{t("admin.giftList.loading")}</p>}
      {gifts !== null && shown.length === 0 && (
        <p className="mt-3 text-xs text-zinc-500">{t("admin.giftList.empty")}</p>
      )}
      <ul className="mt-3 flex max-h-[32rem] flex-col gap-2 overflow-y-auto">
        {shown.map((gift) => (
          <GiftListRow key={`${gift.giftId}:${gift.status}:${gift.expiresAt}:${gift.allowed}:${gift.blocked}`} gift={gift} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}
