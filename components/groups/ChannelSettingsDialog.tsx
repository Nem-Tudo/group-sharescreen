"use client";

import { useState, type FormEvent } from "react";
import useNtPopups from "ntpopups";
import { MdCheck, MdClose, MdRemove, MdTag, MdVolumeUp } from "react-icons/md";
import {
  DialogFrame,
  DialogTabs,
  TogglePill,
  WIDE_POPUP_SIZE,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
  type PopupProps,
} from "@/components/groups/dialogKit";
import {
  deleteChannel,
  renameChannel,
  setChannelPermissions,
  setGroupPermissions,
  type GroupChannel,
  type GroupDetail,
} from "@/lib/groupsApi";
import {
  GENERAL_PERMISSION_KEYS,
  PERMISSION_LABELS,
  TEXT_PERMISSION_KEYS,
  VOICE_PERMISSION_KEYS,
  groupAllows,
  permissionKeysFor,
  sectionOf,
  type ChannelPermissionOverrides,
  type GroupPermissionKey,
  type PermissionSection,
} from "@/lib/groupPermissions";
import { groupPath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { refreshGroup, useGroupDetail } from "@/lib/useGroups";

// One room's own settings — the gear beside a room in the group's list opens
// this (see GroupSidebar), as does the "Salas" tab of the group's settings.
//
//   Geral       — its name, and deleting it.
//   Permissões  — what ordinary members may do in this room: each switch on,
//                 off, or neutral (the group's setting, from the "Permissões"
//                 tab of the group's settings — GroupPermissionsTab below).
//
// The owner and admins may always do everything; none of this applies to them.

type ChannelTab = "general" | "permissions";

/** Opens a room's settings. */
export function useOpenChannelSettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, channelId: string, tab?: ChannelTab) =>
    void openPopup("group_channel", { ...WIDE_POPUP_SIZE, data: { groupId, channelId, tab } });
}

export function ChannelSettingsDialog({
  closePopup,
  data,
}: PopupProps<{ groupId: string; channelId: string; tab?: ChannelTab }>) {
  const groupId = data?.groupId ?? "";
  const { detail } = useGroupDetail(groupId || null);
  const channel = detail?.channels.find((c) => c.id === data?.channelId) ?? null;
  const [tab, setTab] = useState<ChannelTab>(data?.tab ?? "general");
  const isManager = detail?.me.role === "owner" || detail?.me.role === "admin";

  if (!detail || !channel) {
    return (
      <DialogFrame title="Sala" onClose={() => closePopup(false)} wide>
        <p className="text-sm text-zinc-500">{detail ? "Essa sala não existe mais." : "Carregando…"}</p>
      </DialogFrame>
    );
  }

  const Icon = channel.kind === "text" ? MdTag : MdVolumeUp;
  return (
    <DialogFrame
      title={
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="h-5 w-5 shrink-0 opacity-60" />
          <span className="truncate">{channel.name}</span>
        </span>
      }
      onClose={() => closePopup(false)}
      wide
    >
      {!isManager ? (
        <p className="text-sm text-zinc-500">Só os administradores do grupo mexem nas configurações das salas.</p>
      ) : (
        <>
          <DialogTabs
            tabs={[
              { id: "general" as const, label: "Geral" },
              { id: "permissions" as const, label: "Permissões" },
            ]}
            current={tab}
            onChange={setTab}
          />
          {tab === "general" && <GeneralTab detail={detail} channel={channel} onDeleted={() => closePopup(true)} />}
          {tab === "permissions" && <ChannelPermissionsTab detail={detail} channel={channel} />}
        </>
      )}
    </DialogFrame>
  );
}

// ─── Geral ────────────────────────────────────────────────────────────────

