"use client";

import { useState } from "react";
import { MdAdd, MdDelete, MdExpandLess, MdExpandMore } from "react-icons/md";
import type { PartnerSchedule } from "@/lib/partner";
import { formatMinuteOfDay, parseMinuteOfDay } from "@/lib/partnerSchedule";
import { PartnerMediaDrop } from "./PartnerMediaDrop";

// The dayparting editor for one ad: its windows, and what each one changes.
//
// Every creative field here is an *override* — left blank, the window keeps
// what the ad above it says (see the API's Partner.schedules). That is why
// each input is placeholdered with the ad's own value rather than prefilled
// with it: an admin who wants the banner swapped at 19:00 and nothing else
// fills in one box, and the copy, button and colours follow the ad forever
// after, including when they are edited later.

const inputClass =
  "mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";
const labelClass = "text-xs font-medium text-zinc-600 dark:text-zinc-400";
const timeInputClass =
  "rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

// Mirrors the API's PARTNER_SCHEDULES_MAX — every window travels to every
// visitor in the ad payload, so this is a real ceiling and not just a tidy one.
export const PARTNER_SCHEDULES_MAX = 6;

/** A window with nothing overridden yet, over the afternoon. */
export function newPartnerSchedule(index: number): PartnerSchedule {
  return {
    // Local for now; the API keeps whatever id it is handed (see its
    // parsePartnerSchedules), so this one survives the save and stays the
    // React key across it.
    id: `sch_local_${Date.now().toString(36)}_${index}`,
    label: `Configuração ${String.fromCharCode(65 + index)}`,
    startMinute: 12 * 60,
    endMinute: 19 * 60,
    title: null,
    description: null,
    imageUrl: null,
    iconUrl: null,
    buttonLabel: null,
    buttonUrl: null,
    backgroundColor: null,
    textColor: null,
    buttonBackgroundColor: null,
    buttonTextColor: null,
  };
}

const OVERRIDE_FIELDS = [
  "title",
  "description",
  "imageUrl",
  "iconUrl",
  "buttonLabel",
  "buttonUrl",
  "backgroundColor",
  "textColor",
  "buttonBackgroundColor",
  "buttonTextColor",
] as const;

/** How many creative fields a window actually changes — shown folded up, so an
 *  admin can see at a glance which windows do anything at all. */
function overrideCount(schedule: PartnerSchedule): number {
  return OVERRIDE_FIELDS.filter((field) => schedule[field]).length;
}

export type PartnerScheduleBase = {
  title: string;
  description: string;
  imageUrl: string;
  iconUrl: string;
  buttonLabel: string;
  buttonUrl: string;
  backgroundColor: string;
  textColor: string;
  buttonBackgroundColor: string;
  buttonTextColor: string;
};

