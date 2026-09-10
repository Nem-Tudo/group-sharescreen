"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { MdClose, MdDelete, MdImage, MdPalette } from "react-icons/md";
import { HexColorPicker } from "react-colorful";
import { BsCoin } from "react-icons/bs";
import { useAuth } from "@/lib/AuthContext";
import { hasFeature } from "@/lib/entitlements";
import { planIcon } from "@/components/planIcons";
import { useOpenPro } from "@/lib/proModal";
import {
  DEFAULT_THEME_SPEC,
  PALETTE_KEYS,
  PALETTE_LABELS,
  createTheme,
  deleteTheme,
  isDarkTheme,
  isHexColor,
  gradientCss,
  setThemePreview,
  updateTheme,
  GRADIENT_DIRECTIONS,
  MAX_THEME_PRICE,
  MIN_THEME_PRICE,
  THEME_AUTHOR_SHARE,
  type RoomTheme,
  type RoomThemeSpec,
} from "@/lib/roomThemes";

// Making a theme.
//
// The whole editor is six colours, an accent and a picture, and it is laid out
// in that order because that is the order they matter in: the palette is the
// theme, the accent is one highlight, and the background is decoration on top
// of a look that already works without it.
//
// There is no mockup of a room in here, and that is deliberate. A little
// drawing of a fake room is a lie that gets more convincing the more effort
// goes into it — it cannot show the chat, the video tiles, the dock or any of
// the places a palette actually goes wrong.
//
// The real preview is the room itself. Opened from inside one (see
// RoomAccountCard, where it sits beside the cosmetics shop), every keystroke
// repaints what is behind this dialog — the actual chat, the actual header,
// the actual video tiles — and closing it puts the room back whatever happens
// next. That is why the editor lives there rather than only in the workshop.
//
// The strip below the name stays anyway, for the one thing a live room cannot
// show while a dialog covers the middle of it: each colour on top of the one
// it will sit on, so a palette can be read as a set.

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** One colour: the swatch that opens the picker, the name, and the hex. */
function ColorField({
  label,
  hint,
  value,
  open,
  onToggle,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  /** Whether this row's picker is the one showing. Owned by the editor. */
  open: boolean;
  onToggle: () => void;
  onChange: (next: string) => void;
}) {
  const hexId = useId();
  return (
    // A div, and emphatically not a label around the whole row.
    //
    // A <label> forwards a click from anywhere inside it to the first form
    // control it contains — which here is the colour swatch. So clicking the
    // name, the hint, or the gap between them threw open the picker, from a
    // target nobody aimed at. The row is three separate things and is now
    // marked up as three separate things.
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        {/* The swatch, wearing the colour it holds — and the only thing on
            this row that opens anything.
            A button rather than <input type="color">, which is what this was.
            That control hands the job to the operating system's own dialog:
            it cannot be dragged inside the page, it steals focus from the room
            being previewed behind it, and it looks like a different app on
            every platform. */}
        <button
          type="button"
          onClick={onToggle}
          aria-label={label}
          aria-expanded={open}
          className={`h-9 w-9 shrink-0 cursor-pointer rounded-lg border transition ${
            open
              ? "border-zinc-900 dark:border-zinc-100"
              : "border-zinc-300 hover:border-zinc-500 dark:border-zinc-700 dark:hover:border-zinc-500"
          }`}
          style={{ background: isHexColor(value) ? value : "#000000" }}
        />
        {/* Tied to the hex box rather than to nothing: a name that labels no
            control is dead text to a screen reader, and focusing a text field
            is the one thing clicking a caption can do without surprising
            anybody. */}
        <label htmlFor={hexId} className="min-w-0 flex-1 cursor-text">
          <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {label}
          </span>
          {hint && (
            <span className="block truncate text-[11px] text-zinc-500 dark:text-zinc-500">
              {hint}
            </span>
          )}
        </label>
        {/* Typed as well as picked: a palette usually arrives as six hex codes
            from somewhere else, and making somebody drag a square to a value
            they already have is the slowest possible way to enter it. */}
        <input
          id={hexId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} em hexadecimal`}
          spellCheck={false}
          className={`w-24 shrink-0 rounded-lg border px-2 py-1.5 font-mono text-xs outline-none dark:bg-zinc-900 ${
            isHexColor(value)
              ? "border-zinc-300 text-zinc-900 focus:border-zinc-500 dark:border-zinc-700 dark:text-zinc-100"
              : "border-red-400 text-red-600 dark:border-red-500/60 dark:text-red-400"
          }`}
        />
      </div>

      {/* In the page rather than in an operating-system window, which is the
          point: the room being repainted is right there behind this dialog,
          and a picker you can drag across while watching it is the entire
          reason the editor opens inside a room at all. */}
      {open && (
        <div className="theme-picker pb-1">
          <HexColorPicker color={isHexColor(value) ? value : "#000000"} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

export type ThemeEditorPopupData = {
  /** The theme being edited, or nothing for a new one. */
  theme?: RoomTheme | null;
  /**
   * Whether a *new* theme starts with "publicar" already ticked — set by the
   * hub's "Publicar" tab, which is a door into this same screen with the
   * intention already stated. Ignored when editing, where the row's own value
   * is the only truthful starting point.
   */
  startPublished?: boolean;
  /** Called after a save or a delete, so a list behind this can re-read. */
  onSaved?: () => void;
};

export function ThemeEditorDialog({
  closePopup,
  data,
}: {
  closePopup: (hasAction?: boolean) => void;
  data?: ThemeEditorPopupData;
}) {
  const existing = data?.theme ?? null;
  const { account } = useAuth();
  const features = account?.features ?? [];
  const canPublish = hasFeature("room_theme_publish", features);
  // The gradient is sold separately from the palette. Shown locked rather
  // than hidden, the same rule the room's quality pickers follow: a control
  // nobody can see is a product people find out about on somebody else's
  // screen.
  const canGradient = hasFeature("room_theme_gradient", features);
  // The top plan's mark, worn by every lock in this dialog.
  const proMaxMark = planIcon("gold_verified");
  // Opens the plan the right way for where this is: the modal inside a
  // room, the page anywhere else — and on Pro Max, because that is the
  // thing the lock just named.
  const openPro = useOpenPro();

  /**
   * Leaves this dialog for the plan.
   *
   * Closes first, and that is not only about stacking. Somebody pressing a
   * lock has stopped editing — they are going to read what a plan costs — and
   * leaving a colour editor open underneath a pricing screen is two things
   * asking for attention when one of them has already lost it.
   *
   * It also settles the layering for good: the plan can be a dialog of its own
   * without having to out-rank a popup that is no longer there.
   */
  function leaveForPro() {
    closePopup(false);
    openPro("premium_max");
  }

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [spec, setSpec] = useState<RoomThemeSpec>(existing?.spec ?? DEFAULT_THEME_SPEC);
  // `startPublished` forces the tick on, whether the theme is new or not: the
  // hub's "Publicar" tab opens an existing private theme through this door,
  // and landing on it with the box already ticked is the difference between
  // "here is the price field" and "find the checkbox again".
  const [published, setPublished] = useState(
    data?.startPublished ? true : existing?.published ?? false
  );
  // Zero is free, and free is where a new theme starts. Kept as its own state
  // rather than derived from a "é pago" checkbox: the number *is* the answer,
  // and a separate switch is a second thing that can disagree with it.
  const [price, setPrice] = useState(existing?.price ?? 0);
  // A picture chosen but not yet uploaded. Held apart from `spec` because the
  // server is the only thing that may turn one into a URL — see the API's
  // themeRoutes, which refuses to read a url out of a request at all.
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Which row has its picker open, by key. Held here rather than per row so
  // opening one closes the last: eight open pickers in a column is a dialog
  // nobody can find the save button in.
  const [openField, setOpenField] = useState<string | null>(null);

  const setPalette = useCallback((key: (typeof PALETTE_KEYS)[number], value: string) => {
    setSpec((current) => ({ ...current, palette: { ...current.palette, [key]: value } }));
  }, []);

  // The room behind this dialog wears whatever is being typed. Published
  // rather than painted here, so useRoomTheme stays the only writer of those
  // variables — see the preview channel in lib/roomThemes.
  //
  // The cleanup is what makes cancelling safe: closing the dialog for any
  // reason at all — saved, cancelled, escape, a click on the backdrop — drops
  // the preview and the room goes back to what it actually wears. Outside a
  // room nothing is listening and this is simply inert.
  useEffect(() => {
    setThemePreview(spec);
  }, [spec]);
  useEffect(() => {
    return () => setThemePreview(null);
  }, []);

  // What the room will actually be pinned to. Derived from the page colour
  // rather than chosen, exactly as the server derives it — a theme that could
  // claim to be dark while being painted white is a room where the text is the
  // same colour as the wall.
  const dark = isDarkTheme(spec);

  const everyColourValid =
    PALETTE_KEYS.every((key) => isHexColor(spec.palette[key])) &&
    isHexColor(spec.accent) &&
    isHexColor(spec.accentText);

  function pickImage(file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Imagem muito grande (máximo ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))} MB).`);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setError(null);
      setPendingImage(result);
      // A picture with no blur and no dim behind a room is a room nobody can
      // read. These are a starting point somebody can turn back to zero, not a
      // rule — but they are the starting point that works.
      setSpec((current) => ({
        ...current,
        background: { url: current.background?.url ?? "", blur: 8, dim: 0.45 },
      }));
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (busy) return;
    if (!name.trim()) {
      setError("Dê um nome ao tema.");
      return;
    }
    if (!everyColourValid) {
      setError("Alguma cor está inválida. Use #rgb ou #rrggbb.");
      return;
    }
    setBusy(true);
    setError(null);
    const input = {
      name: name.trim(),
      description: description.trim(),
      spec,
      published,
      price,
      ...(pendingImage ? { backgroundImage: pendingImage } : {}),
    };
    const result = existing ? await updateTheme(existing.id, input) : await createTheme(input);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    data?.onSaved?.();
    closePopup(true);
  }

  async function remove() {
    if (!existing || busy) return;
    if (!window.confirm(`Apagar "${existing.name}"? Quem estiver usando volta ao tema padrão.`)) {
      return;
    }
    setBusy(true);
    const ok = await deleteTheme(existing.id);
    setBusy(false);
    if (!ok) {
      setError("Não foi possível apagar.");
      return;
    }
    data?.onSaved?.();
    closePopup(true);
  }

  const inputClass =
    "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="flex w-[26rem] max-w-[calc(100vw-1rem)] flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="flex items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div>
          <h2 className="flex items-center gap-1.5 text-base font-semibold tracking-tight">
            <MdPalette className="h-5 w-5 shrink-0 text-indigo-500" />
            {existing ? "Editar tema" : "Novo tema"}
          </h2>
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {existing
              ? "Quem já usa vê a mudança ao recarregar."
              : "Seis cores e o tema já funciona."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => closePopup(false)}
          aria-label="Fechar"
          className="-mr-1 rounded-lg p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
        >
          <MdClose className="h-5 w-5" />
        </button>
      </div>

      <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do tema"
            maxLength={40}
            className={inputClass}
          />
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descrição (opcional)"
            maxLength={160}
            className={inputClass}
          />
        </div>

        {/* The honest preview: each colour on the one it sits on, with real
            text over it. See the note at the top of this file on why it is not
            a drawing of a room. */}
        <div
          className="overflow-hidden rounded-xl border"
          style={{
            // The gradient when there is one, so the strip cannot promise a
            // flat page the room will not deliver.
            background: gradientCss(spec) ?? spec.palette.page,
            borderColor: spec.palette.border,
          }}
        >
          <div
            className="flex items-center justify-between gap-2 border-b px-3 py-2"
            style={{ background: spec.palette.surface, borderColor: spec.palette.border }}
          >
            <span className="text-xs font-semibold" style={{ color: spec.palette.text }}>
              {name.trim() || "Sem nome"}
            </span>
            <span
              className="rounded-md px-2 py-1 text-[11px] font-medium"
              style={{ background: spec.accent, color: spec.accentText }}
            >
              Destaque
            </span>
          </div>
          <div className="flex flex-col gap-2 p-3">
            <div
              className="rounded-lg border px-3 py-2"
              style={{ background: spec.palette.raised, borderColor: spec.palette.border }}
            >
              <span className="text-xs" style={{ color: spec.palette.text }}>
                Um controle elevado, com texto por cima.
              </span>
            </div>
            <div
              className="rounded-lg px-3 py-2"
              style={{ background: spec.palette.input }}
            >
              <span className="text-xs opacity-70" style={{ color: spec.palette.text }}>
                Um campo de texto
              </span>
            </div>
          </div>
        </div>
        <p className="-mt-2 text-[11px] text-zinc-500 dark:text-zinc-500">
          A sala vai ficar {dark ? "escura" : "clara"} — decidido pela cor do fundo.
        </p>

        <div className="flex flex-col gap-2.5">
          {PALETTE_KEYS.map((key) => (
            <ColorField
              key={key}
              label={PALETTE_LABELS[key].label}
              hint={PALETTE_LABELS[key].hint}
              value={spec.palette[key]}
              open={openField === key}
              onToggle={() => setOpenField((current) => (current === key ? null : key))}
              onChange={(next) => setPalette(key, next)}
            />
          ))}
          <ColorField
            label="Destaque"
            hint="Aba ativa e realces"
            value={spec.accent}
            open={openField === "accent"}
            onToggle={() => setOpenField((current) => (current === "accent" ? null : "accent"))}
            onChange={(next) => setSpec((c) => ({ ...c, accent: next }))}
          />
          <ColorField
            label="Sobre o destaque"
            hint="O texto que fica em cima dele"
            value={spec.accentText}
            open={openField === "accentText"}
            onToggle={() =>
              setOpenField((current) => (current === "accentText" ? null : "accentText"))
            }
            onChange={(next) => setSpec((c) => ({ ...c, accentText: next }))}
          />
        </div>

        {/* Under the palette because it is an extension of one colour rather
            than a new one: the near end of the gradient *is* `page`, so this
            reads as "…and it fades into this". Nothing else is offered a
            gradient — every other surface in a room has text sitting directly
            on it, and a panel that changes colour under a paragraph is a
            paragraph with two different contrast ratios. */}
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className={`flex items-center gap-2 ${canGradient ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              checked={Boolean(spec.gradient)}
              disabled={!canGradient}
              onChange={(e) =>
                setSpec((c) => ({
                  ...c,
                  // Starting from the page colour itself rather than from
                  // something arbitrary: a gradient that begins as "no visible
                  // change" is one somebody drags towards what they want,
                  // instead of one that repaints the room the instant it is
                  // ticked.
                  gradient: e.target.checked ? { to: c.palette.page, angle: 180 } : null,
                }))
              }
              className="h-4 w-4 shrink-0"
            />
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Degradê no fundo
            </span>
          </label>

          {/* Outside the label above, deliberately. A <label> forwards a click
              from anywhere inside it to its own control, so a button in there
              would tick the checkbox on its way to opening the plan — the same
              trap the colour rows were fixed for. */}
          {!canGradient && (
            <button
              type="button"
              onClick={leaveForPro}
              className="flex cursor-pointer items-center gap-1 self-start rounded-lg text-[11px] font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <proMaxMark.Icon className={`h-3.5 w-3.5 shrink-0 ${proMaxMark.className}`} />
              Disponível no Pro Max
            </button>
          )}

          {spec.gradient && (
            <div className="flex flex-col gap-2.5">
              <ColorField
                label="Fade para"
                hint={`Sai de ${spec.palette.page}`}
                value={spec.gradient.to}
                open={openField === "gradient"}
                onToggle={() =>
                  setOpenField((current) => (current === "gradient" ? null : "gradient"))
                }
                onChange={(next) =>
                  setSpec((c) => ({
                    ...c,
                    gradient: c.gradient ? { ...c.gradient, to: next } : null,
                  }))
                }
              />
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="w-20 shrink-0">Direção</span>
                <select
                  value={spec.gradient.angle}
                  onChange={(e) =>
                    setSpec((c) => ({
                      ...c,
                      gradient: c.gradient
                        ? { ...c.gradient, angle: Number(e.target.value) }
                        : null,
                    }))
                  }
                  className="flex-1 rounded-lg border border-zinc-300 px-2 py-1.5 text-xs text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                >
                  {GRADIENT_DIRECTIONS.map((direction) => (
                    <option key={direction.angle} value={direction.angle}>
                      {direction.label}
                    </option>
                  ))}
                </select>
              </label>
              {spec.background && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-500">
                  A imagem de fundo cobre o degradê — ele volta a aparecer se você removê-la.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
            Imagem de fundo
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) pickImage(file);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              <MdImage className="h-4 w-4 shrink-0" />
              {spec.background || pendingImage ? "Trocar imagem" : "Escolher imagem"}
            </button>
            {(spec.background || pendingImage) && (
              <button
                type="button"
                onClick={() => {
                  setPendingImage(null);
                  setSpec((c) => ({ ...c, background: null }));
                }}
                className="text-xs font-medium text-zinc-500 underline-offset-2 transition hover:underline dark:text-zinc-400"
              >
                Remover
              </button>
            )}
          </div>
          {spec.background && (
            <div className="mt-1 flex flex-col gap-2">
              {/* Both sliders exist for one reason: a photograph behind a room
                  full of text is unreadable at zero of each, and the amount
                  needed depends entirely on the picture. */}
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="w-20 shrink-0">Desfoque</span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={spec.background.blur}
                  onChange={(e) =>
                    setSpec((c) => ({
                      ...c,
                      background: c.background
                        ? { ...c.background, blur: Number(e.target.value) }
                        : null,
                    }))
                  }
                  className="flex-1"
                />
                <span className="w-10 shrink-0 text-right font-mono">
                  {spec.background.blur}px
                </span>
              </label>
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="w-20 shrink-0">Escurecer</span>
                <input
                  type="range"
                  min={0}
                  max={95}
                  value={Math.round(spec.background.dim * 100)}
                  onChange={(e) =>
                    setSpec((c) => ({
                      ...c,
                      background: c.background
                        ? { ...c.background, dim: Number(e.target.value) / 100 }
                        : null,
                    }))
                  }
                  className="flex-1"
                />
                <span className="w-10 shrink-0 text-right font-mono">
                  {Math.round(spec.background.dim * 100)}%
                </span>
              </label>
            </div>
          )}
        </div>

        {/* Publishing is the top plan's. Shown to everybody rather than hidden,
            because a control somebody cannot see is a feature they never learn
            exists — the same reasoning the quality pickers use for their own
            locked options. */}
        <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className={`flex items-start gap-2 ${canPublish ? "" : "opacity-60"}`}>
            <input
              type="checkbox"
              checked={published}
              disabled={!canPublish}
              onChange={(e) => setPublished(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Publicar no Descobrir
              </span>
              <span className="block text-[11px] text-zinc-500 dark:text-zinc-500">
                Qualquer pessoa poderá usar o seu tema.
              </span>
            </span>
          </label>

          {/* The same lock the gradient wears, for the same reason it sits
              outside the label: a <label> forwards a click from anywhere
              inside it to its own control, so a button in there would tick the
              checkbox on its way to opening the plan.
              It replaced a bare "(Pro Max)" glued to the end of the title —
              which named the plan and then left the reader to go and find it. */}
          {!canPublish && (
            <button
              type="button"
              onClick={leaveForPro}
              className="flex cursor-pointer items-center gap-1 self-start rounded-lg text-[11px] font-medium text-zinc-500 underline-offset-2 transition hover:text-zinc-900 hover:underline dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <proMaxMark.Icon className={`h-3.5 w-3.5 shrink-0 ${proMaxMark.className}`} />
              Disponível no Pro Max
            </button>
          )}
        </div>

        {/* Only once it is going into the shop. A price on something nobody
            else can reach is a number with nothing to do, and asking for it
            before the decision to publish is asking a question out of order. */}
        {canPublish && published && (
          <div className="flex flex-col gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              <BsCoin className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              Preço em pontos
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {/* Free is a button rather than "type 0", because it is the
                  answer most themes want and typing a zero to mean "no price"
                  is a thing people get wrong in both directions. */}
              <button
                type="button"
                onClick={() => setPrice(0)}
                aria-pressed={price === 0}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                  price === 0
                    ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
                    : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                }`}
              >
                Grátis
              </button>
              <input
                type="number"
                min={MIN_THEME_PRICE}
                max={MAX_THEME_PRICE}
                step={50}
                value={price === 0 ? "" : price}
                placeholder={String(MIN_THEME_PRICE)}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPrice(Number.isFinite(next) && next > 0 ? next : 0);
                }}
                aria-label="Preço em pontos"
                className="w-28 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
              />
            </div>
            {price > 0 && (
              <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-500">
                {price < MIN_THEME_PRICE || price > MAX_THEME_PRICE ? (
                  <>
                    O preço precisa ficar entre {MIN_THEME_PRICE} e{" "}
                    {MAX_THEME_PRICE.toLocaleString("pt-BR")} pontos — vai ser ajustado ao salvar.
                  </>
                ) : (
                  <>
                    Você recebe{" "}
                    <span className="font-semibold text-amber-600 dark:text-amber-400">
                      {Math.floor(price * THEME_AUTHOR_SHARE).toLocaleString("pt-BR")} pontos
                    </span>{" "}
                    por venda. Cada pessoa compra uma vez só.
                  </>
                )}
              </p>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy || !everyColourValid}
          className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {busy ? "Salvando…" : "Salvar"}
        </button>
        {existing && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            <MdDelete className="h-4 w-4 shrink-0" />
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}