function GeneralTab({ detail, channel, onDeleted }: { detail: GroupDetail; channel: GroupChannel; onDeleted: () => void }) {
  const navigation = useGroupNavigation();
  const groupId = detail.group.id;
  const [name, setName] = useState(channel.name);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const lastTextRoom = channel.kind === "text" && detail.channels.filter((c) => c.kind === "text").length <= 1;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || name.trim() === channel.name) return;
    setBusy(true);
    const result = await renameChannel(groupId, channel.id, name.trim());
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: "Salvo." } : { ok: false, text: result.error });
    if (result.ok) {
      setName(result.channel.name);
      void refreshGroup(groupId);
    }
  }

  async function remove() {
    setBusy(true);
    const result = await deleteChannel(groupId, channel.id);
    setBusy(false);
    if (!result.ok) {
      setConfirmDelete(false);
      setMessage({ ok: false, text: result.error });
      return;
    }
    await refreshGroup(groupId);
    onDeleted();
    // Standing in it? The group's page picks the next room.
    if (typeof window !== "undefined" && window.location.pathname.endsWith(`/${channel.id}`)) {
      navigation.replace(groupPath(groupId));
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={save} className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome da sala</span>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className={inputClass} />
          <button type="submit" disabled={busy || !name.trim() || name.trim() === channel.name} className={`${primaryButton} shrink-0`}>
            Salvar
          </button>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {channel.kind === "text" ? "Sala de texto" : "Sala de voz"}
        </span>
      </form>

      <div className="flex flex-col gap-2 rounded-lg border border-red-200 p-3 dark:border-red-900/60">
        <p className="text-sm font-medium text-red-600 dark:text-red-400">Apagar sala</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {lastTextRoom
            ? "Esta é a única sala de texto do grupo — crie outra antes de apagar esta."
            : channel.kind === "text"
              ? "Apaga a sala e todas as mensagens dela, para todo mundo. Não dá pra desfazer."
              : "Apaga a sala para todo mundo. Quem estiver na chamada sai dela."}
        </p>
        {confirmDelete ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void remove()} className={dangerButton}>
              Sim, apagar {channel.kind === "text" ? `#${channel.name}` : channel.name}
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className={secondaryButton}>
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={lastTextRoom}
            onClick={() => setConfirmDelete(true)}
            className={`${secondaryButton} self-start !border-red-300 !text-red-600 dark:!border-red-900 dark:!text-red-400`}
          >
            Apagar sala
          </button>
        )}
      </div>

      {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
    </div>
  );
}

// ─── Permissões (da sala) ─────────────────────────────────────────────────

type TriState = "off" | "neutral" | "on";

function triOf(value: boolean | undefined): TriState {
  return value === true ? "on" : value === false ? "off" : "neutral";
}

