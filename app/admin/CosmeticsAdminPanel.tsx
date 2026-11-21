"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MdDelete, MdEdit, MdUpload } from "react-icons/md";
import {
  createAdminDecoration,
  deleteAdminDecoration,
  fetchAdminCosmetics,
  updateAdminDecoration,
  uploadAdminDecorationPicture,
} from "@/lib/adminApi";
import type { CosmeticProduct } from "@/lib/cosmetics";
import { isAvatarDecorationPath, withAvatarDecoration } from "@/lib/avatarShape";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/lib/AuthContext";
import { useT } from "@/lib/useI18n";

// Avatar frames: creating them, changing them, taking them off the shop,
// deleting them (see the API's adminCosmeticRoutes.ts). Deleting takes the
// frame out of everybody's inventory and off everybody wearing it; "fora da
// loja" is the gentle way to retire one. Giving one away is a gift link, from
// "Gerar gift" (the "Moldura" kind).
//
// The picture is uploaded to the CDN from here, or typed as a path the site
// serves (/assets/decorations/…, for the ones shipped with the code). It is a
// square with the face in the middle: drawn at 1.2× the avatar, so the face
// fills the centre ~83% and the frame goes around it.

const PICTURE_ACCEPT = "image/svg+xml,image/png,image/webp,image/gif";
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;

type Form = { id: string; label: string; price: string; collection: string; forSale: boolean; value: string };
const EMPTY_FORM: Form = { id: "", label: "", price: "0", collection: "", forSale: true, value: "" };

