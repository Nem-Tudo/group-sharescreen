"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import {
  MdAddPhotoAlternate,
  MdArrowDownward,
  MdBlock,
  MdCreateNewFolder,
  MdChatBubbleOutline,
  MdEmojiEmotions,
  MdInfoOutline,
  MdMoreVert,
  MdPeopleOutline,
  MdShield,
  MdSmartToy,
  MdWarningAmber,
  MdAutoAwesome,
  MdArrowUpward,
  MdCheck,
  MdContentCopy,
  MdDeleteOutline,
  MdEdit,
  MdSwapVert,
  MdLockOutline,
  MdAdd,
  MdChevronRight,
  MdExplore,
  MdLink,
  MdOutlineMap,
  MdPublic,
  MdTag,
  MdTune,
  MdVolumeUp,
  MdClose,
} from "react-icons/md";
import type { IconType } from "react-icons";
import { FaCrown } from "react-icons/fa";
import { DisplayUserName } from "@/components/DisplayUserName";
import { UserAvatar } from "@/components/UserAvatar";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { ImageCropDialog } from "@/components/ImageCropDialog";
import { GroupName } from "@/components/groups/GroupName";
import { AVATAR_IMAGE_ACCEPT, isSupportedAvatarImage, prepareAvatarImage } from "@/lib/avatarImage";
import { copyText } from "@/lib/clipboard";
import { hasFeature, verifiedBadge } from "@/lib/entitlements";
import { openProModal } from "@/lib/proModal";
import { useAuth } from "@/lib/AuthContext";
import {
  banMember,
  createCategory,
  createChannel,
  createGroup,
  fetchDiscordTemplate,
  parseDiscordTemplateCode,
  type DiscordTemplatePreview,
  createInvite,
  deleteChannel,
  deleteGroup,
  fetchBans,
  fetchInvites,
  fetchMembers,
  kickMember,
  removeGroupIcon,
  renameChannel,
  deleteCategory,
  renameCategory,
  setCategoryTextFirst,
  revokeInvite,
  setCustomInvite,
  setGroupLayout,
  setGroupLocation,
  setGroupVisibility,
  setMemberRoles,
  transferGroup,
  unbanMember,
  updateGroup,
  uploadGroupIcon,
  type GroupBan,
  type GroupCategory,
  type GroupChannel,
  type GroupChannelKind,
  type GroupDetail,
  type GroupInvite,
  type GroupMember,
  type GroupVisibility,
  type InviteLifetime,
} from "@/lib/groupsApi";
import {
  CUSTOM_INVITE_RE,
  GROUPS_EXPLORE_PATH,
  describeInviteExpiry,
  groupPath,
  inviteCodeFromInput,
  invitePath,
} from "@/lib/groupLinks";
import { useGroupsHub } from "@/lib/groupsHub";
import { useGroupNavigation } from "@/lib/groupNavigation";
import {
  buildSections,
  moveCategory,
  moveChannel,
  roomsInOrder,
  toPayload,
  type LayoutSection,
} from "@/lib/groupLayout";
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
import { useOpenChannelSettings } from "@/components/groups/ChannelSettingsDialog";
import { RolesTab } from "@/components/groups/RolesTab";
import { RoleChip } from "@/components/groups/RoleChip";
import { requestExploreGroups } from "@/components/groups/groupSearch";
import { BotBrowser } from "@/components/bots/BotBrowser";
import { AuraTab } from "@/components/groups/AuraTab";
import { useAuraOf } from "@/components/groups/AuraMark";
import { EmojiManager } from "@/components/EmojiManager";
import { CUSTOM_EMOJI_BADGE, CUSTOM_EMOJI_FEATURE } from "@/lib/customEmoji";
import { BASE_GROUP_EMOJI_SLOTS, DEFAULT_AURA_LEVELS } from "@/lib/groupAura";
import { NewBadge, markFeatureUsed } from "@/components/NewBadge";
import { trackFeatureEvent, useFeature } from "@/lib/features";
import { FaDiscord } from "react-icons/fa";
import { DISCORD_RPC_FEATURE } from "@/lib/discordRpc";
import { GROUP_AURA_BADGE, GROUP_AURA_FEATURE } from "@/lib/groupAura";
import {
  canManage,
  membersRevalidateKey,
  myRank,
  rankOf,
  roleColorOf,
  rolesInOrder,
  rolesWithIds,
  isHandAssignable
} from "@/lib/groupPermissions";
import { useI18n, useT } from "@/lib/useI18n";
import { SM_BREAKPOINT_QUERY, useMediaQuery } from "@/lib/useMediaQuery";
import { useBackHandler } from "@/lib/useBackHandler";
import { translate } from "@/lib/i18n";
import { formatLocale } from "@/lib/i18n";

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

/** "Copiar" that says "Copiado" for a moment once it has. */
function CopyLinkButton({ url, disabled = false }: { url: string; disabled?: boolean }) {
  const { t, tc } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={async () => {
        if (await copyText(url)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }
      }}
      className={`${copied ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-zinc-950 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"} flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition disabled:opacity-50`}
    >
      {copied ? <MdCheck className="h-4 w-4" /> : <MdContentCopy className="h-4 w-4" />}
      {copied ? t("common.copied") : t("common.copy")}
    </button>
  );
}

/**
 * The group's own invite link — /invite/<name>, chosen here, permanent and
 * with no use limit (see the API's GroupDoc.customInvite). Only for a group
 * that may have one: at aura level 2 (see lib/groupAura), or granted by the site. A
 * link set while it could, and no longer can, is shown as switched off — it
 * stays the group's, and can still be taken off.
 */
function CustomInviteSection({ groupId, onGoToAura }: { groupId: string; onGoToAura?: () => void }) {
  const { detail } = useGroupDetail(groupId);
  if (!detail) return null;
  // Keyed by the saved link, so the box starts from it again whenever it
  // changes — here or from another admin's screen.
  return <CustomInviteEditor key={detail.group.customInvite ?? ""} detail={detail} onGoToAura={onGoToAura} />;
}

/** The way to the Aura tab from here, for a group that has not got the link yet. */
function AuraWayIn({ onGoToAura }: { onGoToAura?: () => void }) {
  const { t } = useI18n();
  if (!onGoToAura) return null;
  return (
    <button type="button" onClick={onGoToAura} className={`${primaryButton} self-start`}>
      <span className="flex items-center gap-1.5">
        <MdAutoAwesome className="h-4 w-4" />
        {t("groups.aura.goToAura")}
      </span>
    </button>
  );
}

