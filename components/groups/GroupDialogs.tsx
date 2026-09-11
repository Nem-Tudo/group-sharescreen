"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import {
  MdAddPhotoAlternate,
  MdArrowDownward,
  MdArrowUpward,
  MdCheck,
  MdContentCopy,
  MdDeleteOutline,
  MdEdit,
  MdLockOutline,
  MdOutlineMap,
  MdPublic,
  MdTag,
  MdTune,
  MdVolumeUp,
} from "react-icons/md";
import { FaCrown } from "react-icons/fa";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { AVATAR_IMAGE_ACCEPT, isSupportedAvatarImage, prepareAvatarImage } from "@/lib/avatarImage";
import { copyText } from "@/lib/clipboard";
import { hasFeature, verifiedBadge } from "@/lib/entitlements";
import { openProModal } from "@/lib/proModal";
import { useAuth } from "@/lib/AuthContext";
import {
  banMember,
  createGroup,
  createInvite,
  deleteChannel,
  deleteGroup,
  fetchBans,
  fetchInvites,
  fetchMembers,
  kickMember,
  removeGroupIcon,
  renameChannel,
  reorderChannels,
  revokeInvite,
  setGroupAdmin,
  setGroupLocation,
  setGroupVisibility,
  transferGroup,
  unbanMember,
  updateGroup,
  uploadGroupIcon,
  type GroupBan,
  type GroupChannel,
  type GroupInvite,
  type GroupMember,
  type GroupVisibility,
  type InviteLifetime,
} from "@/lib/groupsApi";
import { describeInviteExpiry, groupPath, inviteCodeFromInput, invitePath } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { SITE_URL } from "@/lib/seo";
import Link from "next/link";
import { WorldMap } from "@/components/WorldMap";
import { usePublicRoomMarkers } from "@/lib/usePublicRoomMarkers";
import { useGroupMapMarkers } from "@/lib/useGroupMapMarkers";
import { forgetGroup, refreshGroup, refreshGroups, useGroupDetail } from "@/lib/useGroups";
import { getGroupVoiceSession, setGroupVoiceSession } from "@/lib/groupVoiceSession";
import {
  DialogFrame,
  DialogTabs,
  WIDE_POPUP_SIZE,
  dangerButton,
  inputClass,
  primaryButton,
  secondaryButton,
  type PopupProps,
} from "@/components/groups/dialogKit";
import { GroupPermissionsTab, useOpenChannelSettings } from "@/components/groups/ChannelSettingsDialog";

// The group's popups, registered with ntpopups in components/NtPopups.tsx:
//
//   create_group   — name, private or public (and an optional picture), then
//                    straight into it.
//   join_group     — paste an invite link or code.
//   group_invite   — mint a link, with an expiry and a use limit, and copy it.
//   group_settings — everything about running the group, in tabs.
//   group_location — the map on its own: what a new public group is asked.
//
// Destructive steps confirm inline (a second button in place) rather than by
// opening another popup over this one.

/** Where an invite link points — this site, or the public one from inside an app shell. */
function inviteUrl(code: string): string {
  const origin =
    typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : SITE_URL;
  return `${origin}${invitePath(code)}`;
}

// ─── Create ──────────────────────────────────────────────────────────────

/** The size the map popups open at — the map wants the room. */
const MAP_POPUP_SIZE = WIDE_POPUP_SIZE;

// How long after a public group is created its map prompt opens — long enough
// for the group's page to have drawn behind it, like a new room's (see
// WatchRoom's "Você criou uma sala pública!").
const NEW_GROUP_MAP_PROMPT_DELAY_MS = 600;