/** "Natal 2026!" → "deco_natal_2026". */
function idFromLabel(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug ? `deco_${slug}` : "";
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function CosmeticsAdminPanel() {
  const t = useT();
  const { account } = useAuth();
  const [products, setProducts] = useState<CosmeticProduct[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null: creating a new one; an id: editing that one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  // The id follows the name until somebody types one of their own.
  const [idTouched, setIdTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    fetchAdminCosmetics()
      .then((list) => {
        setProducts(list.filter((p) => p.type === "avatar_decoration"));
        setLoadError(null);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : t("admin.cosmeticsPanel.loadFailed")));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(product: CosmeticProduct) {
    setEditingId(product.id);
    setIdTouched(true);
    setMessage(null);
    setForm({
      id: product.id,
      label: product.label,
      price: String(product.price),
      collection: product.collection ?? "",
      forSale: product.forSale !== false,
      value: product.value,
    });
  }

  function reset() {
    setEditingId(null);
    setIdTouched(false);
    setForm(EMPTY_FORM);
  }

  async function handlePicture(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_PICTURE_BYTES) {
      setMessage({ ok: false, text: t("admin.cosmeticsPanel.pictureTooBig") });
      return;
    }
    setUploading(true);
    setMessage(null);
    try {
      const url = await uploadAdminDecorationPicture(await readAsDataUrl(file));
      setForm((f) => ({ ...f, value: url }));
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("admin.cosmeticsPanel.uploadFailed") });
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(product: CosmeticProduct) {
    if (busy) return;
    if (!window.confirm(t("admin.cosmeticsPanel.confirmDelete", { name: product.label }))) return;
    setBusy(true);
    setMessage(null);
    try {
      const { removed } = await deleteAdminDecoration(product.id);
      setMessage({ ok: true, text: t("admin.cosmeticsPanel.deleted", { value: removed }) });
      if (editingId === product.id) reset();
      load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("admin.cosmeticsPanel.deleteFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const input = {
      label: form.label.trim(),
      price: Number(form.price) || 0,
      value: form.value.trim(),
      collection: form.collection.trim() || null,
      forSale: form.forSale,
    };
    try {
      if (editingId) {
        const { moved } = await updateAdminDecoration(editingId, input);
        setMessage({
          ok: true,
          text: moved > 0 ? t("admin.cosmeticsPanel.updatedMoved", { value: moved }) : t("admin.cosmeticsPanel.updated"),
        });
      } else {
        await createAdminDecoration(form.id.trim(), input);
        setMessage({ ok: true, text: t("admin.cosmeticsPanel.created") });
      }
      reset();
      load();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t("admin.cosmeticsPanel.saveFailed") });
    } finally {
      setBusy(false);
    }
  }

  const pictureOk = isAvatarDecorationPath(form.value.trim());
  const canSave = Boolean(form.label.trim() && pictureOk && (editingId || form.id.trim()) && !uploading);
  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
  const labelClass = "mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400";
  const face = account?.avatarUrl ?? null;
  const name = account?.displayName ?? "Go Live";

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">{t("admin.cosmeticsPanel.title")}</h2>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t("admin.cosmeticsPanel.intro")}</p>

      {loadError && <p className="mt-3 text-sm text-red-500">{loadError}</p>}

      {products && (
        <ul className="mt-3 flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
          {products.length === 0 && (
            <li className="py-2 text-sm text-zinc-500 dark:text-zinc-400">{t("admin.cosmeticsPanel.none")}</li>
          )}
          {products.map((product) => (
            <li key={product.id} className="flex items-center gap-3 py-2.5">
              <UserAvatar src={withAvatarDecoration(face, product.value)} name={name} size={44} className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{product.label}</p>
                <p className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  {product.id}
                  {product.collection ? ` · ${product.collection}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                  product.forSale === false
                    ? "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                }`}
              >
                {product.forSale === false
                  ? t("admin.cosmeticsPanel.giftOnly")
                  : t("admin.cosmeticsPanel.inShop", { value: product.price })}
              </span>
              <button
                type="button"
                onClick={() => startEdit(product)}
                aria-label={t("admin.cosmeticsPanel.edit")}
                title={t("admin.cosmeticsPanel.edit")}
                className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                <MdEdit className="h-4 w-4" />
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete(product)}
                aria-label={t("admin.cosmeticsPanel.delete")}
                title={t("admin.cosmeticsPanel.delete")}
                className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/40 dark:hover:text-red-400"
              >
                <MdDelete className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {editingId ? t("admin.cosmeticsPanel.editing", { name: form.label || editingId }) : t("admin.cosmeticsPanel.new")}
        </p>

        <div className="flex flex-wrap gap-3">
          <div className="min-w-40 flex-1">
            <label htmlFor="deco-label" className={labelClass}>
              {t("admin.cosmeticsPanel.name")}
            </label>
            <input
              id="deco-label"
              value={form.label}
              maxLength={60}
              onChange={(e) =>
                setForm((f) => ({ ...f, label: e.target.value, ...(idTouched ? {} : { id: idFromLabel(e.target.value) }) }))
              }
              placeholder={t("admin.cosmeticsPanel.namePlaceholder")}
              className={inputClass}
            />
          </div>
          <div className="min-w-40 flex-1">
            <label htmlFor="deco-id" className={labelClass}>
              {t("admin.cosmeticsPanel.id")}
            </label>
            <input
              id="deco-id"
              value={form.id}
              disabled={Boolean(editingId)}
              maxLength={48}
              onChange={(e) => {
                setIdTouched(true);
                setForm((f) => ({ ...f, id: e.target.value.toLowerCase() }));
              }}
              placeholder="deco_natal"
              className={`${inputClass} font-mono disabled:opacity-60`}
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <div className="w-32">
            <label htmlFor="deco-price" className={labelClass}>
              {t("admin.cosmeticsPanel.price")}
            </label>
            <input
              id="deco-price"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div className="min-w-40 flex-1">
            <label htmlFor="deco-collection" className={labelClass}>
              {t("admin.cosmeticsPanel.collection")}
            </label>
            <input
              id="deco-collection"
              value={form.collection}
              maxLength={32}
              onChange={(e) => setForm((f) => ({ ...f, collection: e.target.value }))}
              placeholder={t("admin.cosmeticsPanel.collectionPlaceholder")}
              className={inputClass}
            />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={form.forSale}
            onChange={(e) => setForm((f) => ({ ...f, forSale: e.target.checked }))}
            className="mt-0.5"
          />
          <span>
            {t("admin.cosmeticsPanel.forSale")}
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("admin.cosmeticsPanel.forSaleHint")}</span>
          </span>
        </label>

        <div>
          <span className={labelClass}>{t("admin.cosmeticsPanel.picture")}</span>
          <div className="flex flex-wrap items-center gap-3">
            {/* The frame on the admin's own face, as everybody will see it. */}
            <span className="flex h-16 w-16 shrink-0 items-center justify-center">
              {pictureOk ? (
                <UserAvatar src={withAvatarDecoration(face, form.value.trim())} name={name} size={56} />
              ) : (
                <UserAvatar src={face} name={name} size={56} />
              )}
            </span>
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">
              <MdUpload className="h-4 w-4" />
              {uploading ? t("admin.cosmeticsPanel.uploading") : t("admin.cosmeticsPanel.upload")}
              <input
                type="file"
                accept={PICTURE_ACCEPT}
                className="hidden"
                disabled={uploading}
                onChange={(e) => {
                  void handlePicture(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <input
              value={form.value}
              onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
              placeholder="/assets/decorations/natal.svg"
              aria-label={t("admin.cosmeticsPanel.pictureUrl")}
              className={`${inputClass} min-w-48 flex-1 font-mono text-xs`}
            />
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            {form.value.trim() && !pictureOk ? (
              <span className="text-red-500">{t("admin.cosmeticsPanel.pictureInvalid")}</span>
            ) : (
              t("admin.cosmeticsPanel.pictureHint")
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSave || busy}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? t("admin.cosmeticsPanel.saving") : editingId ? t("admin.cosmeticsPanel.save") : t("admin.cosmeticsPanel.create")}
          </button>
          {editingId && (
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {t("common.cancel")}
            </button>
          )}
          {message && <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
        </div>
      </form>
    </div>
  );
}