function CustomInviteEditor({ detail, onGoToAura }: { detail: GroupDetail; onGoToAura?: () => void }) {
  const { t, tc } = useI18n();
  const groupId = detail.group.id;
  const current = detail.group.customInvite ?? null;
  const allowed = detail.group.customInviteAllowed ?? false;
  const [draft, setDraft] = useState(current ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Shown without the scheme: it is what somebody reads out or types.
  const prefix = inviteUrl("").replace(/^https?:\/\//, "");

  if (!allowed && !current) {
    // Held back by the auras, and said so plainly: the link is the level's
    // headline perk, so this is also where somebody finds out auras exist.
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-violet-300 bg-violet-50 p-3 dark:border-violet-500/40 dark:bg-violet-500/10">
        <div className="flex flex-wrap items-center gap-2">
          <MdAutoAwesome className="h-5 w-5 shrink-0 text-violet-500" />
          <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
            {t("groups.groupDialogs.customLink")}
          </span>
          <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-300">
            {t("groups.aura.customInviteNeeds")}
          </span>
        </div>
        <p className="text-xs text-zinc-600 dark:text-zinc-300">{t("groups.aura.customInviteNeedsHint")}</p>
        <AuraWayIn onGoToAura={onGoToAura} />
      </div>
    );
  }

  const cleaned = draft.trim().toLowerCase();
  const valid = CUSTOM_INVITE_RE.test(cleaned);
  const changed = cleaned !== (current ?? "");

  async function save(next: string | null) {
    setBusy(true);
    const result = await setCustomInvite(groupId, next);
    setBusy(false);
    if (!result.ok) {
      setMessage({ ok: false, text: result.error });
      return;
    }
    setMessage({ ok: true, text: next ? t("groups.groupDialogs.linkSaved") : t("groups.groupDialogs.linkRemoved") });
    void refreshGroup(groupId);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!allowed || busy || !valid || !changed) return;
    void save(cleaned);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.customLink")}</span>
        {current && allowed && <CopyLinkButton url={inviteUrl(current)} />}
      </div>
      {current && !allowed && (
        <div className="flex flex-col gap-2 rounded-lg border border-violet-300 bg-violet-50 p-2.5 dark:border-violet-500/40 dark:bg-violet-500/10">
          <p className="text-xs text-zinc-700 dark:text-zinc-200">
            <MdAutoAwesome className="mr-1 inline-block h-4 w-4 align-[-0.25em] text-violet-500" />
            <span className="font-mono">{prefix + current}</span> {t("groups.aura.customInviteDisabled")}
          </p>
          <AuraWayIn onGoToAura={onGoToAura} />
        </div>
      )}
      <form onSubmit={submit} className="flex gap-2">
        <label className="flex min-w-0 flex-1 items-center rounded-lg border border-zinc-300 bg-white focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          <span className="hidden shrink-0 pl-3 font-mono text-xs text-zinc-500 sm:inline dark:text-zinc-400">
            {prefix}
          </span>
          <input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32));
              setMessage(null);
            }}
            disabled={!allowed || busy}
            placeholder="meu-grupo"
            aria-label={t("groups.groupDialogs.customLink")}
            className="min-w-0 flex-1 bg-transparent py-2 pl-3 pr-3 font-mono text-sm text-zinc-950 outline-none disabled:opacity-60 sm:pl-0 dark:text-zinc-50"
          />
        </label>
        <button type="submit" disabled={!allowed || busy || !valid || !changed} className={primaryButton}>
          {t("common.save")}
        </button>
      </form>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {t("groups.groupDialogs.n3To32LowercaseLettersNumbers")}
      </p>
      {current && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save(null)}
          className="self-start cursor-pointer text-xs font-medium text-red-600 underline-offset-2 hover:underline disabled:opacity-50"
        >
          {t("groups.groupDialogs.removeCustomLink")}
        </button>
      )}
      {message && <p className={`text-xs ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</p>}
    </div>
  );
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
  const { t, tc } = useI18n();
  const options: { id: GroupVisibility; label: string; hint: string; icon: ReactNode }[] = [
    {
      id: "private",
      label: t("common.private"),
      hint: t("groups.groupDialogs.onlyThoseWithAnInviteGet"),
      icon: <MdLockOutline className="h-5 w-5" />,
    },
    {
      id: "public",
      label: t("common.public"),
      hint: t("groups.groupDialogs.anyoneCanJoin"),
      icon: <MdPublic className="h-5 w-5" />,
    },
  ];
  return (
    <div role="radiogroup" aria-label={t("groups.groupDialogs.groupVisibility")} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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

// ─── Discord template ──────────────────────────────────────────────────

/** Starting a group laid out like a Discord server template — see the API's discordTemplate.ts. */
const DISCORD_TEMPLATE_FEATURE = "discord-template";
const DISCORD_TEMPLATE_EVENTS = {
  preview: "discord_tpl_preview",
  previewFail: "discord_tpl_preview_fail",
  remove: "discord_tpl_remove",
  create: "discord_tpl_create",
  featured: "discord_tpl_featured",
  help: "discord_tpl_help",
} as const;

/**
 * Discord's own server templates (the ones its "Create a server" screen
 * offers), each checked against /guilds/templates/<code>. A code Discord
 * retires just answers "not found" when picked — nothing breaks.
 */
const FEATURED_DISCORD_TEMPLATES: { code: string; key: string; emoji: string }[] = [
  { code: "hgM48av5Q69A", key: "friends", emoji: "👋" },
  { code: "FbwUwRp4j8Es", key: "study", emoji: "📚" },
  { code: "6exdzMgjZgah", key: "creators", emoji: "🎨" },
  { code: "4sgbPdCjzAYU", key: "global", emoji: "🌎" },
  { code: "64UDvRNCC52Y", key: "local", emoji: "🏘️" },
  { code: "Ctg7PUHcQmZu", key: "clubs", emoji: "🎓" },
  { code: "fVfBazbqjhXg", key: "classroom", emoji: "🏫" },
  { code: "UqzZCTj2zfwy", key: "hackathon", emoji: "💻" },
];

/**
 * The create dialog's "import from Discord": a template link, fetched and
 * shown as the roles and rooms it will make, then sent along with the group.
 */
function DiscordTemplatePicker({
  template,
  disabled,
  onChange,
}: {
  template: DiscordTemplatePreview | null;
  disabled: boolean;
  onChange: (template: DiscordTemplatePreview | null) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState("");
  // The link being loaded, or the featured template's code — for the spinner.
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  async function load(featuredCode?: string) {
    const code = featuredCode ?? parseDiscordTemplateCode(link);
    if (!code) {
      setError(t("groups.discordTemplate.invalidLink"));
      return;
    }
    if (featuredCode) trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.featured, { feature: DISCORD_TEMPLATE_FEATURE });
    setLoading(featuredCode ?? "link");
    setError(null);
    const result = await fetchDiscordTemplate(code);
    setLoading(null);
    if (!result.ok) {
      setError(result.status === 404 ? t("groups.discordTemplate.notFound") : result.error);
      trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.previewFail, { feature: DISCORD_TEMPLATE_FEATURE });
      return;
    }
    trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.preview, { feature: DISCORD_TEMPLATE_FEATURE });
    onChange(result.template);
  }

  if (template) {
    const channelCount =
      template.uncategorized.length + template.categories.reduce((n, c) => n + c.channels.length, 0);
    const skipped = template.skipped.roles + template.skipped.categories + template.skipped.channels;
    const channelLine = (ch: { kind: GroupChannelKind; name: string }, i: number) => (
      <li key={i} className="flex items-center gap-1.5 truncate">
        {ch.kind === "voice" ? (
          <MdVolumeUp className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        ) : (
          <MdTag className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        )}
        <span className="truncate">{ch.name}</span>
      </li>
    );
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-[#5865F2]/40 bg-[#5865F2]/5 p-3">
        <div className="flex items-center gap-2">
          <FaDiscord className="h-5 w-5 shrink-0 text-[#5865F2]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-950 dark:text-zinc-50">{template.name}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {t("groups.discordTemplate.summary", {
                roles: template.roles.length,
                categories: template.categories.length,
                channels: channelCount,
              })}
            </p>
          </div>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.remove, { feature: DISCORD_TEMPLATE_FEATURE });
              onChange(null);
            }}
            className="cursor-pointer rounded-lg p-1 text-zinc-500 hover:bg-zinc-200 disabled:cursor-not-allowed dark:hover:bg-zinc-800"
            aria-label={t("groups.discordTemplate.remove")}
            title={t("groups.discordTemplate.remove")}
          >
            <MdClose className="h-4 w-4" />
          </button>
        </div>
        {template.roles.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {template.roles.slice(0, 12).map((role, i) => (
              <span
                key={i}
                className="inline-flex max-w-[10rem] items-center gap-1 truncate rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] dark:border-zinc-700"
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: role.color ?? "#a1a1aa" }} />
                <span className="truncate">{role.name}</span>
              </span>
            ))}
            {template.roles.length > 12 && (
              <span className="px-1 text-[11px] text-zinc-500">+{template.roles.length - 12}</span>
            )}
          </div>
        )}
        <div className="max-h-40 overflow-y-auto pr-1 text-xs text-zinc-600 dark:text-zinc-300">
          {template.uncategorized.length > 0 && (
            <ul className="mb-1.5 flex flex-col gap-0.5">{template.uncategorized.map(channelLine)}</ul>
          )}
          {template.categories.map((category, i) => (
            <div key={i} className="mb-1.5">
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{category.name}</p>
              <ul className="flex flex-col gap-0.5 pl-1">{category.channels.map(channelLine)}</ul>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          {t("groups.discordTemplate.note")}
          {skipped > 0 && <> {t("groups.discordTemplate.skipped", { count: skipped })}</>}
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center gap-2 self-start rounded-lg px-1 text-sm font-medium text-[#5865F2] hover:underline disabled:cursor-not-allowed"
      >
        <FaDiscord className="h-4 w-4" />
        {t("groups.discordTemplate.import")}
        <NewBadge id={DISCORD_TEMPLATE_FEATURE} />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <FaDiscord className="h-4 w-4 text-[#5865F2]" />
        {t("groups.discordTemplate.title")}
        <button
          type="button"
          onClick={() => {
            if (!help) trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.help, { feature: DISCORD_TEMPLATE_FEATURE });
            setHelp(!help);
          }}
          className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-full text-xs font-bold transition ${
            help
              ? "bg-[#5865F2] text-white"
              : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          }`}
          aria-label={t("groups.discordTemplate.helpTitle")}
          aria-expanded={help}
          title={t("groups.discordTemplate.helpTitle")}
        >
          ?
        </button>
      </span>
      {help && (
        <div className="rounded-xl border border-[#5865F2]/30 bg-[#5865F2]/5 p-3 text-xs text-zinc-600 dark:text-zinc-300">
          <p className="mb-1.5 font-semibold text-zinc-800 dark:text-zinc-100">{t("groups.discordTemplate.helpTitle")}</p>
          <ol className="flex list-decimal flex-col gap-1 pl-4">
            <li>{t("groups.discordTemplate.helpStep1")}</li>
            <li>{t("groups.discordTemplate.helpStep2")}</li>
            <li>{t("groups.discordTemplate.helpStep3")}</li>
            <li>{t("groups.discordTemplate.helpStep4")}</li>
          </ol>
          <p className="mt-2 text-zinc-500 dark:text-zinc-400">{t("groups.discordTemplate.helpNote")}</p>
        </div>
      )}
      <div className="flex gap-2">
        <input
          autoFocus
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => {
            // Enter here fetches the template, not submits the whole form.
            if (e.key === "Enter") {
              e.preventDefault();
              if (link.trim() && !loading) void load();
            }
          }}
          placeholder="https://discord.new/..."
          className={`${inputClass} min-w-0 flex-1`}
          disabled={disabled || loading !== null}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={disabled || loading !== null || !link.trim()}
          className={secondaryButton}
        >
          {loading === "link" ? t("groups.discordTemplate.loading") : t("groups.discordTemplate.fetch")}
        </button>
      </div>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.discordTemplate.hint")}</span>
      {error && <span className="text-xs text-red-500">{error}</span>}
      <span className="mt-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {t("groups.discordTemplate.featuredTitle")}
      </span>
      <div className="grid grid-cols-2 gap-1.5">
        {FEATURED_DISCORD_TEMPLATES.map((item) => (
          <button
            key={item.code}
            type="button"
            disabled={disabled || loading !== null}
            onClick={() => void load(item.code)}
            className="flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-zinc-200 px-2 py-1.5 text-left text-xs transition hover:border-[#5865F2]/60 hover:bg-[#5865F2]/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800"
          >
            <span className="text-base leading-none" aria-hidden>
              {item.emoji}
            </span>
            <span className="truncate font-medium text-zinc-800 dark:text-zinc-100">
              {loading === item.code
                ? t("groups.discordTemplate.loading")
                : t(`groups.discordTemplate.featured.${item.key}`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function CreateGroupDialog({ closePopup }: PopupProps<object>) {
  const { t, tc } = useI18n();
  const navigation = useGroupNavigation();
  const { openPopup } = useNtPopups();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("private");
  const [icon, setIcon] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Starting from a Discord server template (experiment "discord-template").
  const discordTemplate = useFeature(DISCORD_TEMPLATE_FEATURE, { track: true }).enabled;
  const [template, setTemplate] = useState<DiscordTemplatePreview | null>(null);

  async function onPickIcon(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedAvatarImage(file)) {
      setError(t("groups.groupDialogs.useAPngJpegWebpGif"));
      return;
    }
    try {
      const prepared = await prepareAvatarImage(file);
      setIcon(prepared.dataUrl);
      setError(null);
    } catch {
      setError(t("common.couldNotReadThatImage"));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const result = await createGroup(name.trim(), visibility, template?.code ?? null);
    if (!result.ok) {
      setBusy(false);
      setError(result.error);
      return;
    }
    const groupId = result.group.id;
    if (template) {
      markFeatureUsed(DISCORD_TEMPLATE_FEATURE);
      trackFeatureEvent(DISCORD_TEMPLATE_EVENTS.create, { group: groupId, feature: DISCORD_TEMPLATE_FEATURE });
    }
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
    <DialogFrame title={t("common.createAGroup")} onClose={() => closePopup(false)}>
      <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t("groups.groupDialogs.aPermanentPlaceWithVoiceAnd")}
      </p>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="relative shrink-0 cursor-pointer"
            aria-label={t("groups.groupDialogs.chooseIcon")}
          >
            {icon ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={icon} alt={t("groups.groupDialogs.icon")} className="h-20 w-20 rounded-2xl object-cover" />
            ) : (
              <span className="flex h-20 w-20 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
                <MdAddPhotoAlternate className="h-6 w-6" />
                {t("groups.groupDialogs.icon")}
              </span>
            )}
          </button>
          <input ref={fileRef} type="file" accept={AVATAR_IMAGE_ACCEPT} hidden onChange={onPickIcon} />
          <label className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.groupName")}</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              placeholder={t("groups.groupDialogs.exGamingCrew")}
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.whoCanJoin")}</span>
          <VisibilityPicker value={visibility} onChange={setVisibility} disabled={busy} />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.youCanChangeItLaterIn")}</span>
        </div>
        {discordTemplate && (
          <DiscordTemplatePicker
            template={template}
            disabled={busy}
            onChange={(next) => {
              setTemplate(next);
              // The server's name, when nobody has typed one yet.
              if (next && !name.trim()) setName(next.name.slice(0, 50));
            }}
          />
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
        {!template && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {t("groups.groupDialogs.theGroupStartsWithAText")} <b>#geral</b> e uma sala de voz <b>{t("common.general")}</b>.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => closePopup(false)} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!name.trim() || busy} className={primaryButton}>
            {busy ? t("common.creating") : t("groups.groupDialogs.createGroup")}
          </button>
        </div>
      </form>
    </DialogFrame>
  );
}

// ─── Add (create or join) ───────────────────────────────────────────────

/**
 * The dock's "+": one question — make a group, or get into one — before either
 * form. Each answer closes this and opens its own popup (create_group or
 * join_group), so both stay the one form they already are everywhere else.
 */
export function AddGroupDialog({ closePopup }: PopupProps<object>) {
  const t = useT();
  const { account } = useAuth();
  const { openPopup } = useNtPopups();
  const navigation = useGroupNavigation();
  const canCreate = Boolean(account);
  // Explorar has a page of its own in the experiment groups-hub.
  const hub = useGroupsHub({ track: false });

  function choose(popup: "create_group" | "join_group") {
    closePopup(true);
    // After this one has gone, so the two are never on screen together.
    setTimeout(() => void openPopup(popup, { data: {} }), 0);
  }

  // To /groups, on its public groups: the search cleared and the list
  // scrolled to, whether the page is being opened or already on screen.
  function explore() {
    closePopup(true);
    requestExploreGroups();
    navigation.push(hub ? GROUPS_EXPLORE_PATH : "/groups");
  }

  const choice =
    "group flex w-full cursor-pointer items-center gap-3 rounded-xl border border-zinc-200 p-3 text-left transition hover:border-zinc-400 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-200 disabled:hover:bg-transparent dark:border-zinc-800 dark:hover:border-zinc-600 dark:hover:bg-zinc-900 dark:disabled:hover:border-zinc-800";

  return (
    <DialogFrame title={t("groups.homeGroupsPanel.addGroup")} onClose={() => closePopup(false)}>
      <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.addGroupQuestion")}</p>
      <div className="flex flex-col gap-2">
        {/* Every public group, on /groups (see PublicGroupsDirectory) — the
            way in for somebody with no invite and nothing to make yet. */}
        <button type="button" autoFocus onClick={explore} className={choice}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-2xl text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
            <MdExplore />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("groups.groupDialogs.exploreGroups")}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.exploreGroupsHint")}</span>
          </span>
          <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5" />
        </button>
        <button type="button" onClick={() => choose("join_group")} className={choice}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-100 text-2xl text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            <MdLink />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("common.joinAGroup")}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">{t("groups.homeGroupsPanel.withTheInviteLink")}</span>
          </span>
          <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5" />
        </button>
        <button type="button" disabled={!canCreate} onClick={() => choose("create_group")} className={choice}>
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-2xl text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <MdAdd />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{t("common.createAGroup")}</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              {canCreate ? t("groups.homeGroupsPanel.withVoiceAndTextRooms") : t("common.createAnAccountToCreateGroups")}
            </span>
          </span>
          <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400 transition group-hover:translate-x-0.5" />
        </button>
      </div>
    </DialogFrame>
  );
}

// ─── Join ────────────────────────────────────────────────────────────────

export function JoinGroupDialog({ closePopup }: PopupProps<object>) {
  const { t, tc } = useI18n();
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    const code = inviteCodeFromInput(value);
    if (!code) {
      setError(t("groups.groupDialogs.thatDoesNotLookLikeAn"));
      return;
    }
    closePopup(true);
    router.push(invitePath(code));
  }

  return (
    <DialogFrame title={t("common.joinAGroup")} onClose={() => closePopup(false)}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.inviteLinkOrCode")}</span>
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
            {t("common.cancel")}
          </button>
          <button type="submit" disabled={!value.trim()} className={primaryButton}>
            {t("common.continue")}
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
  { value: "never", get label() { return translate("groups.groupDialogs.never"); } },
];
const MAX_USES = [0, 1, 5, 10, 25, 50, 100];

export function GroupInviteDialog({ closePopup, data }: PopupProps<{ groupId: string; groupName?: string }>) {
  const { t, tc } = useI18n();
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
  // The group's own link, when it has one that works — offered first: it is
  // the one that never runs out.
  const customUrl =
    inviteDetail?.group.customInvite && inviteDetail.group.customInviteAllowed
      ? inviteUrl(inviteDetail.group.customInvite)
      : null;

  return (
    <DialogFrame
      title={
        groupName ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span className="shrink-0">{t("groups.groupDialogs.inviteTo")}</span>
            <GroupName name={groupName} flags={inviteDetail?.group.flags} badgeClassName="h-5 w-5" />
          </span>
        ) : (
          t("common.invitePeople")
        )
      }
      onClose={() => closePopup(false)}
    >
      {customUrl && (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.groupLink")}</span>
          <div className="flex gap-2">
            <input readOnly value={customUrl} className={`${inputClass} font-mono text-xs`} />
            <CopyLinkButton url={customUrl} />
          </div>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.customNeverExpiresUnlimitedUses")}</p>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {customUrl ? t("groups.groupDialogs.orATemporaryLink") : t("groups.groupDialogs.inviteLink")}
        </span>
        <div className="flex gap-2">
          <input readOnly value={busy && !invite ? t("common.generating") : url} className={`${inputClass} font-mono text-xs`} />
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
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
        {invite && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {describeInviteExpiry(invite.expiresAt)}
            {invite.maxUses ? t("groups.groupDialogs.upToMaxusesValue", { maxUses: invite.maxUses, value: tc("common.useNoun", invite.maxUses) }) : t("groups.groupDialogs.unlimitedUses")}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("groups.groupDialogs.expiresAfter")}</span>
          <select value={lifetime} onChange={(e) => setLifetime(e.target.value as InviteLifetime)} className={inputClass}>
            {LIFETIMES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("groups.groupDialogs.maximumNumberOfUses")}</span>
          <select value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} className={inputClass}>
            {MAX_USES.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t("common.noLimit") : n === 1 ? "1 uso" : `${n} usos`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <div className="flex justify-end">
        <button type="button" onClick={() => void generate()} disabled={busy} className={secondaryButton}>
          {t("groups.groupDialogs.generateANewLink")}
        </button>
      </div>
    </DialogFrame>
  );
}

/** The group's custom emoji — how many fit comes from its aura level (see lib/groupAura). */
function GroupEmojisTab({ groupId, level }: { groupId: string; level: number }) {
  const { t } = useI18n();
  let slots = BASE_GROUP_EMOJI_SLOTS;
  for (const row of DEFAULT_AURA_LEVELS) if (row.level <= level) slots = Math.max(slots, row.emojiSlots);
  return (
    <EmojiManager
      owner={{ group: groupId }}
      limitHint={
        level > 0 ? t("customEmoji.groupLimitHintLevel", { level, slots }) : t("customEmoji.groupLimitHint", { slots })
      }
    />
  );
}

// ─── Settings ────────────────────────────────────────────────────────────

type SettingsTab = "overview" | "channels" | "roles" | "map" | "invites" | "members" | "aura" | "emojis" | "bots" | "bans" | "danger";

export function GroupSettingsDialog({ closePopup, data }: PopupProps<{ groupId: string; tab?: string }>) {
  const groupId = data?.groupId ?? "";
  const { tc } = useI18n();
  const { detail } = useGroupDetail(groupId);
  const can = (key: Parameters<typeof canManage>[1]) => (detail ? canManage(detail, key) : false);
  const isOwner = detail?.me.role === "owner";
  // The exposure is counted where the way in is (the group menu's "Aura").
  const aura = useFeature(GROUP_AURA_FEATURE, { group: groupId, track: false });
  const customEmojis = useFeature(CUSTOM_EMOJI_FEATURE, { group: groupId, track: false });
  // A tab row on a desktop; on a phone, the list of sections a phone's own
  // settings are, each opening full screen with a way back to the list.
  // Eleven tabs in a row that scrolls sideways hid most of them off the edge.
  const wideScreen = useMediaQuery(SM_BREAKPOINT_QUERY);

  // Each tab for whoever has the switch it takes (see lib/groupPermissions).
  // `block` groups the phone's list into cards: the group itself, its people,
  // its rooms and bots, and the owner's danger zone apart from everything.
  const tabs: { id: SettingsTab; label: string; show: boolean; badge?: ReactNode; icon: IconType; block: number }[] = [
    { id: "overview", label: translate("common.overview"), show: can("manageGroup"), icon: MdInfoOutline, block: 0 },
    { id: "channels", label: translate("common.rooms"), show: can("manageChannels"), icon: MdTag, block: 2 },
    { id: "roles", label: translate("groups.groupDialogs.roles"), show: can("manageRoles"), icon: MdShield, block: 1 },
    { id: "map", label: translate("groups.groupDialogs.map"), show: can("manageGroup"), icon: MdOutlineMap, block: 0 },
    { id: "invites", label: translate("groups.groupDialogs.invites"), show: can("manageGroup") || can("createInvites"), icon: MdLink, block: 1 },
    { id: "members", label: translate("common.members"), show: true, icon: MdPeopleOutline, block: 1 },
    // For everybody in the experiment: anybody with a plan may lift the group.
    { id: "aura", label: translate("groups.aura.title"), show: aura.enabled, badge: <NewBadge id={GROUP_AURA_BADGE} />, icon: MdAutoAwesome, block: 0 },
    // For everybody in the experiment to see; adding one is "Gerenciar grupo".
    { id: "emojis", label: translate("customEmoji.emojisTab"), show: customEmojis.enabled, badge: <NewBadge id={CUSTOM_EMOJI_BADGE} />, icon: MdEmojiEmotions, block: 0 },
    // For everybody, like the name menu's "Explorar bots": finding one is not
    // running the group; adding one is, and the list offers that only to whoever may.
    { id: "bots", label: translate("botDirectory.title"), show: true, icon: MdSmartToy, block: 2 },
    { id: "bans", label: translate("groups.groupDialogs.banned"), show: can("banMembers"), icon: MdBlock, block: 1 },
    { id: "danger", label: translate("groups.groupDialogs.dangerZone"), show: isOwner, icon: MdWarningAmber, block: 3 },
  ];
  const visible = tabs.filter((t) => t.show);
  // "permissions" is what the tab was called before roles — asked for by
  // older links, and it lives in "Cargos" now (@everyone).
  const asked = data?.tab === "permissions" ? "roles" : data?.tab;
  const [tab, setTab] = useState<SettingsTab | null>(null);
  // On a phone: whether the list is on screen rather than a section. Opened
  // for a particular tab (a link to "Cargos"), that section comes up first.
  const [phoneList, setPhoneList] = useState(!asked);
  // Whatever was picked, else what the opener asked for, else the first tab
  // this person has — asked again on every render, since the group (and so
  // which tabs there are) may only arrive after this opens.
  const pick = (id: string | null | undefined) => visible.find((t) => t.id === id)?.id ?? null;
  const current = pick(tab) ?? pick(asked) ?? visible[0]?.id ?? "members";
  const showList = !wideScreen && (phoneList || !pick(tab ?? asked));
  const open = (id: SettingsTab) => {
    setTab(id);
    setPhoneList(false);
  };
  // Android's back (and the app's) leaves a section for the list before it
  // closes anything — see lib/useBackHandler.
  useBackHandler(!wideScreen && !showList, () => setPhoneList(true));

  if (!detail) {
    return (
      <DialogFrame title={translate("common.group")} onClose={() => closePopup(false)} wide>
        <p className="text-sm text-zinc-500">{translate("common.loading")}</p>
      </DialogFrame>
    );
  }

  const groupTitle = (
    <GroupName
      name={detail.group.name}
      flags={detail.group.flags}
      visibility={detail.group.visibility}
      groupId={groupId}
      auraLevel={detail.group.aura?.level}
      badgeClassName="h-5 w-5"
    />
  );

  if (showList) {
    const blocks = [0, 1, 2, 3]
      .map((block) => visible.filter((t) => t.block === block))
      .filter((rows) => rows.length > 0);
    return (
      <DialogFrame title={translate("groups.groupSidebar.settings")} onClose={() => closePopup(false)} wide>
        <div className="flex items-center gap-3 px-1">
          <GroupIcon name={detail.group.name} iconUrl={detail.group.iconUrl} seed={groupId} size={56} className="rounded-2xl" />
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold">{groupTitle}</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {tc("mobile.memberCount", detail.group.memberCount)}
            </p>
          </div>
        </div>
        <nav aria-label={translate("groups.groupSidebar.settings")} className="flex flex-col gap-4">
          {blocks.map((rows, i) => (
            <ul
              key={i}
              className="divide-y divide-zinc-200 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/40"
            >
              {rows.map((row) => {
                const Icon = row.icon;
                const danger = row.id === "danger";
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => open(row.id)}
                      className={`flex min-h-[52px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left text-[15px] font-medium transition focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-800 ${
                        danger ? "text-red-600 dark:text-red-400" : "text-zinc-900 dark:text-zinc-100"
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${danger ? "" : "text-zinc-500 dark:text-zinc-400"}`} aria-hidden />
                      <span className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span className="truncate">{row.label}</span>
                        {row.badge}
                      </span>
                      <MdChevronRight className="h-5 w-5 shrink-0 text-zinc-400" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          ))}
        </nav>
      </DialogFrame>
    );
  }

  return (
    <DialogFrame
      title={wideScreen ? groupTitle : visible.find((t) => t.id === current)?.label ?? groupTitle}
      onClose={() => closePopup(false)}
      onBack={wideScreen ? undefined : () => setPhoneList(true)}
      wide
      tabs={
        wideScreen && (
          <DialogTabs
            tabs={visible.map((t) => ({ id: t.id, label: t.label, danger: t.id === "danger", badge: t.badge }))}
            current={current}
            onChange={setTab}
          />
        )
      }
    >
      {current === "overview" && <OverviewTab groupId={groupId} onGoToMap={() => open("map")} />}
      {current === "channels" && (
        <ChannelsTab groupId={groupId} channels={detail.channels} categories={detail.categories ?? []} />
      )}
      {current === "roles" && <RolesTab groupId={groupId} />}
      {current === "map" && <LocationTab groupId={groupId} onGoToOverview={() => open("overview")} />}
      {current === "invites" && (
        <InvitesTab
          groupId={groupId}
          groupName={detail.group.name}
          // Only where there is an Aura tab to go to (inside the experiment).
          onGoToAura={aura.enabled ? () => open("aura") : undefined}
        />
      )}
      {current === "members" && <MembersTab groupId={groupId} />}
      {current === "aura" && <AuraTab groupId={groupId} />}
      {current === "emojis" && <GroupEmojisTab groupId={groupId} level={detail.group.aura?.level ?? 0} />}
      {current === "bots" && (
        // The same directory as the name menu's dialog (see BotExplorerDialog),
        // in a box of its own height: it scrolls inside itself, under its search.
        // On a phone, the screen under the bar.
        <div className="flex h-[min(40rem,calc(100dvh-14rem))] min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 max-sm:h-[calc(100dvh-7.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] dark:border-zinc-800">
          <BotBrowser
            variant="dialog"
            group={{
              id: groupId,
              name: detail.group.name,
              canAdd: can("manageGroup"),
              canKick: can("kickMembers"),
            }}
            onNavigate={() => closePopup(false)}
          />
        </div>
      )}
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
  const { t, tc } = useI18n();
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
      text: next === "public" ? t("groups.groupDialogs.theGroupIsPublicNow") : t("groups.groupDialogs.theGroupIsPrivateNowOnly"),
    });
    void refreshGroup(groupId);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.whoCanJoin")}</span>
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
      {!isOwner && <span className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.onlyTheGroupSOwnerCan")}</span>}
      {confirmPrivate && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="min-w-0 flex-1">{t("groups.groupDialogs.privateGroupsDoNotStayOn")}</span>
          <button type="button" onClick={() => setConfirmPrivate(false)} className={secondaryButton}>
            {t("common.cancel")}
          </button>
          <button type="button" disabled={busy} onClick={() => void change("private")} className={primaryButton}>
            {t("groups.groupDialogs.makeItPrivate")}
          </button>
        </div>
      )}
      {message && (
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>
          {justOpened && !detail.group.location && (
            <button type="button" onClick={onGoToMap} className={`${secondaryButton} inline-flex items-center gap-1.5`}>
              <MdOutlineMap className="h-4 w-4" />
              {t("groups.groupDialogs.putOnTheMap")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function OverviewTab({ groupId, onGoToMap }: { groupId: string; onGoToMap: () => void }) {
  const { t, tc } = useI18n();
  const { detail } = useGroupDetail(groupId);
  const { openPopup } = useNtPopups();
  const { account } = useAuth();
  const hasThemePlan = hasFeature("room_theme_set", account?.features ?? []);
  const richPresenceFeature = useFeature(DISCORD_RPC_FEATURE, { track: false }).enabled;
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
    setMessage(result.ok ? { ok: true, text: t("common.saved2") } : { ok: false, text: result.error });
    if (result.ok) void refreshGroup(groupId);
  }

  async function onPickIcon(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!isSupportedAvatarImage(file)) {
      setMessage({ ok: false, text: t("groups.groupDialogs.useAPngJpegWebpGif") });
      return;
    }
    setBusy(true);
    try {
      const prepared = await prepareAvatarImage(file);
      const result = await uploadGroupIcon(groupId, prepared.dataUrl);
      setMessage(result.ok ? { ok: true, text: t("groups.groupDialogs.iconUpdated") } : { ok: false, text: result.error });
      if (result.ok) void refreshGroup(groupId);
    } catch {
      setMessage({ ok: false, text: t("common.couldNotReadThatImage") });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <GroupIcon name={detail.group.name} iconUrl={detail.group.iconUrl} seed={groupId} size={80} className="rounded-2xl" />
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={secondaryButton}>
            {t("groups.groupDialogs.changeIcon")}
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
              {t("common.remove")}
            </button>
          )}
          <input ref={fileRef} type="file" accept={AVATAR_IMAGE_ACCEPT} hidden onChange={onPickIcon} />
        </div>
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.name")}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} className={inputClass} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.description")}</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={200}
          rows={3}
          placeholder={t("groups.groupDialogs.whatIsThisGroupAbout")}
          className={`${inputClass} resize-none`}
        />
      </label>
      <VisibilitySection groupId={groupId} onGoToMap={onGoToMap} />
      {richPresenceFeature && (
        <label className={`flex items-start gap-3 ${detail.group.visibility === "public" ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}>
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 shrink-0"
            checked={detail.group.visibility === "public" && detail.group.richPresenceLink !== false}
            disabled={busy || detail.group.visibility !== "public"}
            onChange={async (e) => {
              setBusy(true);
              const result = await updateGroup(groupId, { richPresenceLink: e.target.checked });
              setBusy(false);
              if (result.ok) void refreshGroup(groupId);
              else setMessage({ ok: false, text: result.error });
            }}
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.richPresenceLink")}</span>
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{detail.group.visibility === "public" ? t("groups.groupDialogs.richPresenceLinkHelp") : t("groups.groupDialogs.richPresenceLinkPrivate")}</span>
          </span>
        </label>
      )}
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.groupTheme")}</span>
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-zinc-500 dark:text-zinc-400">
            {detail.group.theme
              ? t("groups.groupDialogs.theGroupHasAThemeEveryone")
              : t("groups.groupDialogs.noThemeEachPersonSeesThe")}
          </p>
          <button
            type="button"
            onClick={() => {
              if (!hasThemePlan) {
                openProModal("group_theme", "premium_max");
                return;
              }
              void openPopup("room_theme", { data: { currentThemeId: detail.group.theme, groupId } });
            }}
            className={secondaryButton}
          >
            {hasThemePlan ? t("groups.groupDialogs.chooseTheme") : t("common.proMax")}
          </button>
        </div>
      </div>
      <div className="flex items-center justify-end gap-3">
        {message && <span className={`text-sm ${message.ok ? "text-emerald-600" : "text-red-500"}`}>{message.text}</span>}
        <button type="submit" disabled={!dirty || !name.trim() || busy} className={primaryButton}>
          {t("common.save")}
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
  const { t, tc } = useI18n();
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
    setMessage({ ok: true, text: location ? t("groups.groupDialogs.locationSaved") : t("groups.groupDialogs.theGroupHasBeenTakenOff") });
    void refreshGroup(groupId);
    // The prompt nobody asked for is a one-shot errand: done, out of the way.
    if (celebrating && location) onDone?.();
  }

  if (detail && detail.group.visibility !== "public") {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="flex items-center gap-2 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          <MdLockOutline className="h-4 w-4 shrink-0" />
          {t("groups.groupDialogs.thisGroupIsPrivate")}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t("groups.groupDialogs.privateGroupsDoNotAppearOn")}
        </p>
        {detail.me.role === "owner" && onGoToOverview && (
          <button type="button" onClick={onGoToOverview} className={secondaryButton}>
            {t("groups.groupDialogs.changeTheVisibility")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {celebrating ? t("groups.groupDialogs.yourGroupIsPublicAnyoneCan") : t("groups.groupDialogs.putTheGroupOnThe")}
        <Link href="/worldmap" target="_blank" className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400">
          mapa de salas e grupos
        </Link>
        {celebrating
          ? t("groups.groupDialogs.whereItIsFromNeighbourhoodCity")
          : t("groups.groupDialogs.soPeopleNearbyCanFindIt")}
      </p>
      <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-[11px] leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <span className="font-medium text-zinc-700 dark:text-zinc-300">{t("groups.groupDialogs.privacyNothingHereIsDetected")}</span>{" "}
        {t("groups.groupDialogs.thePlaceIsOnlyWhatYou")}
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
            {t("common.pinAt")}{" "}
            <span className="font-mono text-zinc-700 dark:text-zinc-300">
              {pick.lat.toFixed(4)}, {pick.lng.toFixed(4)}
            </span>
            {!moved && " (local salvo)"}
          </>
        ) : (
          t("groups.groupDialogs.theGroupIsNotOnThe")
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!pick || !moved || busy}
          onClick={() => void save(pick)}
          className="flex-1 cursor-pointer rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saved ? t("common.saveNewLocation") : t("common.saveLocation")}
        </button>
        {/* Only in the prompt nobody asked for; everywhere else the × is the way out. */}
        {celebrating && (
          <button type="button" onClick={onDone} className={secondaryButton}>
            {t("common.notNow")}
          </button>
        )}
        {saved && !celebrating && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(null)}
            className="cursor-pointer rounded-lg border border-red-300 px-3 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          >
            {t("common.removeFromTheMap")}
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
  const { t, tc } = useI18n();
  const groupId = data?.groupId ?? "";
  const celebrating = Boolean(data?.justCreated);
  const { detail } = useGroupDetail(groupId || null);
  return (
    <DialogFrame
      title={
        <span className="inline-flex items-center gap-2">
          <MdOutlineMap className="h-5 w-5 shrink-0 text-blue-500" />
          {celebrating ? t("groups.groupDialogs.youCreatedAPublicGroup") : t("groups.groupDialogs.theGroupSPlaceOnThe")}
        </span>
      }
      onClose={() => closePopup(false)}
      wide
    >
      {detail ? (
        <LocationTab groupId={groupId} celebrating={celebrating} onDone={() => closePopup(true)} />
      ) : (
        <p className="text-sm text-zinc-500">{t("common.loading")}</p>
      )}
    </DialogFrame>
  );
}

/**
 * The group's rooms, arranged by hand — the same list the sidebar shows (the
 * rooms without a category, then each category), with arrows and a category
 * picker instead of dragging. What a phone uses, where the sidebar's drag and
 * drop is not; both rearrange through lib/groupLayout and the same route.
 *
 * Rooms and categories are made here too. On a desktop each row carries its
 * buttons; on a phone those were six 24px targets crammed beside a name, so
 * the row has one "⋮" instead and its actions open under it, full size.
 * (Not a bottom sheet: a sheet portalled out of this popup counts as a click
 * outside it for ntpopups, which closes the popup.)
 */
function ChannelsTab({
  groupId,
  channels,
  categories,
}: {
  groupId: string;
  channels: GroupChannel[];
  categories: GroupCategory[];
}) {
  const { t } = useI18n();
  const wideScreen = useMediaQuery(SM_BREAKPOINT_QUERY);
  const openChannelSettings = useOpenChannelSettings();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // On a phone: the row (a room's id, or `category:<id>`) whose actions are open.
  const [expanded, setExpanded] = useState<string | null>(null);
  // What the form at the top is making, and in which category.
  const [creating, setCreating] = useState<{ kind: GroupChannelKind | "category"; categoryId: string | null } | null>(null);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createRef = useRef<HTMLFormElement | null>(null);
  const sections = buildSections(channels, categories);
  const categoryList = sections.slice(1).map((s) => s.category!);

  async function run(action: Promise<{ ok: boolean; error?: string }>) {
    const result = await action;
    if (!result.ok) setError(result.error ?? t("groups.groupDialogs.somethingWentWrong"));
    else setError(null);
    void refreshGroup(groupId);
  }

  function commit(next: LayoutSection[]) {
    void run(setGroupLayout(groupId, toPayload(next)));
  }

  function startCreating(kind: GroupChannelKind | "category", categoryId: string | null = null) {
    setCreating({ kind, categoryId });
    setNewName("");
    setCreateError(null);
    setExpanded(null);
    // Started from a category's row further down: the form is at the top.
    requestAnimationFrame(() => createRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  async function submitNew(e: FormEvent) {
    e.preventDefault();
    if (!creating || !newName.trim() || busy) return;
    setBusy(true);
    const result =
      creating.kind === "category"
        ? await createCategory(groupId, newName.trim())
        : await createChannel(groupId, creating.kind, newName.trim(), creating.categoryId);
    setBusy(false);
    if (!result.ok) {
      setCreateError(result.error);
      return;
    }
    setCreating(null);
    setNewName("");
    setCreateError(null);
    void refreshGroup(groupId);
  }

  /** One step up or down among the rooms of its kind in its own section. */
  function moveWithin(section: LayoutSection, channel: GroupChannel, delta: number) {
    const list = section[channel.kind];
    const index = list.findIndex((c) => c.id === channel.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    const beforeId = delta < 0 ? list[target].id : list[target + 1]?.id ?? null;
    commit(moveChannel(sections, channel.id, section.category?.id ?? null, beforeId));
  }

  function moveCategoryBy(categoryId: string, delta: number) {
    const index = categoryList.findIndex((c) => c.id === categoryId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= categoryList.length) return;
    const beforeId = delta < 0 ? categoryList[target].id : categoryList[target + 1]?.id ?? null;
    commit(moveCategory(sections, categoryId, beforeId));
  }

  /** The name being edited in place — a room's or a category's. */
  function renameForm(onSave: () => void) {
    return (
      <form
        className="flex min-w-0 flex-1 gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          setEditing(null);
          onSave();
        }}
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setEditing(null);
            }
          }}
          maxLength={32}
          aria-label={t("common.rename")}
          enterKeyHint="done"
          className={`${inputClass} sm:py-1`}
        />
        <button
          type="submit"
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg bg-emerald-600 px-2 text-white max-sm:min-w-11"
          aria-label={t("common.save")}
        >
          <MdCheck className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
        <button
          type="button"
          onClick={() => setEditing(null)}
          className="flex shrink-0 cursor-pointer items-center justify-center rounded-lg px-2 text-zinc-500 hover:bg-zinc-100 max-sm:min-w-11 dark:hover:bg-zinc-800"
          aria-label={t("common.cancel")}
        >
          <MdClose className="h-5 w-5 sm:h-4 sm:w-4" />
        </button>
      </form>
    );
  }

  /** "Apagar?" in place of a row's buttons, with a way out. */
  function confirmDelete(onConfirm: () => void, note?: string) {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2" role="group">
        {note && <span className="min-w-0 flex-1 text-xs text-zinc-500 dark:text-zinc-400">{note}</span>}
        <button type="button" onClick={() => setConfirming(null)} className={secondaryButton}>
          {t("common.cancel")}
        </button>
        <button type="button" onClick={onConfirm} className={dangerButton}>
          {t("common.delete")}
        </button>
      </div>
    );
  }

  /** A row's "⋮" on a phone — the way to its actions, which open under it. */
  function moreButton(key: string, label: string) {
    const open = expanded === key;
    return (
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`actions-${key}`}
        aria-label={label}
        onClick={() => {
          setExpanded(open ? null : key);
          setConfirming(null);
        }}
        className={`flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-zinc-500 transition active:bg-zinc-200 dark:active:bg-zinc-800 ${
          open ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100" : ""
        }`}
      >
        <MdMoreVert className="h-5 w-5" />
      </button>
    );
  }

  const actionButton = `${secondaryButton} inline-flex items-center justify-center gap-2`;

  function channelRow(section: LayoutSection, channel: GroupChannel) {
    const list = section[channel.kind];
    const index = list.findIndex((c) => c.id === channel.id);
    const open = !wideScreen && expanded === channel.id;
    const categorySelect = categoryList.length > 0 && (
      <select
        value={section.category?.id ?? ""}
        onChange={(e) => commit(moveChannel(sections, channel.id, e.target.value || null, null))}
        aria-label={t("common.roomCategory")}
        title={t("common.category")}
        className={
          wideScreen
            ? "mr-1 max-w-28 cursor-pointer rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            : inputClass
        }
      >
        <option value="">{t("common.noCategory")}</option>
        {categoryList.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    );
    return (
      <li key={channel.id} className="rounded-lg border border-zinc-200 dark:border-zinc-800">
        <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 max-sm:min-h-12 max-sm:py-0.5 max-sm:pr-0.5">
          {channel.kind === "text" ? (
            <MdTag className="h-4 w-4 shrink-0 opacity-60" aria-label={t("common.textRoom")} />
          ) : (
            <MdVolumeUp className="h-4 w-4 shrink-0 opacity-60" aria-label={t("common.voiceRoom")} />
          )}
          {editing === channel.id ? (
            renameForm(() => void run(renameChannel(groupId, channel.id, draft)))
          ) : (
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate text-sm max-sm:text-[15px]">{channel.name}</span>
              {Object.keys(channel.permissions ?? {}).length > 0 && (
                <span className="shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  {t("groups.groupDialogs.itsOwnPermissions")}
                </span>
              )}
            </span>
          )}
          {editing === channel.id ? null : !wideScreen ? (
            moreButton(channel.id, t("groups.groupDialogs.roomActions", { name: channel.name }))
          ) : confirming === channel.id ? (
            confirmDelete(() => {
              setConfirming(null);
              void run(deleteChannel(groupId, channel.id));
            })
          ) : (
            <span className="flex shrink-0 items-center">
              {categorySelect}
              <IconButton label={t("common.moveUp")} disabled={index <= 0} onClick={() => moveWithin(section, channel, -1)}>
                <MdArrowUpward className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("common.moveDown")} disabled={index === list.length - 1} onClick={() => moveWithin(section, channel, 1)}>
                <MdArrowDownward className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={t("common.rename")}
                onClick={() => {
                  setEditing(channel.id);
                  setDraft(channel.name);
                }}
              >
                <MdEdit className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("groups.groupDialogs.roomPermissions")} onClick={() => openChannelSettings(groupId, channel.id, "permissions")}>
                <MdTune className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("common.delete")} danger onClick={() => setConfirming(channel.id)}>
                <MdDeleteOutline className="h-4 w-4" />
              </IconButton>
            </span>
          )}
        </div>
        {open && (
          <div id={`actions-${channel.id}`} className="flex flex-col gap-2 border-t border-zinc-200 p-2 dark:border-zinc-800">
            {confirming === channel.id ? (
              <>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {t("groups.contextMenu.deleteRoomTitle", { name: channel.name })}
                </p>
                {confirmDelete(() => {
                  setConfirming(null);
                  setExpanded(null);
                  void run(deleteChannel(groupId, channel.id));
                })}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" disabled={index <= 0} onClick={() => moveWithin(section, channel, -1)} className={actionButton}>
                    <MdArrowUpward className="h-5 w-5" aria-hidden />
                    {t("common.moveUp")}
                  </button>
                  <button
                    type="button"
                    disabled={index === list.length - 1}
                    onClick={() => moveWithin(section, channel, 1)}
                    className={actionButton}
                  >
                    <MdArrowDownward className="h-5 w-5" aria-hidden />
                    {t("common.moveDown")}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setExpanded(null);
                      setEditing(channel.id);
                      setDraft(channel.name);
                    }}
                    className={actionButton}
                  >
                    <MdEdit className="h-5 w-5" aria-hidden />
                    {t("common.rename")}
                  </button>
                  <button
                    type="button"
                    onClick={() => openChannelSettings(groupId, channel.id, "permissions")}
                    className={actionButton}
                  >
                    <MdTune className="h-5 w-5" aria-hidden />
                    {t("groups.channelSettingsDialog.permissions")}
                  </button>
                </div>
                {categorySelect && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{t("common.category")}</span>
                    {categorySelect}
                  </label>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming(channel.id)}
                  className={`${actionButton} border-red-300 text-red-600 dark:border-red-900 dark:text-red-400`}
                >
                  <MdDeleteOutline className="h-5 w-5" aria-hidden />
                  {t("groups.contextMenu.deleteRoom")}
                </button>
              </>
            )}
          </div>
        )}
      </li>
    );
  }

  function categoryHeading(category: GroupCategory) {
    const index = categoryList.findIndex((c) => c.id === category.id);
    const key = `category:${category.id}`;
    const open = !wideScreen && expanded === key;
    const remove = () => {
      setConfirming(null);
      setExpanded(null);
      void run(deleteCategory(groupId, category.id));
    };
    if (editing === key) {
      return <div className="flex">{renameForm(() => void run(renameCategory(groupId, category.id, draft)))}</div>;
    }
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-xs font-semibold uppercase tracking-wide text-zinc-500">{category.name}</h3>
          {!wideScreen ? (
            moreButton(key, t("groups.groupDialogs.categoryActions", { name: category.name }))
          ) : confirming === key ? (
            confirmDelete(remove, t("groups.groupDialogs.theRoomsGoToTheTop"))
          ) : (
            <span className="flex shrink-0 items-center">
              <IconButton
                label={t("groups.groupSidebar.createARoomInName", { name: category.name })}
                onClick={() => startCreating("text", category.id)}
              >
                <MdAdd className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("groups.groupDialogs.moveCategoryUp")} disabled={index <= 0} onClick={() => moveCategoryBy(category.id, -1)}>
                <MdArrowUpward className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={t("groups.groupDialogs.moveCategoryDown")}
                disabled={index === categoryList.length - 1}
                onClick={() => moveCategoryBy(category.id, 1)}
              >
                <MdArrowDownward className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={t("groups.groupDialogs.renameCategory")}
                onClick={() => {
                  setEditing(key);
                  setDraft(category.name);
                }}
              >
                <MdEdit className="h-4 w-4" />
              </IconButton>
              <IconButton
                label={category.textFirst ? t("groups.groupSidebar.voiceFirst") : t("groups.groupSidebar.textFirst")}
                onClick={() => void run(setCategoryTextFirst(groupId, category.id, !category.textFirst))}
              >
                <MdSwapVert className="h-4 w-4" />
              </IconButton>
              <IconButton label={t("common.deleteCategory")} danger onClick={() => setConfirming(key)}>
                <MdDeleteOutline className="h-4 w-4" />
              </IconButton>
            </span>
          )}
        </div>
        {open && (
          <div
            id={`actions-${key}`}
            className="flex flex-col gap-2 rounded-lg border border-zinc-200 p-2 dark:border-zinc-800"
          >
            {confirming === key ? (
              <>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">{t("groups.groupDialogs.theRoomsGoToTheTop")}</p>
                {confirmDelete(remove)}
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => startCreating("voice", category.id)} className={actionButton}>
                    <MdVolumeUp className="h-5 w-5" aria-hidden />
                    {t("common.voiceRoom")}
                  </button>
                  <button type="button" onClick={() => startCreating("text", category.id)} className={actionButton}>
                    <MdChatBubbleOutline className="h-5 w-5" aria-hidden />
                    {t("common.textRoom")}
                  </button>
                  <button type="button" disabled={index <= 0} onClick={() => moveCategoryBy(category.id, -1)} className={actionButton}>
                    <MdArrowUpward className="h-5 w-5" aria-hidden />
                    {t("common.moveUp")}
                  </button>
                  <button
                    type="button"
                    disabled={index === categoryList.length - 1}
                    onClick={() => moveCategoryBy(category.id, 1)}
                    className={actionButton}
                  >
                    <MdArrowDownward className="h-5 w-5" aria-hidden />
                    {t("common.moveDown")}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(null);
                    setEditing(key);
                    setDraft(category.name);
                  }}
                  className={actionButton}
                >
                  <MdEdit className="h-5 w-5" aria-hidden />
                  {t("groups.groupDialogs.renameCategory")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(null);
                    void run(setCategoryTextFirst(groupId, category.id, !category.textFirst));
                  }}
                  className={actionButton}
                >
                  <MdSwapVert className="h-5 w-5" aria-hidden />
                  {category.textFirst ? t("groups.groupSidebar.voiceFirst") : t("groups.groupSidebar.textFirst")}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(key)}
                  className={`${actionButton} border-red-300 text-red-600 dark:border-red-900 dark:text-red-400`}
                >
                  <MdDeleteOutline className="h-5 w-5" aria-hidden />
                  {t("common.deleteCategory")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const createLabel =
    creating?.kind === "category"
      ? t("groups.groupSidebar.newCategory")
      : creating?.kind === "voice"
        ? t("groups.groupSidebar.newVoiceRoom")
        : t("groups.groupSidebar.newTextRoom");

  return (
    <div className="flex flex-col gap-4">
      {/* Making a room or a category — here as well as in the list of rooms,
          whose "+" a phone never had for a room outside a category. */}
      {creating ? (
        <form
          ref={createRef}
          onSubmit={submitNew}
          className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{createLabel}</span>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setCreating(null);
                }
              }}
              maxLength={32}
              enterKeyHint="done"
              placeholder={
                creating.kind === "category"
                  ? t("groups.groupSidebar.exGames")
                  : creating.kind === "voice"
                    ? t("groups.groupSidebar.exGameNight")
                    : t("groups.groupSidebar.exMemes")
              }
              className={inputClass}
            />
          </label>
          {creating.kind !== "category" && categoryList.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{t("common.category")}</span>
              <select
                value={creating.categoryId ?? ""}
                onChange={(e) => setCreating({ ...creating, categoryId: e.target.value || null })}
                className={inputClass}
              >
                <option value="">{t("common.noCategory")}</option>
                {categoryList.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {createError && (
            <p role="alert" className="text-sm text-red-500">
              {createError}
            </p>
          )}
          <div className="flex justify-end gap-2 max-sm:grid max-sm:grid-cols-2">
            <button type="button" onClick={() => setCreating(null)} className={secondaryButton}>
              {t("common.cancel")}
            </button>
            <button type="submit" disabled={!newName.trim() || busy} className={primaryButton}>
              {t("groups.groupSidebar.create")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 max-sm:grid max-sm:grid-cols-2">
          <button type="button" onClick={() => startCreating("voice")} className={actionButton}>
            <MdVolumeUp className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
            {t("common.voiceRoom")}
          </button>
          <button type="button" onClick={() => startCreating("text")} className={actionButton}>
            <MdChatBubbleOutline className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
            {t("common.textRoom")}
          </button>
          <button type="button" onClick={() => startCreating("category")} className={`${actionButton} max-sm:col-span-2`}>
            <MdCreateNewFolder className="h-5 w-5 sm:h-4 sm:w-4" aria-hidden />
            {t("groups.groupSidebar.newCategory")}
          </button>
        </div>
      )}
      {sections.map((section) => {
        const rooms = roomsInOrder(section);
        if (!section.category && rooms.length === 0) return null;
        return (
          <section key={section.category?.id ?? "root"} className="flex flex-col gap-1">
            {section.category ? (
              categoryHeading(section.category)
            ) : categoryList.length > 0 ? (
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t("common.noCategory")}</h3>
            ) : null}
            {rooms.length > 0 && <ul className="flex flex-col gap-1">{rooms.map((channel) => channelRow(section, channel))}</ul>}
            {rooms.length === 0 && <p className="px-1 text-xs text-zinc-400">{t("groups.groupDialogs.noRoomInThisCategory")}</p>}
          </section>
        );
      })}
      {channels.length === 0 && categoryList.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("groups.groupSidebar.noRoom")}</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-500">
          {error}
        </p>
      )}
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t("groups.groupDialogs.channelsHint")}</p>
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
      className={`cursor-pointer rounded-md p-1 transition focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:cursor-not-allowed disabled:opacity-30 pointer-coarse:p-2 ${
        danger ? "text-red-500 hover:bg-red-500/10" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

function InvitesTab({
  groupId,
  groupName,
  onGoToAura,
}: {
  groupId: string;
  groupName: string;
  onGoToAura?: () => void;
}) {
  const { t, tc } = useI18n();
  const { openPopup } = useNtPopups();
  const { detail } = useGroupDetail(groupId);
  // Whoever manages the group sees every invite and the group's own link;
  // whoever only creates invites, their own.
  const managesGroup = detail ? canManage(detail, "manageGroup") : false;
  const createsInvites = detail ? canManage(detail, "createInvites") : false;
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
      {managesGroup && <CustomInviteSection groupId={groupId} onGoToAura={onGoToAura} />}
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          {managesGroup ? t("groups.groupDialogs.activeLinksThatLetSomeoneJoin") : t("groups.groupDialogs.theInviteLinksYouCreated")}
        </p>
        {createsInvites && (
          <button
            type="button"
            onClick={() => void openPopup("group_invite", { data: { groupId, groupName }, onClose: () => setSeq((s) => s + 1) })}
            className={primaryButton}
          >
            {t("groups.groupDialogs.newInvite")}
          </button>
        )}
      </div>
      {invites === null && <p className="text-sm text-zinc-500">{t("common.loading")}</p>}
      {invites?.length === 0 && <p className="text-sm text-zinc-500">{t("groups.groupDialogs.noActiveInvite")}</p>}
      <ul className="flex flex-col gap-1.5">
        {invites?.map((invite) => (
          <li
            key={invite.code}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
          >
            <span className="font-mono text-xs">{invite.code}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {invite.uses}
              {invite.maxUses ? `/${invite.maxUses}` : ""} {tc("common.useNoun", invite.uses)} ·{" "}
              {describeInviteExpiry(invite.expiresAt)} {t("groups.groupDialogs.by")} {invite.createdByName ?? t("common.someone2")}
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
                {copied === invite.code ? t("common.copied2") : t("common.copyLink")}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const result = await revokeInvite(groupId, invite.code);
                  if (result.ok) setInvites((list) => list?.filter((i) => i.code !== invite.code) ?? null);
                }}
                className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10"
              >
                {t("groups.groupDialogs.revoke")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MembersTab({ groupId }: { groupId: string }) {
  const { t, tc } = useI18n();
  const [members, setMembers] = useState<GroupMember[] | null>(null);
  const [confirm, setConfirm] = useState<{ userId: string; action: "kick" | "ban" | "transfer" } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seq, setSeq] = useState(0);
  const { detail } = useGroupDetail(groupId);
  const revalidate = detail ? membersRevalidateKey(detail) : "";
  const auraOf = useAuraOf(detail);

  useEffect(() => {
    let cancelled = false;
    void fetchMembers(groupId).then((result) => {
      if (!cancelled) setMembers(result.ok ? result.members : []);
    });
    return () => {
      cancelled = true;
    };
    // Re-read when the group itself changed (someone joined, a role moved).
  }, [groupId, seq, revalidate]);

  async function run(action: Promise<{ ok: boolean; error?: string }>) {
    const result = await action;
    setConfirm(null);
    setAdding(null);
    if (!result.ok) setError(result.error ?? t("groups.groupDialogs.somethingWentWrong"));
    else setError(null);
    setSeq((s) => s + 1);
    void refreshGroup(groupId);
  }

  if (!detail) return null;
  const selfId = detail.me.id;
  const isOwner = detail.me.role === "owner";
  const rank = myRank(detail);
  const canRoles = canManage(detail, "manageRoles");
  const canKick = canManage(detail, "kickMembers");
  const canBan = canManage(detail, "banMembers");
  // The roles the person looking may hand out or take away: below their own.
  const assignable = rolesInOrder(detail).filter((r) => canRoles && r.position < rank && isHandAssignable(r));

  return (
    <div className="flex flex-col gap-2">
      {error && <p className="text-sm text-red-500">{error}</p>}
      {members === null && <p className="text-sm text-zinc-500">{t("common.loading")}</p>}
      <ul className="flex flex-col gap-1">
        {members?.map((member) => {
          const self = member.id === selfId;
          const roleIds = member.roleIds ?? detail.memberRoles?.[member.id] ?? [];
          const roles = rolesWithIds(detail, roleIds);
          // Nobody acts on the owner, nor on anybody at or above their own highest role.
          const above = member.role !== "owner" && rank > rankOf(detail, { id: member.id, roleIds });
          const pendingConfirm = confirm?.userId === member.id ? confirm.action : null;
          const missing = assignable.filter((r) => !roleIds.includes(r.id));
          const setRoles = (next: string[]) => void run(setMemberRoles(groupId, member.id, next));
          return (
            <li key={member.id} className="flex flex-col gap-1.5 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
                    flags={member.flags}
                    bot={member.bot}
                    color={roleColorOf(detail, { id: member.id, roleIds }) ?? member.nameColor}
                    aura={auraOf(member.id)}
                    className="truncate text-sm font-medium"
                  />
                  {member.role === "owner" && (
                    <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <FaCrown className="h-3 w-3" />
                      {t("common.owner")}
                    </span>
                  )}
                </span>
                {pendingConfirm ? (
                  <span className="flex items-center gap-1">
                    <span className="text-xs text-zinc-500">
                      {pendingConfirm === "kick"
                        ? t("groups.groupDialogs.removeFromTheGroup")
                        : pendingConfirm === "ban"
                          ? t("groups.groupDialogs.banFromTheGroup")
                          : t("groups.groupDialogs.handOverOwnershipOfTheGroup")}
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
                      className="cursor-pointer rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white max-sm:min-h-10 max-sm:px-3 max-sm:text-sm"
                    >
                      {t("groups.groupDialogs.confirm")}
                    </button>
                    <button type="button" onClick={() => setConfirm(null)} className="cursor-pointer px-1 text-xs text-zinc-500 max-sm:min-h-10 max-sm:px-3 max-sm:text-sm">
                      {t("common.cancel")}
                    </button>
                  </span>
                ) : (
                  <span className="flex flex-wrap items-center gap-1">
                    {isOwner && !self && !member.guest && (
                      <button
                        type="button"
                        onClick={() => setConfirm({ userId: member.id, action: "transfer" })}
                        className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-amber-600 hover:bg-amber-500/10 max-sm:min-h-10 max-sm:px-3 max-sm:text-sm"
                      >
                        {t("groups.groupDialogs.handOverOwnership")}
                      </button>
                    )}
                    {!self && above && canKick && (
                      <button
                        type="button"
                        onClick={() => setConfirm({ userId: member.id, action: "kick" })}
                        className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 max-sm:min-h-10 max-sm:px-3 max-sm:text-sm"
                      >
                        {t("common.remove")}
                      </button>
                    )}
                    {!self && above && canBan && (
                      <button
                        type="button"
                        onClick={() => setConfirm({ userId: member.id, action: "ban" })}
                        className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-500/10 max-sm:min-h-10 max-sm:px-3 max-sm:text-sm"
                      >
                        {t("common.ban")}
                      </button>
                    )}
                  </span>
                )}
              </div>
              {(roles.length > 0 || missing.length > 0) && (
                <div className="flex flex-wrap items-center gap-1 pl-11">
                  {roles.map((role) => (
                    <RoleChip
                      key={role.id}
                      name={role.name}
                      color={role.color}
                      onRemove={
                        canRoles && role.position < rank && isHandAssignable(role)
                          ? () => setRoles(roleIds.filter((id) => id !== role.id))
                          : undefined
                      }
                    />
                  ))}
                  {missing.length > 0 &&
                    (adding === member.id ? (
                      <select
                        autoFocus
                        value=""
                        onBlur={() => setAdding(null)}
                        onChange={(e) => {
                          if (e.target.value) setRoles([...roleIds, e.target.value]);
                        }}
                        className="h-6 rounded-full border border-zinc-300 bg-white px-2 text-[11px] max-sm:h-10 max-sm:px-3 max-sm:text-base dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="">{t("groups.groupDialogs.chooseARole")}</option>
                        {missing.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAdding(member.id)}
                        aria-label={t("groups.groupDialogs.giveARole")}
                        title={t("groups.groupDialogs.giveARole")}
                        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full border border-dashed border-zinc-300 text-zinc-500 hover:border-zinc-500 hover:text-zinc-800 dark:border-zinc-700 dark:hover:border-zinc-500 dark:hover:text-zinc-200"
                      >
                        <MdAdd className="h-3.5 w-3.5" />
                      </button>
                    ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function BansTab({ groupId }: { groupId: string }) {
  const { t, tc } = useI18n();
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
      {bans === null && <p className="text-sm text-zinc-500">{t("common.loading")}</p>}
      {bans?.length === 0 && <p className="text-sm text-zinc-500">{t("groups.groupDialogs.nobodyHasBeenBannedFromThis")}</p>}
      <ul className="flex flex-col gap-1">
        {bans?.map((ban) => (
          <li key={ban.userId} className="flex items-center gap-3 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <span className="min-w-0 flex-1 truncate font-medium">{ban.name}</span>
            <span className="text-xs text-zinc-500">{new Date(ban.bannedAt).toLocaleDateString(formatLocale())}</span>
            <button
              type="button"
              onClick={async () => {
                const result = await unbanMember(groupId, ban.userId);
                if (result.ok) setBans(result.bans);
              }}
              className="cursor-pointer rounded-md px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t("common.unban")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DangerTab({ groupId, groupName, onDone }: { groupId: string; groupName: string; onDone: () => void }) {
  const { t, tc } = useI18n();
  const navigation = useGroupNavigation();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-red-300 p-4 dark:border-red-900">
      <p className="font-semibold text-red-600">{t("groups.groupDialogs.deleteTheGroup")}</p>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {t("groups.groupDialogs.deletesTheGroupEveryRoomMessage")}
      </p>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-zinc-500">
          {t("common.type")} <b>{groupName}</b> para confirmar
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
          {t("groups.groupDialogs.deleteTheGroupForever")}
        </button>
      </div>
    </div>
  );
}