/** Off / neutral / on, side by side — the three a room's switch can be. */
function TriStateControl({
  value,
  onChange,
  disabled,
}: {
  value: TriState;
  onChange: (next: TriState) => void;
  disabled?: boolean;
}) {
  const options: { id: TriState; label: string; icon: typeof MdCheck; active: string }[] = [
    { id: "off", label: "Desativada", icon: MdClose, active: "bg-red-600 text-white" },
    { id: "neutral", label: "Neutra (segue o grupo)", icon: MdRemove, active: "bg-zinc-500 text-white dark:bg-zinc-600" },
    { id: "on", label: "Ativada", icon: MdCheck, active: "bg-emerald-600 text-white" },
  ];
  return (
    <div role="radiogroup" className="inline-flex shrink-0 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
      {options.map(({ id, label, icon: Icon, active }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={value === id}
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={() => onChange(id)}
          className={`flex h-8 w-9 cursor-pointer items-center justify-center transition disabled:cursor-not-allowed disabled:opacity-60 ${
            value === id
              ? active
              : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          } ${id !== "off" ? "border-l border-zinc-300 dark:border-zinc-700" : ""}`}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}

function ChannelPermissionsTab({ detail, channel }: { detail: GroupDetail; channel: GroupChannel }) {
  const openGroupSettings = useOpenGroupSettings();
  const groupId = detail.group.id;
  // What was last sent, shown at once rather than after the round trip.
  const [local, setLocal] = useState<ChannelPermissionOverrides>(channel.permissions ?? {});
  const [error, setError] = useState<string | null>(null);

  async function change(key: GroupPermissionKey, next: TriState) {
    const previous = local;
    const overrides: ChannelPermissionOverrides = { ...local };
    if (next === "neutral") delete overrides[key];
    else overrides[key] = next === "on";
    setLocal(overrides);
    setError(null);
    const result = await setChannelPermissions(groupId, channel.id, overrides);
    if (!result.ok) {
      setLocal(previous);
      setError(result.error);
      return;
    }
    void refreshGroup(groupId);
  }

  const keys = permissionKeysFor(channel.kind);
  const overridden = keys.some((key) => typeof local[key] === "boolean");
  // The same sections as the group's own tab: the general switches, then
  // this room's kind.
  const sections: { title: string; keys: readonly GroupPermissionKey[] }[] = [
    { title: "Gerais", keys: GENERAL_PERMISSION_KEYS },
    {
      title: channel.kind === "text" ? "Sala de texto" : "Sala de voz",
      keys: channel.kind === "text" ? TEXT_PERMISSION_KEYS : VOICE_PERMISSION_KEYS,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        O que os membros podem fazer nesta sala. <b>Neutra</b> segue o que está definido para o grupo todo;{" "}
        <b>ativada</b> ou <b>desativada</b> vale só aqui. O dono e os administradores podem tudo, sempre.
      </p>
      {sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{section.title}</p>
          <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {section.keys.map((key) => {
              const value = triOf(local[key]);
              const inherited = groupAllows(detail.group.permissions, key);
              const effective = value === "neutral" ? inherited : value === "on";
              const { label, hint } = PERMISSION_LABELS[key];
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {value === "neutral" ? (
                        <>
                          Segue o grupo:{" "}
                          <span className={inherited ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}>
                            {inherited ? "ativada" : "desativada"}
                          </span>
                        </>
                      ) : (
                        <span className={effective ? "text-emerald-600 dark:text-emerald-500" : "text-red-500"}>
                          {effective ? "Ativada nesta sala" : "Desativada nesta sala"}
                        </span>
                      )}
                      {hint && <> · {hint}</>}
                    </p>
                  </div>
                  <TriStateControl value={value} onChange={(next) => void change(key, next)} />
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => openGroupSettings(groupId, "permissions")}
          className="cursor-pointer text-sm font-medium text-zinc-600 underline underline-offset-2 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Permissões do grupo todo
        </button>
        {overridden && (
          <button
            type="button"
            onClick={async () => {
              const previous = local;
              setLocal({});
              const result = await setChannelPermissions(groupId, channel.id, {});
              if (!result.ok) {
                setLocal(previous);
                setError(result.error);
                return;
              }
              void refreshGroup(groupId);
            }}
            className={secondaryButton}
          >
            Deixar tudo neutro
          </button>
        )}
      </div>
    </div>
  );
}

function useOpenGroupSettings() {
  const { openPopup } = useNtPopups();
  return (groupId: string, tab?: string) =>
    void openPopup("group_settings", { ...WIDE_POPUP_SIZE, data: { groupId, tab } });
}

// ─── Permissões (do grupo) ────────────────────────────────────────────────

/**
 * The group-wide switches — the "group settings" tab. The general ones are on
 * or off for every room; the others for every room of their kind. Any room may
 * say otherwise.
 */
export function GroupPermissionsTab({ groupId }: { groupId: string }) {
  const { detail } = useGroupDetail(groupId);
  const [pending, setPending] = useState<Partial<Record<GroupPermissionKey, boolean>>>({});
  const [error, setError] = useState<string | null>(null);
  if (!detail) return null;

  const valueOf = (key: GroupPermissionKey) => pending[key] ?? groupAllows(detail.group.permissions, key);

  async function toggle(key: GroupPermissionKey) {
    const next = !valueOf(key);
    setPending((p) => ({ ...p, [key]: next }));
    setError(null);
    const result = await setGroupPermissions(groupId, { [sectionOf(key)]: { [key]: next } });
    if (!result.ok) setError(result.error);
    await refreshGroup(groupId);
    setPending((p) => {
      const rest = { ...p };
      delete rest[key];
      return rest;
    });
  }

  // How many rooms say otherwise — worth knowing before flipping a switch
  // that some rooms will not follow. A general switch can be set in any room.
  const overriding = (key: GroupPermissionKey, section: PermissionSection) =>
    detail.channels.filter(
      (c) => (section === "general" || c.kind === section) && typeof c.permissions?.[key] === "boolean"
    ).length;

  const section = (id: PermissionSection, title: string, keys: readonly GroupPermissionKey[]) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</p>
      <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {keys.map((key) => {
          const on = valueOf(key);
          const { label, hint } = PERMISSION_LABELS[key];
          const exceptions = overriding(key, id);
          return (
            <li key={key}>
              <button
                type="button"
                onClick={() => void toggle(key)}
                aria-pressed={on}
                className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
                  {(hint || exceptions > 0) && (
                    <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                      {hint}
                      {hint && exceptions > 0 && " · "}
                      {exceptions > 0 &&
                        `${exceptions} ${exceptions === 1 ? "sala define" : "salas definem"} diferente`}
                    </span>
                  )}
                </span>
                <TogglePill on={on} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        O que os membros podem fazer em todas as salas do grupo. Cada sala pode mudar isso nas configurações dela
        (a engrenagem ao lado do nome). O dono e os administradores podem tudo, sempre.
      </p>
      {section("general", "Gerais", GENERAL_PERMISSION_KEYS)}
      {section("text", "Salas de texto", TEXT_PERMISSION_KEYS)}
      {section("voice", "Salas de voz", VOICE_PERMISSION_KEYS)}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
