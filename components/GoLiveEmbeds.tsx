"use client";

import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import useNtPopups from "ntpopups";
import { MdAutoAwesome, MdCall, MdFavorite, MdLock, MdPeople, MdRedeem, MdScreenShare, MdVideocam, MdVolumeUp } from "react-icons/md";
import { InviteEmbeds } from "@/components/groups/InviteEmbed";
import { GroupIcon } from "@/components/groups/GroupIcon";
import { GroupName } from "@/components/groups/GroupName";
import { UserAvatar } from "@/components/UserAvatar";
import { UserProfileDialog } from "@/components/UserProfileDialog";
import { planIcon } from "@/components/planIcons";
import { addToLibrary } from "@/components/CameraEffectBrowser";
import { useFeature } from "@/lib/features";
import { CAMERA_CUSTOM_FEATURE, useCustomCameraEffects } from "@/lib/cameraCustomEffects";
import { CAMERA_WORKSHOP_FEATURE, fetchWorkshopEffectInfo, workshopPreviewUrl, type WorkshopEffect } from "@/lib/cameraEffectWorkshop";
import { fetchGiftByCode, type GiftCodeInfo } from "@/lib/premiumApi";
import { fetchUserProfile, type UserProfile } from "@/lib/userProfile";
import { fetchPublicGroupPreview, groupPath, type PublicGroupPreview } from "@/lib/groupLinks";
import { useGroupNavigation } from "@/lib/groupNavigation";
import { useGroupsSlice, useMyGroups } from "@/lib/useGroups";
import { getSignalingHttpBase, isCallRoomHandle, splitPrivateRoomHandle } from "@/lib/roomsApi";
import { selectRoom } from "@/lib/signalingSelectors";
import { useSignalingSelector } from "@/lib/useSignalingSelector";
import { useSellsHere } from "@/lib/storePolicy";
import { useI18n } from "@/lib/useI18n";
import { trackFeatureEvent } from "@/lib/features";
import { EMBED_KIND_VALUE, GOLIVE_EMBEDS_FEATURE, embedKey, goLiveLinksIn, type GoLiveLink } from "@/lib/goliveEmbeds";

// GoLive's own links, pasted into a GoLive chat (a room's, a group's text
// rooms, private messages), drawn under the message as a card with the one
// thing somebody wants to do with them right there: enter the room, open the
// present, see the profile, open the group, take the effect. Experiment
// "golive-embeds" — without it, only group invites get a card, as before.
//
// Same rules as the invite's card (see InviteEmbed): nothing at all for a
// message with no such link, one read per link shared by every copy of it,
// a skeleton while it is read, and a plain line when it leads nowhere.

export const GOLIVE_EMBED_EVENTS = {
  seen: "embed_seen", // um card apareceu (uma vez por link por visita), value = tipo
  roomJoin: "embed_room_join", // entrou na sala pelo card
  giftOpen: "embed_gift_open", // abriu o presente pelo card
  profileOpen: "embed_profile_open", // abriu o perfil pelo card
  liveJoin: "embed_live_join", // entrou na sala ao vivo do perfil pelo card
  groupOpen: "embed_group_open", // abriu o grupo pelo card
  effectUse: "embed_effect_use", // pegou o efeito pelo card
} as const;

export function trackEmbed(name: string, kind: GoLiveLink["kind"]) {
  trackFeatureEvent(name, { feature: GOLIVE_EMBEDS_FEATURE, value: EMBED_KIND_VALUE[kind] });
}

const seenThisVisit = new Set<string>();

/** "embed_seen", once per link per page load — a chat re-rendering is not a new card. */
export function trackEmbedSeen(link: GoLiveLink) {
  const key = embedKey(link);
  if (seenThisVisit.has(key)) return;
  seenThisVisit.add(key);
  trackEmbed(GOLIVE_EMBED_EVENTS.seen, link.kind);
}

/** How long one read is reused — every copy of the same link in a chat asks once. */
const READ_TTL_MS = 30_000;
const reads = new Map<string, { at: number; promise: Promise<unknown> }>();

function cachedRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const held = reads.get(key);
  if (held && Date.now() - held.at < READ_TTL_MS) return held.promise as Promise<T>;
  const promise = read().catch(() => null) as Promise<T>;
  reads.set(key, { at: Date.now(), promise });
  return promise;
}

/** Reads once per key; `undefined` while reading, then whatever came back (null for nothing). */
function useRead<T>(key: string | null, read: () => Promise<T | null>): T | null | undefined {
  const [answer, setAnswer] = useState<{ key: string; value: T | null } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void cachedRead(key, read).then((value) => {
      if (alive) setAnswer({ key, value });
    });
    return () => {
      alive = false;
    };
    // `read` is rebuilt every render; the key is what names the read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return null;
  return answer?.key === key ? answer.value : undefined;
}

type RoomPreview = {
  handle: string;
  kind: "public" | "private" | "call";
  live: boolean;
  peopleCount: number;
  micCount: number;
  screenCount: number;
  cameraCount: number;
  description: string;
  people: Array<{ name: string; avatarUrl: string | null; sharing: boolean }>;
};

async function fetchRoomPreview(handle: string): Promise<RoomPreview | null> {
  const res = await fetch(`${getSignalingHttpBase()}/rooms/${encodeURIComponent(handle)}/preview`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as RoomPreview;
}

/** Every card a message's GoLive links make — group invites included — or nothing at all. */
export const GoLiveEmbeds = memo(function GoLiveEmbeds({ text }: { text: string }) {
  const links = useMemo(() => goLiveLinksIn(text), [text]);
  // Counted as an exposure only where a card of the experiment would appear.
  const feature = useFeature(GOLIVE_EMBEDS_FEATURE, { track: links.length > 0 });
  return (
    <>
      <InviteEmbeds text={text} />
      {feature.enabled && links.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {links.map((link) => (
            <GoLiveEmbed key={embedKey(link)} link={link} />
          ))}
        </div>
      )}
    </>
  );
});

/** Whether GoLive's own links get their cards here — the generic link card steps aside for them. */
export function useGoLiveEmbedsEnabled(): boolean {
  return useFeature(GOLIVE_EMBEDS_FEATURE, { track: false }).enabled;
}