export function PartnerScheduleEditor({
  schedules,
  onChange,
  base,
}: {
  schedules: PartnerSchedule[];
  onChange: (next: PartnerSchedule[]) => void;
  /** The ad's own fields, used as every input's placeholder. */
  base: PartnerScheduleBase;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  function patch(id: string, changes: Partial<PartnerSchedule>) {
    onChange(schedules.map((s) => (s.id === id ? { ...s, ...changes } : s)));
  }

  // An emptied box means "keep the ad's own", which is null, not "".
  function patchText(id: string, field: (typeof OVERRIDE_FIELDS)[number], value: string) {
    patch(id, { [field]: value.trim() === "" ? null : value });
  }

  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= schedules.length) return;
    const next = [...schedules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
      <p className={labelClass}>Horários (opcional)</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Faixas de horário com criativos próprios. Ex.: das 12:00 às 19:00 roda a
        configuração A, das 19:01 às 11:59 roda a B. O que ficar em branco numa
        faixa continua vindo do anúncio acima, então dá para trocar só o banner e
        manter o resto. Fora de todas as faixas, o anúncio é ele mesmo.
      </p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        O horário é o <strong>do relógio de quem está vendo</strong> — “12:00” é
        meio-dia onde a pessoa estiver. A primeira faixa que bate é a que vale,
        então se duas se cruzarem, use as setas para decidir quem ganha.
      </p>

      {schedules.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {schedules.map((schedule, index) => {
            const open = openId === schedule.id;
            const wraps = schedule.endMinute < schedule.startMinute;
            const changes = overrideCount(schedule);
            return (
              <div
                key={schedule.id}
                className="rounded-lg border border-zinc-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={schedule.label}
                    onChange={(e) => patch(schedule.id, { label: e.target.value })}
                    maxLength={40}
                    placeholder="Nome da configuração"
                    className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1 text-sm font-medium text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                  />
                  <span className="flex shrink-0 items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                    das
                    <input
                      type="time"
                      value={formatMinuteOfDay(schedule.startMinute)}
                      onChange={(e) => {
                        const minute = parseMinuteOfDay(e.target.value);
                        if (minute !== null) patch(schedule.id, { startMinute: minute });
                      }}
                      className={timeInputClass}
                    />
                    até
                    <input
                      type="time"
                      value={formatMinuteOfDay(schedule.endMinute)}
                      onChange={(e) => {
                        const minute = parseMinuteOfDay(e.target.value);
                        if (minute !== null) patch(schedule.id, { endMinute: minute });
                      }}
                      className={timeInputClass}
                    />
                  </span>
                  <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                    {changes === 0 ? "nada alterado" : `${changes} campo${changes > 1 ? "s" : ""}`}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      title="Subir (a primeira faixa que bate é a que vale)"
                      className="rounded p-1 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      <MdExpandLess className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      disabled={index === schedules.length - 1}
                      title="Descer"
                      className="rounded p-1 text-zinc-500 transition hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-900"
                    >
                      <MdExpandMore className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onChange(schedules.filter((s) => s.id !== schedule.id))}
                      title="Remover faixa"
                      className="rounded p-1 text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      <MdDelete className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : schedule.id)}
                      className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
                    >
                      {open ? "fechar" : "criativos"}
                    </button>
                  </span>
                </div>

                {wraps && (
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                    Passa da meia-noite: vale de {formatMinuteOfDay(schedule.startMinute)} até 23:59
                    e de 00:00 até {formatMinuteOfDay(schedule.endMinute)}.
                  </p>
                )}
                {schedule.startMinute === schedule.endMinute && (
                  <p className="mt-1 text-xs text-red-500">
                    Início e fim não podem ser o mesmo horário.
                  </p>
                )}

                {open && (
                  <div className="mt-3 flex flex-col gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
                    <div>
                      <label className={labelClass}>Título</label>
                      <input
                        value={schedule.title ?? ""}
                        onChange={(e) => patchText(schedule.id, "title", e.target.value)}
                        maxLength={80}
                        placeholder={base.title || "(mantém o do anúncio)"}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Descrição</label>
                      <textarea
                        value={schedule.description ?? ""}
                        onChange={(e) => patchText(schedule.id, "description", e.target.value)}
                        maxLength={400}
                        rows={3}
                        placeholder={base.description || "(mantém a do anúncio)"}
                        className={inputClass}
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Banner</label>
                        <input
                          value={schedule.imageUrl ?? ""}
                          onChange={(e) => patchText(schedule.id, "imageUrl", e.target.value)}
                          placeholder={base.imageUrl || "(mantém o do anúncio)"}
                          className={inputClass}
                        />
                        <PartnerMediaDrop
                          kind="image"
                          compact
                          onUploaded={(url) => patch(schedule.id, { imageUrl: url })}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Ícone quadrado</label>
                        <input
                          value={schedule.iconUrl ?? ""}
                          onChange={(e) => patchText(schedule.id, "iconUrl", e.target.value)}
                          placeholder={base.iconUrl || "(mantém o do anúncio)"}
                          className={inputClass}
                        />
                        <PartnerMediaDrop
                          kind="image"
                          compact
                          onUploaded={(url) => patch(schedule.id, { iconUrl: url })}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className={labelClass}>Texto do botão</label>
                        <input
                          value={schedule.buttonLabel ?? ""}
                          onChange={(e) => patchText(schedule.id, "buttonLabel", e.target.value)}
                          maxLength={40}
                          placeholder={base.buttonLabel || "(mantém o do anúncio)"}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className={labelClass}>Link do botão</label>
                        <input
                          value={schedule.buttonUrl ?? ""}
                          onChange={(e) => patchText(schedule.id, "buttonUrl", e.target.value)}
                          placeholder={base.buttonUrl || "(mantém o do anúncio)"}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {(
                        [
                          ["backgroundColor", "Fundo", base.backgroundColor],
                          ["textColor", "Texto", base.textColor],
                          ["buttonBackgroundColor", "Fundo do botão", base.buttonBackgroundColor],
                          ["buttonTextColor", "Texto do botão", base.buttonTextColor],
                        ] as const
                      ).map(([field, label, fallback]) => {
                        const overridden = schedule[field] !== null;
                        return (
                          <div key={field}>
                            <label className={labelClass}>{label}</label>
                            <input
                              type="color"
                              // A colour input has no empty state, so it always
                              // shows something: the ad's own colour until this
                              // window overrides it — which is also exactly what
                              // the card looks like at that hour.
                              value={schedule[field] ?? fallback}
                              onChange={(e) => patch(schedule.id, { [field]: e.target.value })}
                              className="mt-1 h-9 w-full cursor-pointer rounded-md border border-zinc-300 bg-white p-1 dark:border-zinc-700 dark:bg-zinc-900"
                            />
                            <button
                              type="button"
                              onClick={() => patch(schedule.id, { [field]: null })}
                              disabled={!overridden}
                              className="mt-1 text-[11px] font-medium text-zinc-500 underline underline-offset-2 disabled:no-underline disabled:opacity-40 dark:text-zinc-400"
                            >
                              {overridden ? "usar a do anúncio" : "igual ao anúncio"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange([...schedules, newPartnerSchedule(schedules.length)])}
        disabled={schedules.length >= PARTNER_SCHEDULES_MAX}
        className="mt-3 flex items-center gap-1 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <MdAdd className="h-4 w-4" />
        Adicionar faixa de horário
      </button>
      {schedules.length >= PARTNER_SCHEDULES_MAX && (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Máximo de {PARTNER_SCHEDULES_MAX} faixas por anúncio.
        </p>
      )}
    </div>
  );
}