/** Private or public, as two cards to pick from — in the create dialog and in the settings. */
function VisibilityPicker({
  value,
  onChange,
  disabled,
}: {
  value: GroupVisibility;
  onChange: (next: GroupVisibility) => void;
  disabled?: boolean;
}) {
  const options: { id: GroupVisibility; label: string; hint: string; icon: ReactNode }[] = [
    {
      id: "private",
      label: "Privado",
      hint: "Só entra quem tiver um convite.",
      icon: <MdLockOutline className="h-5 w-5" />,
    },
    {
      id: "public",
      label: "Público",
      hint: "Qualquer um pode entrar.",
      icon: <MdPublic className="h-5 w-5" />,
    },
  ];
  return (
    <div role="radiogroup" aria-label="Visibilidade do grupo" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const selected = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.id)}
            className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-zinc-950 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900"
                : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
            }`}
          >
            <span className={`mt-0.5 shrink-0 ${selected ? "text-zinc-950 dark:text-zinc-50" : "text-zinc-500"}`}>
              {option.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-zinc-950 dark:text-zinc-50">{option.label}</span>
              <span className="block text-xs text-zinc-500 dark:text-zinc-400">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function CreateGroupDialog({ closePopup }: PopupProps<object>) {
  const navigation = useGroupNavigation();
  const { openPopup } = useNtPopups();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("private");
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function onPickIcon(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedAvatarImage(file)) {
      setError("Use uma imagem PNG, JPEG, WebP, GIF ou AVIF.");
      return;
    }
    try {
      const prepared = await prepareAvatarImage(file);
      setIcon(prepared.dataUrl);
      setError(null);
    } catch {
      setError("Não foi possível ler essa imagem.");
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await createGroup(name.trim(), visibility);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    const groupId = result.group.id;
    if (icon) await uploadGroupIcon(groupId, icon);
    await refreshGroups();
    closePopup(true);
    navigation.push(groupPath(groupId));
    // A public group is at its most findable the moment it exists and its
    // owner is right here — so ask where it is now, the way a new public room
    // does, rather than leave it to be found in the settings some day.
    if (visibility === "public") {
      setTimeout(() => {
        void openPopup("group_location", { ...MAP_POPUP_SIZE, data: { groupId, justCreated: true } });
      }, NEW_GROUP_MAP_PROMPT_DELAY_MS);
    }
  }

  return (
    <DialogFrame title="Criar um grupo" onClose={() => closePopup(false)}>
      <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        Um lugar permanente com salas de voz e de texto para você e seus amigos.
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative shrink-0 cursor-pointer"
            aria-label="Escolher ícone"
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt="Ícone" className="h-20 w-20 rounded-2xl object-cover" />
            ) : (
              <span className="flex h-20 w-20 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
                <MdAddPhotoAlternate className="h-6 w-6" />
                Ícone
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept={AVATAR_IMAGE_ACCEPT} hidden onChange={onPickIcon} />
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome do grupo</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder="Ex: Galera do jogo"
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Quem pode entrar?</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} disabled={busy} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">Dá pra trocar depois, nas configurações.</span>
        </div>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          O grupo começa com uma sala de texto <b>#geral</b> e uma sala de voz <b>Geral</b>.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => closePopup(false)} className={secondaryButton}>
            Cancelar
          </button>
          <button type="submit" disabled={!name.trim() || busy} className={primaryButton}>
            {busy ? "Criando…" : "Criar grupo"}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

// ─── Join ────────────────────────────────────────────────────────────────

export function JoinGroupDialog({ closePopup }: PopupProps<object>) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = inviteCodeFromInput(value);
    if (!code) {
      setError("Isso não parece um convite. Cole o link inteiro que te mandaram.");
      return;
    }
    closePopup(true);
    router.push(invitePath(code));
  }

  return (
    <DialogFrame title="Entrar em um grupo" onClose={() => closePopup(false)}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Link ou código do convite</span>
          <input
            autoFocus
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="https://golive.nemtudo.me/invite/AbC123xy"
            className={inputClass}
          />
        </label>
        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => closePopup(false)} className={secondaryButton}>
            Cancelar
          </button>
          <button type="submit" disabled={!value.trim()} className={primaryButton}>
            Continuar
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

// ─── Invite ──────────────────────────────────────────────────────────────

const LIFETIMES: { value: InviteLifetime; label: string }[] = [
  { value: "30m", label: "30 minutos" },
  { value: "1h", label: "1 hora" },
  { value: "6h", label: "6 horas" },
  { value: "1d", label: "1 dia" },
  { value: "7d", label: "7 dias" },
  { value: "never", label: "Nunca" },
];
const MAX_USES = [0, 1, 5, 10, 25, 50, 100];

export function GroupInviteDialog({ closePopup, data }: PopupProps<{ groupId: string; groupName?: string }>) {
  const groupId = data?.groupId ?? "";
  // From the store, for the badge — and the current name, should it have
  // been renamed since whoever opened this was handed one.
  const { detail: inviteDetail } = useGroupDetail(groupId || null);
  const groupName = inviteDetail?.group.name ?? data?.groupName ?? null;
  const [lifetime, setLifetime] = useState<InviteLifetime>("7d");
  const [maxUses, setMaxUses] = useState(0);
  const [invite, setInvite] = useState<GroupInvite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const firstRun = useRef(true);

  async function generate(nextLifetime = lifetime, nextMax = maxUses) {
    setBusy(true);
    const result = await createInvite(groupId, nextLifetime, nextMax || null);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setCopied(false);
    setInvite(result.invite);
  }

  // A link is ready the moment this opens, like Discord's: most people just
  // want to copy one, and the options are there for those who don't.
  useEffect(() => {
    if (!firstRun.current || !groupId) return;
    firstRun.current = false;
    void generate("7d", 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const url = invite ? inviteUrl(invite.code) : "";

  return (
    <DialogFrame
      title={
        groupName ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">Convidar para</span>
            <GroupName name={groupName} flags={inviteDetail?.group.flags} badgeClassName="h-5 w-5" />
          </span>
        ) : (
          "Convidar pessoas"
        )
      }
      onClose={() => closePopup(false)}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Link de convite</span>
        <div className="flex gap-2">
          <input readOnly value={busy && !invite ? "Gerando…" : url} className={`${inputClass} font-mono text-xs`} />
          <button
            type="button"
            disabled={!invite}
            onClick={async () => {
              if (await copyText(url)) {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }
            }}
            className={`${copied ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"} flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition disabled:opacity-50`}
          >
            {copied ? <MdCheck className="h-4 w-4" /> : <MdContentCopy className="h-4 w-4" />}
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
        {invite && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {describeInviteExpiry(invite.expiresAt)}
            {invite.maxUses ? ` · até ${invite.maxUses} ${invite.maxUses === 1 ? "uso" : "usos"}` : " · usos ilimitados"}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Expira depois de</span>
          <select value={lifetime} onChange={(e) => setLifetime(e.target.value as InviteLifetime)} className={inputClass}>
            {LIFETIMES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Número máximo de usos</span>
          <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className={inputClass}>
            {MAX_USES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Sem limite" : n === 1 ? "1 uso" : `${n} usos`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => void generate()} disabled={busy} className={secondaryButton}>
          Gerar novo link
        </button>
      </div>
    </DialogFrame>
  );
}

// ─── Settings ────────────────────────────────────────────────────────────

type SettingsTab = "overview" | "channels" | "permissions" | "map" | "invites" | "members" | "bans" | "danger";

export function GroupSettingsDialog({ closePopup, data }: PopupProps<{ groupId: string; tab?: string }>) {
  const groupId = data?.groupId ?? "";
  const { detail } = useGroupDetail(groupId);
  const role = detail?.me.role ?? "member";
  const isManager = role === "owner" || role === "admin";
  const isOwner = role === "owner";

  const tabs: { id: SettingsTab; label: string; show: boolean }[] = [
    { id: "overview", label: "Visão geral", show: isManager },
    { id: "channels", label: "Salas", show: isManager },
    { id: "permissions", label: "Permissões", show: isManager },
    { id: "map", label: "Mapa", show: isManager },
    { id: "invites", label: "Convites", show: isManager },
    { id: "members", label: "Membros", show: true },
    { id: "bans", label: "Banidos", show: isManager },
    { id: "danger", label: "Zona de perigo", show: isOwner },
  ];
  const visible = tabs.filter((t) => t.show);
  const requested = visible.find((t) => t.id === data?.tab)?.id;
  const [tab, setTab] = useState<SettingsTab>(requested ?? (isManager ? "overview" : "members"));
  const current = visible.some((t) => t.id === tab) ? tab : "members";

  if (!detail) {
    return (
      <DialogFrame title="Grupo" onClose={() => closePopup(false)} wide>
        <p className="text-sm text-zinc-500">Carregando…</p>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      title={<GroupName name={detail.group.name} flags={detail.group.flags} badgeClassName="h-5 w-5" />}
      onClose={() => closePopup(false)}
      wide
    >
      <DialogTabs
        tabs={visible.map((t) => ({ id: t.id, label: t.label, danger: t.id === "danger" }))}
        current={current}
        onChange={setTab}
      />
      {current === "overview" && <OverviewTab groupId={groupId} onGoToMap={() => setTab("map")} />}
      {current === "channels" && <ChannelsTab groupId={groupId} channels={detail.channels} />}
      {current === "permissions" && <GroupPermissionsTab groupId={groupId} />}
      {current === "map" && <LocationTab groupId={groupId} onGoToOverview={() => setTab("overview")} />}
      {current === "invites" && <InvitesTab groupId={groupId} groupName={detail.group.name} />}
      {current === "members" && <MembersTab groupId={groupId} selfId={detail.me.id} role={role} />}
      {current === "bans" && <BansTab groupId={groupId} />}
      {current === "danger" && <DangerTab groupId={groupId} groupName={detail.group.name} onDone={() => closePopup(true)} />}
    </DialogFrame>
  );
}

/**
 * Private or public, in the settings. The owner's to change (the API says the
 * same); admins see it, greyed. Going private with the group on the map says
 * first that it comes off; going public offers the map straight away.
 */
function VisibilitySection({ groupId, onGoToMap }: { groupId: string; onGoToMap: () => void }) {
  const { detail } = useGroupDetail(groupId);
  const [busy, setBusy] = useState(false);
  const [confirmPrivate, setConfirmPrivate] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [justOpened, setJustOpened] = useState(false);
  if (!detail) return null;
  const isOwner = detail.me.role === "owner";
  const current = detail.group.visibility;

  async function change(next: GroupVisibility) {
    setBusy(true);
    setMessage(null);
    const result = await setGroupVisibility(groupId, next);
    setBusy(false);
    setConfirmPrivate(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setJustOpened(next === "public");
    setMessage({
      ok: true,
      text: next === "public" ? "Agora o grupo é público." : "Agora o grupo é privado: só entra quem tiver convite.",
    });
    void refreshGroup(groupId);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Quem pode entrar?</span>
      <VisibilityPicker
        value={current}
        disabled={!isOwner || busy}
        onChange={(next) => {
          if (next === current) return;
          // Coming off the map is the part worth a second look.
          if (next === "private" && detail.group.location) setConfirmPrivate(true);
          else void change(next);
        }}
      />
      {!isOwner && <span className="text-xs text-zinc-500 dark:text-zinc-400">Só o dono do grupo pode mudar isso.</span>}
      {confirmPrivate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="min-w-0 flex-1">Grupos privados não ficam no mapa: o grupo vai sair dele.</span>
          <button type="button" onClick={() => setConfirmPrivate(false)} className={secondaryButton}>
            Cancelar
          </button>
          <button type="button" disabled={busy} onClick={() => void change("private")} className={primaryButton}>
            Tornar privado
          </button>
        </div>
      )}
      {message && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>
          {justOpened && !detail.group.location && (
            <button type="button" onClick={onGoToMap} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
              <MdOutlineMap className="h-4 w-4" />
              Colocar no mapa
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ groupId, onGoToMap }: { groupId: string; onGoToMap: () => void }) {
  const { detail } = useGroupDetail(groupId);
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const hasThemePlan = hasFeature("room_theme_set", account?.features ?? []);
  const [name, setName] = useState(detail?.group.name ?? "");
  const [description, setDescription] = useState(detail?.group.description ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  if (!detail) return null;
  const dirty = name.trim() !== detail.group.name || description.trim() !== detail.group.description;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await updateGroup(groupId, { name: name.trim(), description: description.trim() });
    setBusy(false);
    setMessage(result.ok ? { ok: true, text: "Salvo." } : { ok: false, text: result.error });
    if (result.ok) void refreshGroup(groupId);
  }

  async function onPickIcon(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedAvatarImage(file)) {
      setMessage({ ok: false, text: "Use uma imagem PNG, JPEG, WebP, GIF ou AVIF." });
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepareAvatarImage(file);
      const result = await uploadGroupIcon(groupId, prepared.dataUrl);
      setMessage(result.ok ? { ok: true, text: "Ícone atualizado." } : { ok: false, text: result.error });
      if (result.ok) void refreshGroup(groupId);
    } catch {
      setMessage({ ok: false, text: "Não foi possível ler essa imagem." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <GroupIcon name={detail.group.name} iconUrl={detail.group.iconUrl} seed={groupId} size={80} className="rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={secondaryButton}>
            Trocar ícone
          </button>
          {detail.group.iconUrl && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                const result = await removeGroupIcon(groupId);
                if (result.ok) void refreshGroup(groupId);
              }}
              className={secondaryButton}
            >
              Remover
            </button>
          )}
          <input ref={fileRef} type="file" accept={AVATAR_IMAGE_ACCEPT} hidden onChange={onPickIcon} />
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Descrição</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder="Sobre o que é este grupo?"
          className={`${inputClass} resize-none`}
        />
      </label>
      <VisibilitySection groupId={groupId} onGoToMap={onGoToMap} />
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Tema do grupo</span>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-zinc-500 dark:text-zinc-400">
            {detail.group.theme
              ? "O grupo tem um tema: todo mundo vê ele, em todas as salas."
              : "Sem tema: cada um vê o tema que escolheu para si."}
          </p>
          <button
            type="button"
            onClick={() => {
              if (!hasThemePlan) {
                openProModal("premium_max");
                return;
              }
              void openPopup("room_theme", { data: { currentThemeId: detail.group.theme, groupId } });
            }}
            className={secondaryButton}
          >
            {hasThemePlan ? "Escolher tema" : "Pro Max"}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        {message && <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
        <button type="submit" disabled={!dirty || !name.trim() || busy} className={primaryButton}>
          Salvar
        </button>
      </div>
    </form>
  );
}

/**
 * Where the group sits on the public map (/worldmap) — the room's "Definir
 * local do mundo", for a group. The same map in picker mode, the same privacy
 * note; what differs is that a group's pin stays, where a room's goes when the
 * room empties.
 */
function LocationTab({
  groupId,
  onGoToOverview,
  celebrating = false,
  onDone,
}: {
  groupId: string;
  /** Where a private group's owner goes to open it up — the settings' first tab. */
  onGoToOverview?: () => void;
  /** Opened by itself, right after a public group was created: introduced as that, and gone once answered. */
  celebrating?: boolean;
  onDone?: () => void;
}) {
  const { detail } = useGroupDetail(groupId);
  const saved = detail?.group.location ?? null;
  const [pick, setPick] = useState<{ lat: number; lng: number } | null>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Everything already on the map, for context around the spot being picked —
  // this group's own pin left out, since it is the pick marker.
  const { markers: roomMarkers } = usePublicRoomMarkers();
  const { markers: groupMarkers } = useGroupMapMarkers({ excludeId: groupId });
  const moved = pick?.lat !== saved?.lat || pick?.lng !== saved?.lng;

  async function save(location: { lat: number; lng: number } | null) {
    setBusy(true);
    const result = await setGroupLocation(groupId, location);
    setBusy(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    if (!location) setPick(null);
    setMessage({ ok: true, text: location ? "Local salvo." : "O grupo saiu do mapa." });
    void refreshGroup(groupId);
    // The prompt nobody asked for is a one-shot errand: done, out of the way.
    if (celebrating && location) onDone?.();
  }

  if (detail && detail.group.visibility !== "public") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <MdLockOutline className="h-4 w-4 shrink-0" />
          Este grupo é privado
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Grupos privados não aparecem no mapa: só dá pra entrar neles com convite. Para colocar o grupo no mapa,
          torne-o público.
        </p>
        {detail.me.role === "owner" && onGoToOverview && (
          <button type="button" onClick={onGoToOverview} className={secondaryButton}>
            Mudar a visibilidade
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {celebrating ? "Seu grupo é público: qualquer um pode entrar. Marque no " : "Coloque o grupo no "}
        <Link href="/worldmap" target="_blank" className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">
          mapa de salas e grupos
        </Link>
        {celebrating
          ? " de onde ele é — bairro, cidade ou país — para quem é de perto achar ele. Ele fica no mapa mesmo sem ninguém em chamada."
          : ", para quem é de perto achar ele. Diferente de uma sala, o grupo continua no mapa mesmo sem ninguém em chamada — até alguém tirar ou o grupo ser apagado."}
      </p>
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Privacidade: nada aqui é detectado.</span>{" "}
        O lugar é só o que você clicar no mapa — o site nunca lê a localização do seu aparelho. Pode ser tão vago
        quanto quiser: um país, uma cidade, um bairro. No mapa aparecem o nome, o ícone, a descrição e quantos
        membros o grupo tem; nunca quem são.
      </p>
      <div className="h-[min(50vh,24rem)] min-h-64 overflow-hidden rounded-lg border border-zinc-300 dark:border-zinc-700">
        <WorldMap
          className="h-full w-full"
          searchable
          markers={[...groupMarkers, ...roomMarkers]}
          pick={pick}
          onPick={(lat, lng) => {
            setPick({ lat, lng });
            setMessage(null);
          }}
          center={pick ? [pick.lat, pick.lng] : undefined}
          zoom={pick ? 6 : undefined}
        />
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {pick ? (
          <>
            Alfinete em{" "}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">
              {pick.lat.toFixed(4)}, {pick.lng.toFixed(4)}
            </span>
            {!moved && " (local salvo)"}
          </>
        ) : (
          "O grupo ainda não está no mapa. Clique num lugar ou pesquise uma cidade."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!pick || !moved || busy}
          onClick={() => void save(pick)}
          className="flex-1 cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saved ? "Salvar novo local" : "Salvar local"}
        </button>
        {/* Only in the prompt nobody asked for; everywhere else the × is the way out. */}
        {celebrating && (
          <button type="button" onClick={onDone} className={secondaryButton}>
            Agora não
          </button>
        )}
        {saved && !celebrating && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="cursor-pointer rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            Remover do mapa
          </button>
        )}
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
    </div>
  );
}

/**
 * "Você criou um grupo público!" — the map tab on its own, opened by itself
 * right after a public group is created (see CreateGroupDialog). The same
 * errand a new public room is sent on (see WatchRoom's newRoomPopup).
 */
export function GroupLocationDialog({ closePopup, data }: PopupProps<{ groupId: string; justCreated?: boolean }>) {
  const groupId = data?.groupId ?? "";
  const celebrating = Boolean(data?.justCreated);
  const { detail } = useGroupDetail(groupId || null);
  return (
    <DialogFrame
      title={
        <span className="inline-flex items-center gap-2">
          <MdOutlineMap className="h-5 w-5 shrink-0 text-blue-500" />
          {celebrating ? "Você criou um grupo público!" : "Local do grupo no mapa"}
        </span>
      }
      onClose={() => closePopup(false)}
      wide
    >
      {detail ? (
        <LocationTab groupId={groupId} celebrating={celebrating} onDone={() => closePopup(true)} />
      ) : (
        <p className="text-sm text-zinc-500">Carregando…</p>
      )}
    </DialogFrame>
  );
}

function ChannelsTab({ groupId, channels }: { groupId: string; channels: GroupChannel[] }) {
  const openChannelSettings = useOpenChannelSettings();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: Promise<{ ok: boolean; error?: string }>) {
    const result = await action;
    if (!result.ok) setError(result.error ?? "Algo deu errado.");
    else setError(null);
    void refreshGroup(groupId);
  }

  function move(kind: GroupChannel["kind"], id: string, delta: number) {
    const ofKind = channels.filter((c) => c.kind === kind);
    const index = ofKind.findIndex((c) => c.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ofKind.length) return;
    const ids = ofKind.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(reorderChannels(groupId, ids));
  }

  function section(kind: GroupChannel["kind"], label: string) {
    const list = channels.filter((c) => c.kind === kind);
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
        {list.map((channel, index) => (
          <div
            key={channel.id}
            className="flex items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 dark:border-zinc-800"
          >
            {kind === "text" ? <MdTag className="h-4 w-4 shrink-0 opacity-60" /> : <MdVolumeUp className="h-4 w-4 shrink-0 opacity-60" />}
            {editing === channel.id ? (
              <form
                className="flex min-w-0 flex-1 gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  setEditing(null);
                  void run(renameChannel(groupId, channel.id, draft));
                }}
              >
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={32} className={`${inputClass} py-1`} />
                <button type="submit" className="cursor-pointer rounded-md bg-emerald-600 px-2 text-white" aria-label="Salvar">
                  <MdCheck className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate text-sm">{channel.name}</span>
                {Object.keys(channel.permissions ?? {}).length > 0 && (
                  <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    permissões próprias
                  </span>
                )}
              </span>
            )}
            {confirming === channel.id ? (
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setConfirming(null);
                    void run(deleteChannel(groupId, channel.id));
                  }}
                  className="cursor-pointer rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white"
                >
                  Apagar
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="cursor-pointer px-1 text-xs text-zinc-500">
                  Cancelar
                </button>
              </span>
            ) : (
              <span className="flex shrink-0 items-center">
                <IconButton label="Subir" disabled={index === 0} onClick={() => move(kind, channel.id, -1)}>
                  <MdArrowUpward className="h-4 w-4" />
                </IconButton>
                <IconButton label="Descer" disabled={index === list.length - 1} onClick={() => move(kind, channel.id, 1)}>
                  <MdArrowDownward className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Renomear"
                  onClick={() => {
                    setEditing(channel.id);
                    setDraft(channel.name);
                  }}
                >
                  <MdEdit className="h-4 w-4" />
                </IconButton>
                <IconButton label="Permissões da sala" onClick={() => openChannelSettings(groupId, channel.id, "permissions")}>
                  <MdTune className="h-4 w-4" />
                </IconButton>
                <IconButton label="Apagar" danger onClick={() => setConfirming(channel.id)}>
                  <MdDeleteOutline className="h-4 w-4" />
                </IconButton>
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {section("text", "Salas de texto")}
      {section("voice", "Salas de voz")}
      {error && <p className="text-sm text-red-500">{error}</p>}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Para criar uma sala, use o <b>+</b> ao lado de “Salas de texto” ou “Salas de voz” na lista do grupo.
        Apagar uma sala de texto apaga as mensagens dela.
      </p>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`cursor-pointer rounded-md p-1 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "text-red-500 hover:bg-red-500/10" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function InvitesTab({ groupId, groupName }: { groupId: string; groupName: string }) {
  const { openPopup } = useNtPopups();
  const [invites, setInvites] = useState<GroupInvite[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchInvites(groupId).then((result) => {
      if (!cancelled) setInvites(result.ok ? result.invites : []);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId, seq]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Links ativos que deixam alguém entrar no grupo.</p>
        <button
          type="button"
          onClick={() => void openPopup("group_invite", { data: { groupId, groupName }, onClose: () => setSeq((s) => s + 1) })}
          className={primaryButton}
        >
          Novo convite
        </button>
      </div>
      {invites === null && <p className="text-sm text-zinc-500">Carregando…</p>}
      {invites?.length === 0 && <p className="text-sm text-zinc-500">Nenhum convite ativo.</p>}
      <ul className="flex flex-col gap-1.5">
        {invites?.map((invite) => (
          <li
            key={invite.code}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <span className="font-mono text-xs">{invite.code}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {invite.uses}
              {invite.maxUses ? `/${invite.maxUses}` : ""} {invite.uses === 1 ? "uso" : "usos"} ·{" "}
              {describeInviteExpiry(invite.expiresAt)} · por {invite.createdByName ?? "alguém"}
            </span>
            <span className="ml-auto flex gap-1">
              <button
                type="button"
                onClick={async () => {
                  if (await copyText(inviteUrl(invite.code))) {
                    setCopied(invite.code);
                    setTimeout(() => setCopied(null), 2000);
                  }
                }}
                className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {copied === invite.code ? "Copiado!" : "Copiar link"}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await revokeInvite(groupId, invite.code);
                  if (result.ok) setInvites((list) => list?.filter((i) => i.code !== invite.code) ?? null);
                }}
                className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10"
              >
                Revogar
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const ROLE_LABELS = { owner: "Dono", admin: "Admin", member: "Membro" } as const;

function MembersTab({ groupId, selfId, role }: { groupId: string; selfId: string; role: "owner" | "admin" | "member" }) {
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; action: "kick" | "ban" | "transfer" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const { detail } = useGroupDetail(groupId);

  useEffect(() => {
    let cancelled = false;
    void fetchMembers(groupId).then((result) => {
      if (!cancelled) setMembers(result.ok ? result.members : []);
    });
    return () => {
      cancelled = true;
    };
    // Re-read when the group itself changed (someone joined, a role moved).
  }, [groupId, seq, detail?.group.memberCount, detail?.group.admins.length, detail?.group.ownerId]);

  async function run(action: Promise<{ ok: boolean; error?: string }>) {
    const result = await action;
    setConfirm(null);
    if (!result.ok) setError(result.error ?? "Algo deu errado.");
    else setError(null);
    setSeq((s) => s + 1);
    void refreshGroup(groupId);
  }

  const isOwner = role === "owner";
  const isManager = role === "owner" || role === "admin";

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {members === null && <p className="text-sm text-zinc-500">Carregando…</p>}
      <ul className="flex flex-col gap-1">
        {members?.map((member) => {
          const self = member.id === selfId;
          // Nobody acts on the owner; only the owner acts on an admin.
          const canModerate = isManager && !self && member.role !== "owner" && (isOwner || member.role !== "admin");
          const pendingConfirm = confirm?.userId === member.id ? confirm.action : null;
          return (
            <li key={member.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <span className="relative">
                <UserAvatar src={member.avatarUrl} name={member.name} size={32} />
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-zinc-950 ${
                    member.online ? "bg-emerald-500" : "bg-zinc-400"
                  }`}
                />
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <DisplayUserName
                  name={member.name}
                  isGuest={member.guest}
                  verified={verifiedBadge(member.flags)}
                  color={member.nameColor}
                  className="truncate text-sm font-medium"
                />
                {member.role !== "member" && (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      member.role === "owner"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                    }`}
                  >
                    {member.role === "owner" && <FaCrown className="h-3 w-3" />}
                    {ROLE_LABELS[member.role]}
                  </span>
                )}
              </span>
              {pendingConfirm ? (
                <span className="flex items-center gap-1">
                  <span className="text-xs text-zinc-500">
                    {pendingConfirm === "kick"
                      ? "Remover do grupo?"
                      : pendingConfirm === "ban"
                        ? "Banir do grupo?"
                        : "Passar a posse do grupo?"}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void run(
                        pendingConfirm === "kick"
                          ? kickMember(groupId, member.id)
                          : pendingConfirm === "ban"
                            ? banMember(groupId, member.id)
                            : transferGroup(groupId, member.id)
                      )
                    }
                    className="cursor-pointer rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white"
                  >
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setConfirm(null)} className="cursor-pointer px-1 text-xs text-zinc-500">
                    Cancelar
                  </button>
                </span>
              ) : (
                <span className="flex flex-wrap items-center gap-1">
                  {isOwner && !self && (
                    <button
                      type="button"
                      onClick={() => void run(setGroupAdmin(groupId, member.id, member.role !== "admin"))}
                      className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      {member.role === "admin" ? "Tirar admin" : "Tornar admin"}
                    </button>
                  )}
                  {isOwner && !self && !member.guest && (
                    <button
                      type="button"
                      onClick={() => setConfirm({ userId: member.id, action: "transfer" })}
                      className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10"
                    >
                      Passar posse
                    </button>
                  )}
                  {canModerate && (
                    <>
                      <button
                        type="button"
                        onClick={() => setConfirm({ userId: member.id, action: "kick" })}
                        className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      >
                        Remover
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirm({ userId: member.id, action: "ban" })}
                        className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10"
                      >
                        Banir
                      </button>
                    </>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BansTab({ groupId }: { groupId: string }) {
  const [bans, setBans] = useState<GroupBan[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchBans(groupId).then((result) => {
      if (!cancelled) setBans(result.ok ? result.bans : []);
    });
    return () => {
      cancelled = true;
    };
  }, [groupId]);
  return (
    <div className="flex flex-col gap-2">
      {bans === null && <p className="text-sm text-zinc-500">Carregando…</p>}
      {bans?.length === 0 && <p className="text-sm text-zinc-500">Ninguém foi banido deste grupo.</p>}
      <ul className="flex flex-col gap-1">
        {bans?.map((ban) => (
          <li key={ban.userId} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <span className="min-w-0 flex-1 truncate font-medium">{ban.name}</span>
            <span className="text-xs text-zinc-500">{new Date(ban.bannedAt).toLocaleDateString("pt-BR")}</span>
            <button
              type="button"
              onClick={async () => {
                const result = await unbanMember(groupId, ban.userId);
                if (result.ok) setBans(result.bans);
              }}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Desbanir
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DangerTab({ groupId, groupName, onDone }: { groupId: string; groupName: string; onDone: () => void }) {
  const navigation = useGroupNavigation();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-red-300 p-4 dark:border-red-900">
      <p className="font-semibold text-red-600">Apagar o grupo</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Apaga o grupo, todas as salas, mensagens e convites, para todo mundo. Não dá para desfazer. Se você só quer
        sair, passe a posse para outra pessoa na aba Membros.
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-500">
          Digite <b>{groupName}</b> para confirmar
        </span>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className={inputClass} />
      </label>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={typed.trim() !== groupName || busy}
          onClick={async () => {
            setBusy(true);
            const result = await deleteGroup(groupId);
            setBusy(false);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            if (getGroupVoiceSession()?.groupId === groupId) setGroupVoiceSession(null);
            forgetGroup(groupId);
            onDone();
            navigation.push("/groups");
          }}
          className={dangerButton}
        >
          Apagar grupo para sempre
        </button>
      </div>
    </div>
  );
}