function GoLiveEmbed({ link }: { link: GoLiveLink }) {
  useEffect(() => {
    trackEmbedSeen(link);
    // Keyed by the link already (see GoLiveEmbeds): one mount, one link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  switch (link.kind) {
    case "room":
      return <RoomEmbed handle={link.handle} />;
    case "gift":
      return <GiftEmbed code={link.code} />;
    case "user":
      return <UserEmbed id={link.id} />;
    case "group":
      return <GroupEmbed groupId={link.groupId} roomId={link.roomId} />;
    case "effect":
      return <EffectEmbed id={link.id} />;
  }
}

// ---------------------------------------------------------------------------
// The pieces every card is built from

const FRAME =
  "flex w-full max-w-sm items-center gap-3 rounded-xl border border-zinc-200 bg-white p-2.5 text-left text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";
const BUTTON =
  "shrink-0 cursor-pointer rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60";
const PRIMARY = `${BUTTON} bg-emerald-600 text-white hover:bg-emerald-700`;
const SECONDARY = `${BUTTON} border border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900`;

function Skeleton() {
  return (
    <div className={FRAME} aria-busy="true">
      <span className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="h-2.5 w-24 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        <span className="h-3 w-36 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      </span>
    </div>
  );
}

function Gone({ children }: { children: ReactNode }) {
  return (
    <div className={FRAME}>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{children}</span>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-lg bg-zinc-100 px-2.5 py-1 text-[11px] font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
      {children}
    </span>
  );
}

function Card({
  icon,
  label,
  title,
  detail,
  action,
}: {
  icon: ReactNode;
  label: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    // Clicks stay on the card: the message under it has its own press handlers.
    <div className={FRAME} onClick={(e) => e.stopPropagation()}>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        {detail && <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">{detail}</span>}
      </span>
      {action}
    </div>
  );
}

function IconTile({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${className}`}>{children}</span>
  );
}

function LiveDot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />;
}

// ---------------------------------------------------------------------------
// A room: /watch/<sala>, g.nemtudo.me/<sala>

function roomTitle(handle: string): string {
  return splitPrivateRoomHandle(handle)?.name ?? handle;
}

function useEnterRoom() {
  const router = useRouter();
  return (handle: string) => router.push(`/watch/${encodeURIComponent(handle)}`);
}

function RoomEmbed({ handle }: { handle: string }) {
  const { t, tc } = useI18n();
  const enter = useEnterRoom();
  const currentRoom = useSignalingSelector(selectRoom);
  const room = useRead(`room:${handle}`, () => fetchRoomPreview(handle));

  if (room === undefined) return <Skeleton />;
  if (!room) return <Gone>{t("embeds.room.gone")}</Gone>;

  const call = room.kind === "call" || isCallRoomHandle(handle);
  const here = currentRoom === handle;
  const icon = call ? (
    <MdCall className="h-5 w-5" />
  ) : room.kind === "private" ? (
    <MdLock className="h-5 w-5" />
  ) : (
    <MdVideocam className="h-5 w-5" />
  );

  const detail = room.live ? (
    <>
      {room.people.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {room.people.slice(0, 4).map((person, index) => (
            <UserAvatar
              key={index}
              src={person.avatarUrl}
              name={person.name || "?"}
              size={16}
              className="ring-2 ring-white dark:ring-zinc-950"
            />
          ))}
        </span>
      )}
      <LiveDot />
      <span className="truncate">
        {tc("common.personCount", room.peopleCount)}
        {room.screenCount > 0 && ` · ${t("embeds.room.sharing")}`}
      </span>
    </>
  ) : (
    <span className="truncate">{room.description || t("embeds.room.empty")}</span>
  );

  return (
    <Card
      icon={
        <IconTile
          className={
            room.live
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              : "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
          }
        >
          {room.screenCount > 0 ? <MdScreenShare className="h-5 w-5" /> : icon}
        </IconTile>
      }
      label={call ? t("embeds.room.callLabel") : room.kind === "private" ? t("embeds.room.privateLabel") : t("embeds.room.label")}
      title={call ? t("embeds.room.callTitle") : roomTitle(handle)}
      detail={detail}
      action={
        here ? (
          <Tag>{t("embeds.room.here")}</Tag>
        ) : (
          <button
            type="button"
            onClick={() => {
              trackEmbed(GOLIVE_EMBED_EVENTS.roomJoin, "room");
              enter(handle);
            }}
            className={PRIMARY}
          >
            {t("embeds.room.join")}
          </button>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// A present: /gift/<código>

function giftAmount(gift: GiftCodeInfo, t: ReturnType<typeof useI18n>["t"]): string {
  if (gift.hours && gift.hours > 0) return t("embeds.gift.hoursOf", { hours: gift.hours, plan: gift.planTitle });
  if (gift.days > 0) return t("embeds.gift.daysOf", { days: gift.days, plan: gift.planTitle });
  return gift.planTitle;
}

function GiftEmbed({ code }: { code: string }) {
  const { t } = useI18n();
  const { openPopup } = useNtPopups();
  const sells = useSellsHere();
  const gift = useRead(sells ? `gift:${code}` : null, () => fetchGiftByCode(code));

  // Where nothing may be sold (the iOS app), a present is not something to open.
  if (!sells) return null;
  if (gift === undefined) return <Skeleton />;
  if (!gift) return <Gone>{t("embeds.gift.gone")}</Gone>;

  const mark = planIcon(gift.planIconId);
  const taken = gift.status === "delivered";

  return (
    <Card
      icon={
        <IconTile className="bg-gradient-to-br from-amber-100 to-pink-100 text-pink-600 dark:from-amber-950 dark:to-pink-950 dark:text-pink-300">
          <MdRedeem className="h-5 w-5" />
        </IconTile>
      }
      label={t("embeds.gift.label")}
      title={
        <span className="inline-flex min-w-0 items-center gap-1">
          <span className="truncate">{giftAmount(gift, t)}</span>
          <mark.Icon className={`h-3.5 w-3.5 shrink-0 ${mark.className}`} />
        </span>
      }
      detail={
        gift.from ? (
          <>
            <UserAvatar src={gift.from.avatarUrl} name={gift.from.displayName} size={14} userId={gift.from.id} />
            <span className="truncate">{t("embeds.gift.from", { name: gift.from.displayName })}</span>
          </>
        ) : undefined
      }
      action={
        taken ? (
          <Tag>{t("embeds.gift.taken")}</Tag>
        ) : (
          <button
            type="button"
            onClick={() => {
              trackEmbed(GOLIVE_EMBED_EVENTS.giftOpen, "gift");
              void openPopup("gift_claim", { data: { code } });
            }}
            className={`${BUTTON} bg-pink-600 text-white hover:bg-pink-700`}
          >
            {t("embeds.gift.open")}
          </button>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// A profile: /user/<id ou username>

function UserEmbed({ id }: { id: string }) {
  const { t } = useI18n();
  const enter = useEnterRoom();
  const currentRoom = useSignalingSelector(selectRoom);
  const [open, setOpen] = useState(false);
  const profile = useRead<UserProfile>(`user:${id.toLowerCase()}`, () => fetchUserProfile(id));

  if (profile === undefined) return <Skeleton />;
  if (!profile) return <Gone>{t("embeds.user.gone")}</Gone>;

  const { account, live } = profile;
  const liveElsewhere = live && live.room !== currentRoom;
  const bio = account.bio?.split("\n").find((line) => line.trim()) ?? "";

  return (
    <>
      <Card
        icon={
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 cursor-pointer"
            aria-label={t("common.seeDisplaynameSProfile", { displayName: account.displayName })}
          >
            <UserAvatar src={account.avatarUrl} name={account.displayName} size={40} userId={account.id} />
          </button>
        }
        label={t("embeds.user.label")}
        title={
          <button type="button" onClick={() => setOpen(true)} className="max-w-full cursor-pointer truncate text-left hover:underline">
            {account.displayName}
            <span className="ml-1 text-xs font-normal text-zinc-500 dark:text-zinc-400">@{account.username}</span>
          </button>
        }
        detail={
          live ? (
            <>
              <LiveDot />
              <span className="truncate">{t("embeds.user.liveIn", { room: roomTitle(live.room) })}</span>
            </>
          ) : bio ? (
            <span className="truncate">{bio}</span>
          ) : undefined
        }
        action={
          liveElsewhere ? (
            <button
              type="button"
              onClick={() => {
                trackEmbed(GOLIVE_EMBED_EVENTS.liveJoin, "user");
                enter(live.room);
              }}
              className={PRIMARY}
            >
              {t("embeds.room.join")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                trackEmbed(GOLIVE_EMBED_EVENTS.profileOpen, "user");
                setOpen(true);
              }}
              className={SECONDARY}
            >
              {t("embeds.user.open")}
            </button>
          )
        }
      />
      {open && <UserProfileDialog userId={account.id} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// A group, or one of its rooms: /groups/<grupo>[/<sala>]

function GroupEmbed({ groupId, roomId }: { groupId: string; roomId: string | null }) {
  const { t, tc } = useI18n();
  const navigation = useGroupNavigation();
  const { groups } = useMyGroups();
  const mine = groups?.find((group) => group.id === groupId) ?? null;
  // The room's name, when this group's rooms have already been read — never read just for a card.
  const channel = useGroupsSlice(
    (state) => (roomId ? state.details[groupId]?.channels.find((c) => c.id === roomId) ?? null : null),
    null
  );
  // A group you are in is drawn from what the site already knows; anybody
  // else's only when it is public (null for a private one, as for a missing one).
  const outside = useRead<PublicGroupPreview>(
    groups === null || mine ? null : `group:${groupId}`,
    () => fetchPublicGroupPreview(groupId)
  );

  if (!mine && (groups === null || outside === undefined)) return <Skeleton />;
  const group = mine ?? outside?.group ?? null;
  if (!group) return <Gone>{t("embeds.group.gone")}</Gone>;

  const member = Boolean(mine) || Boolean(outside?.member);
  const onlineCount = group.onlineCount ?? 0;
  const memberCount = group.memberCount ?? 0;
  const roomLabel = channel ? channel.name : null;

  return (
    <Card
      icon={<GroupIcon name={group.name} iconUrl={group.iconUrl} seed={group.id} size={40} className="shrink-0 rounded-xl" />}
      label={roomId ? t("embeds.group.roomLabel") : t("embeds.group.label")}
      title={<GroupName name={group.name} flags={group.flags} className="min-w-0 text-sm font-semibold" badgeClassName="h-3.5 w-3.5" />}
      detail={
        roomLabel ? (
          <>
            {channel?.kind === "voice" ? <MdVolumeUp className="h-3 w-3 shrink-0" /> : <span>#</span>}
            <span className="truncate">{roomLabel}</span>
          </>
        ) : memberCount > 0 ? (
          <>
            <LiveDot />
            <span className="truncate">
              {onlineCount} online · {tc("common.memberCount", memberCount)}
            </span>
          </>
        ) : undefined
      }
      action={
        group.suspended ? (
          <Tag>{t("common.suspended")}</Tag>
        ) : (
          <button
            type="button"
            onClick={() => {
              trackEmbed(GOLIVE_EMBED_EVENTS.groupOpen, "group");
              // Somebody not in it yet lands on its join card, which lives at the group's own address.
              navigation.push(member ? groupPath(groupId, roomId) : groupPath(groupId));
            }}
            className={member ? SECONDARY : PRIMARY}
          >
            {member ? t("groups.homeGroupsPanel.open") : t("embeds.group.see")}
          </button>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// A camera effect from the workshop: /effect/<id>

function EffectEmbed({ id }: { id: string }) {
  const workshop = useFeature(CAMERA_WORKSHOP_FEATURE, { track: false });
  const custom = useFeature(CAMERA_CUSTOM_FEATURE, { track: false });
  // Taking an effect needs both; without them the link stays a link.
  if (!workshop.enabled || !custom.enabled) return null;
  return <EffectCard id={id} />;
}

function EffectCard({ id }: { id: string }) {
  const { t } = useI18n();
  const local = useCustomCameraEffects();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const effect = useRead<WorkshopEffect>(`effect:${id}`, () => fetchWorkshopEffectInfo(id));

  if (effect === undefined) return <Skeleton />;
  if (!effect) return <Gone>{t("embeds.effect.gone")}</Gone>;

  const added = local.some((item) => item.sourceId === effect.id || item.publishedId === effect.id);

  const take = async () => {
    setBusy(true);
    setFailed(false);
    const done = await addToLibrary(effect.id);
    setBusy(false);
    setFailed(!done);
    if (done) trackEmbed(GOLIVE_EMBED_EVENTS.effectUse, "effect");
  };

  return (
    <Card
      icon={
        // eslint-disable-next-line @next/next/no-img-element -- served by the API, with its own cache
        <img src={workshopPreviewUrl(effect)} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800 object-cover" />
      }
      label={
        <span className="inline-flex items-center gap-1">
          <MdAutoAwesome className="h-3 w-3 text-emerald-500" />
          {t("embeds.effect.label")}
        </span>
      }
      title={effect.name}
      detail={
        failed ? (
          <span className="text-red-500">{t("embeds.effect.failed")}</span>
        ) : (
          <>
            {effect.author && <span className="truncate">{effect.author.displayName}</span>}
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <MdFavorite className="h-3 w-3" />
              {effect.likes}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5">
              <MdPeople className="h-3 w-3" />
              {effect.uses}
            </span>
          </>
        )
      }
      action={
        added ? (
          <Tag>{t("cameraWorkshop.added")}</Tag>
        ) : (
          <button type="button" disabled={busy} onClick={() => void take()} className={PRIMARY}>
            {busy ? t("cameraWorkshop.downloading") : t("cameraWorkshop.use")}
          </button>
        )
      }
    />
  );
}
