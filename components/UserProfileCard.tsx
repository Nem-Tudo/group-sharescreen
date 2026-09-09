"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { fetchUserProfile, formatDuration, type UserProfile } from "@/lib/userProfile";
import { MicIcon, ScreenIcon } from "@/components/icons";
import { VerifiedBadge } from "@/components/VerifiedBadge";
import { BsCoin, BsClock, BsShop } from "react-icons/bs";
import { SocialActions } from "@/components/SocialActions";
import { useAuth } from "@/lib/AuthContext";
import { useSignaling } from "@/lib/useSignaling";
import { usePresence } from "@/lib/presence";
import { PresenceDot } from "@/components/PresenceDot";
import { signalingClient } from "@/lib/signalingClient";
import { getAccountToken, fetchAvatarOptions, type AvatarOptions } from "@/lib/accountApi";
import { hasFeature } from "@/lib/entitlements";
import { planIcon } from "@/components/planIcons";
import { DEFAULT_SONG_VOLUME, ProfileSongPlayer } from "@/components/ProfileSongPlayer";
import { parseYouTubeId } from "@/lib/profileSong";
import {
  profileThemeStyle,
  GRADIENT_DIRECTIONS,
  isHexColor,
  type ProfileTheme,
  type ProfileThemeStyle,
} from "@/lib/profileTheme";
import { DEFAULT_AVATAR_PATH } from "@/components/UserAvatar";
import { fetchCosmeticsCatalog, type CosmeticProduct } from "@/lib/cosmetics";
import { prepareAvatarImage, AVATAR_IMAGE_ACCEPT, AVATAR_IMAGE_MAX_BYTES } from "@/lib/avatarImage";
import { MdCheck, MdEdit, MdPhotoCamera, MdDeleteOutline } from "react-icons/md";
import useNtPopups from "ntpopups";
import { UserBadges } from "@/components/UserBadges";
import { useOpenPro } from "@/lib/proModal";

// A person's public profile, as a self-contained card.
//
// Lifted out of app/user/[id]/UserProfileClient so the page and the in-room
// dialog (components/UserProfileDialog) show the same thing rather than two
// drifting copies of it — the room used to send people to the page in a new
// tab, which is a lot of ceremony for "who is this?" while you are in a call
// with them. The page still exists and is still the thing a link points at;
// this is just the part that was never page-specific.

const cardClass =
  "rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950";

/**
 * The same group, in its plan's colour: blue for Pro, gold for Pro Max.
 *
 * The border carries the same information the badge beside the heading does,
 * which is the point — somebody scanning the form sees which controls belong
 * to which plan without reading a word, and the two paid tiers stop looking
 * like one undifferentiated "locked".
 */
/**
 * The 1px gradient ring on its own, so a row inside a popover can wear it
 * without also taking PlanSection's heading and padding.
 *
 * Drawn only while the control is out of reach. The ring says "this belongs
 * to a plan you do not have" — on a subscriber it would be decoration around
 * something they can already use, and four decorated boxes is what the form
 * looked like before. Nothing to show is the right answer once it is theirs.
 */
function PlanRing({ tier, locked }: { tier: "pro" | "proMax"; locked: boolean }) {
  if (!locked) return null;
  const ring =
    tier === "proMax"
      ? "linear-gradient(120deg, #f59e0b, #fde68a, #d97706)"
      : "linear-gradient(120deg, #3b82f6, #93c5fd, #2563eb)";
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 rounded-xl"
      style={{
        padding: 1,
        background: ring,
        WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor",
        mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
        maskComposite: "exclude",
      }}
    />
  );
}

/** The wrapper classes for a row that only becomes a box while locked. */
function planRowClass(locked: boolean, extra: string): string {
  // Without the ring there is nothing for the padding to sit inside, and a
  // padded row with no border reads as a stray indent.
  return `${extra} ${locked ? "relative rounded-xl p-2.5" : ""}`;
}

/**
 * A field edited where it is shown.
 *
 * The profile used to swap into a separate form: a column of labelled inputs
 * that looked nothing like the page they produced, so the only way to see the
 * result was to save and find out. Here each field keeps its place and its
 * styling, and a pencil beside it opens an editor in that same spot — closing
 * it leaves the card showing exactly what saving would produce, unsaved
 * values included.
 */
function InlineEdit({
  editable,
  open,
  onOpen,
  onClose,
  editor,
  label,
  children,
}: {
  /** Edit mode is on and this is the owner's own profile. */
  editable: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Shown in place of `children` while open. */
  editor: React.ReactNode;
  /** For the pencil's accessible name — "Editar nome", "Editar bio". */
  label: string;
  children: React.ReactNode;
}) {
  if (!editable) return <>{children}</>;
  if (open) {
    return (
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{editor}</div>
        <button
          type="button"
          onClick={onClose}
          aria-label={`Concluir ${label.toLowerCase()}`}
          className="mt-1 shrink-0 cursor-pointer rounded-lg p-1 text-emerald-600 transition hover:bg-black/10 dark:text-emerald-400"
        >
          <MdCheck className="h-4 w-4" />
        </button>
      </div>
    );
  }
  return (
    <div className="group/inline flex items-start gap-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      <button
        type="button"
        onClick={onOpen}
        aria-label={label}
        // Always rendered, dimmed until the row is hovered: a control that
        // only exists on hover cannot be found by anybody who does not
        // already know it is there.
        className="mt-1 shrink-0 cursor-pointer rounded-lg p-1 opacity-40 transition hover:bg-black/10 group-hover/inline:opacity-100"
      >
        <MdEdit className="h-4 w-4" />
      </button>
    </div>
  );
}

/** The link to put back in the field for a song already saved. */
function songLinkOf(song: { videoId: string } | null | undefined): string {
  return song ? `https://www.youtube.com/watch?v=${song.videoId}` : "";
}

function PlanSection({
  tier,
  title,
  locked,
  titleStyle,
  neutralStyle,
  children,
}: {
  tier: "pro" | "proMax";
  title: string;
  /** The profile theme's colours, when one is active — see ProfileContent. */
  titleStyle?: React.CSSProperties;
  neutralStyle?: React.CSSProperties;
  /** Whether this account is missing the plan — decides the sales line. */
  locked?: boolean;
  children: React.ReactNode;
}) {
  // A 1px gradient ring, drawn by an overlay rather than by `border`.
  //
  // Two constraints ruled out the simpler ways. `border-image` takes a
  // gradient but ignores border-radius, so the corners would go square; and
  // the usual "wrapper with 1px padding over an opaque inner box" needs a
  // solid fill in the middle, which would sit as a white rectangle on top of
  // a subscriber's own profile gradient — this form has no background of its
  // own and that gradient shows through it.
  //
  // So the ring is a masked child: the mask keeps the border area and cuts
  // the middle out, leaving the interior genuinely transparent and the
  // content untouched.
  return (
    // Locked: the plan's ring. Unlocked: the same neutral border every other
    // section has, so the group still holds together without claiming a plan.
    <div
      className={`relative flex flex-col gap-3 rounded-xl p-3 ${
        locked ? "" : "border border-zinc-200 dark:border-zinc-800"
      }`}
      style={locked ? undefined : neutralStyle}
    >
      <PlanRing tier={tier} locked={Boolean(locked)} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300" style={titleStyle}>
          {title}
        </span>
        {/* The sales line only for somebody who cannot use the section.
            A subscriber already has it — telling them where to buy it is
            noise in a form they are trying to fill in. */}
        {locked && (
          <PlanLink tier={tier} className="text-[11px] text-zinc-500 dark:text-zinc-400" />
        )}
      </div>
      {children}
    </div>
  );
}

// One of the three lifetime totals shown below the bio — same card shape for
// call/mic/share time so the three read as one set, not three different
// widgets that happen to sit next to each other.
function StatCard({
  icon,
  label,
  seconds,
  theme,
}: {
  icon: React.ReactNode;
  label: string;
  seconds: number;
  theme?: ProfileThemeStyle | null;
}) {
  // Themed: a wash of the text colour rather than white/zinc, so these sit on
  // the gradient instead of punching three opaque holes in it.
  return (
    <div
      className={theme ? "rounded-xl border p-4" : cardClass}
      style={theme ? { background: theme.surface, borderColor: theme.border } : undefined}
    >
      <div
        className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400"
        style={theme ? { color: theme.muted, textShadow: theme.textShadow } : undefined}
      >
        {icon}
        {label}
      </div>
      <p
        className="mt-1.5 text-lg font-semibold tabular-nums text-zinc-950 dark:text-zinc-50"
        style={theme ? { color: theme.text, textShadow: theme.textShadow } : undefined}
      >
        {formatDuration(seconds)}
      </p>
    </div>
  );
}

/**
 * Fetches `id` and renders its profile, including the loading and
 * not-found states.
 *
 * `onNavigate` fires when something inside is about to take the person
 * somewhere else — today only the "they are in a room right now" link. The
 * page has nowhere to go and leaves it out; the dialog uses it to close
 * itself, so a click does not leave a modal hanging over the destination.
 */
/**
 * The one place the "Pro Max" upsell is written, so both the avatar row and
 * the banner row say the same thing and lead to the same page.
 */
function PlanLink({
  tier,
  label,
  className = "",
}: {
  tier: "pro" | "proMax";
  /** Overrides the default sentence, for a label that already names the plan. */
  label?: string;
  className?: string;
}) {
  // The plan's own mark beside the words, so "which plan is this" is answered
  // by the same badge the subscriber wears — gold for Pro Max, blue for Pro
  // (see components/planIcons). A sentence alone made every locked control
  // look like it belonged to the same, unnamed tier.
  const mark = planIcon(tier === "proMax" ? "gold_verified" : "blue_verified");
  const Mark = mark.Icon;
  // This card renders in two places — the profile page and the room's dialog
  // — so where to send somebody is not a decision it can make on its own.
  // See useOpenPro.
  const openPro = useOpenPro();
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        openPro();
      }}
      className={`inline-flex cursor-pointer items-center gap-1 underline underline-offset-2 transition hover:text-zinc-800 dark:hover:text-zinc-200 ${className}`}
    >
      <Mark className={`h-3.5 w-3.5 shrink-0 ${mark.className}`} />
      {label ?? `Disponível no ${tier === "proMax" ? "Pro Max" : "Pro"}.`}
    </button>
  );
}

/** One row of pickable avatars, or the same row shown as a locked preview. */
function AvatarRow({
  label,
  paths,
  selected,
  onPick,
  locked = false,
  lockedHint,
  lockedTier,
}: {
  label: string;
  paths: string[];
  selected: string | null;
  onPick: (path: string) => void;
  locked?: boolean;
  lockedHint?: string;
  lockedTier?: "pro" | "proMax";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
        {label}
        {locked && lockedHint && (
          <>
            <span aria-hidden>·</span>
            <PlanLink
              tier={lockedTier ?? "pro"}
              label={lockedHint}
              className="text-[11px] text-zinc-500 dark:text-zinc-400"
            />
          </>
        )}
      </span>
      <div className="flex flex-wrap gap-2">
        {paths.map((path) => (
          <button
            key={path}
            type="button"
            disabled={locked}
            onClick={() => onPick(path)}
            aria-label={label}
            aria-pressed={selected === path}
            className={`h-11 w-11 overflow-hidden rounded-full border-2 transition ${
              selected === path
                ? "border-emerald-500"
                : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600"
            } ${locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
          >
            {/* Plain <img>: these are static files under public/, and one that
                is not there yet simply draws nothing rather than breaking the
                row around it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={path} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function UserProfileCard({
  id,
  onNavigate,
  autoPlaySong = false,
}: {
  id: string;
  onNavigate?: () => void;
  /**
   * Whether the profile song starts on its own. True only from the /user page
   * — in the room's popup somebody is checking who a name belongs to, and
   * music starting over a call they are in is not what they asked for.
   */
  autoPlaySong?: boolean;
}) {
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);

  // Keeps whatever's already on screen while a new id loads, rather than
  // flashing back to "Carregando..." — the aborted fetch below (on id
  // change/unmount) is what keeps a slow response for a since-abandoned id
  // from landing after the fact.
  useEffect(() => {
    const controller = new AbortController();
    fetchUserProfile(id, controller.signal)
      .then(setProfile)
      .catch((err) => {
        // A superseded request (id changed, or this profile unmounted)
        // aborts on purpose — that's not "not found," it's just stale, and
        // the effect that fired it no longer cares about the answer.
        if (err instanceof DOMException && err.name === "AbortError") return;
        setProfile(null);
      });
    return () => controller.abort();
  }, [id]);

  if (profile === undefined) return <ProfileSkeleton />;
  if (profile === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white p-6 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Não foi possível encontrar esse perfil.
        </p>
      </div>
    );
  }
  return (
    <ProfileContent
      profile={profile}
      onNavigate={onNavigate}
      onProfileUpdated={setProfile}
      autoPlaySong={autoPlaySong}
    />
  );
}

// The profile's own shape while it is still arriving.
//
// It replaced the line "Carregando perfil...", which was honest and told you
// nothing: the dialog opened at one size showing a sentence, then jumped to
// another size showing a card. Tracing the real layout means the only thing
// that changes when the fetch lands is that the grey blocks become content —
// the box never resizes, which matters far more here than on a page, because
// this one is centred over a room and every resize moves it.
//
// Mirrors ProfileContent below deliberately: same banner height, same rounded
// container, same three-column stat grid. Those values being duplicated is
// the cost, and the thing to check if that layout is ever reworked — a
// skeleton that no longer matches is a shape that jumps, which is worse than
// no skeleton at all.
const SKELETON_BLOCK = "animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80";

function ProfileSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      aria-busy="true"
      aria-label="Carregando perfil"
    >
      <div className={`h-32 w-full rounded-none sm:h-44 ${SKELETON_BLOCK}`} />
      <div className="relative -mt-12 flex items-end justify-between px-5 sm:-mt-16 sm:px-6">
        <div
          className={`h-24 w-24 rounded-2xl border-4 border-white dark:border-zinc-950 sm:h-28 sm:w-28 ${SKELETON_BLOCK}`}
        />
      </div>
      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        <div className="flex flex-wrap items-end justify-between gap-3 pt-3">
          <div className="min-w-0 flex-1">
            {/* Display name, then @username — the two-line block the real
                header has, at the sizes it actually renders at. */}
            <div className={`h-7 w-44 ${SKELETON_BLOCK}`} />
            <div className={`mt-2 h-4 w-28 ${SKELETON_BLOCK}`} />
          </div>
          <div className={`h-9 w-28 shrink-0 rounded-full ${SKELETON_BLOCK}`} />
        </div>

        {/* The bio: two lines of unequal length, because a paragraph that
            loads as two identical bars reads as a table, not as prose. */}
        <div className={`mt-5 h-4 w-full ${SKELETON_BLOCK}`} />
        <div className={`mt-2 h-4 w-2/3 ${SKELETON_BLOCK}`} />

        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
          <div className={`h-[74px] rounded-xl ${SKELETON_BLOCK}`} />
        </div>

        <div className={`mt-5 h-3 w-40 ${SKELETON_BLOCK}`} />
      </div>
    </div>
  );
}

function ProfileContent({
  profile,
  onNavigate,
  onProfileUpdated,
  autoPlaySong = false,
}: {
  profile: UserProfile;
  onNavigate?: () => void;
  onProfileUpdated?: (updated: UserProfile) => void;
  /**
   * Whether the profile song starts on its own. True only from the /user page
   * — in the room's popup somebody is checking who a name belongs to, and
   * music starting over a call they are in is not what they asked for.
   */
  autoPlaySong?: boolean;
}) {
  const { account: authAccount, updateProfile, refresh: refreshAuth } = useAuth();
  const state = useSignaling();
  const { openPopup } = useNtPopups();
  const { account, live } = profile;
  const isOwner = Boolean(authAccount && authAccount.id === account.id);
  // The same dot the participant list and the friends list draw, on the one
  // screen that is entirely about this person.
  const presence = usePresence(account.id);

  const [isEditing, setIsEditing] = useState(false);
  const [editDisplayName, setEditDisplayName] = useState(account.displayName);
  const [editBio, setEditBio] = useState(account.bio ?? "");
  const [editBgColor, setEditBgColor] = useState<string | null>(account.equippedProfileColor ?? null);
  const [previewAvatar, setPreviewAvatar] = useState<string | null>(account.avatarUrl ?? null);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null | undefined>(undefined);
  const [ownedBgColors, setOwnedBgColors] = useState<CosmeticProduct[]>([]);
  const [avatarOptions, setAvatarOptions] = useState<AvatarOptions | null>(null);
  const [avatarOptionsError, setAvatarOptionsError] = useState<string | null>(null);
  const [previewBanner, setPreviewBanner] = useState<string | null>(account.bannerUrl ?? null);
  const [editTheme, setEditTheme] = useState<ProfileTheme | null>(account.profileTheme ?? null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [editSong, setEditSong] = useState("");
  const [editSongVolume, setEditSongVolume] = useState(
    account.profileSong?.volume ?? DEFAULT_SONG_VOLUME
  );
  // Which field is open for editing, or none. One at a time: two inputs open
  // at once is a form again, which is the thing this replaced.
  const [openField, setOpenField] = useState<"name" | "bio" | "song" | null>(null);
  const [bannerPickerOpen, setBannerPickerOpen] = useState(false);
  const [bannerDataUrl, setBannerDataUrl] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const avatarPickerRef = useRef<HTMLDivElement>(null);
  const bannerPickerRef = useRef<HTMLDivElement>(null);

  // Sync state if profile prop changes
  useEffect(() => {
    setEditDisplayName(account.displayName);
    setEditBio(account.bio ?? "");
    setEditBgColor(account.equippedProfileColor ?? null);
    setPreviewAvatar(account.avatarUrl ?? null);
    setAvatarDataUrl(undefined);
    setPreviewBanner(account.bannerUrl ?? null);
    setBannerDataUrl(undefined);
    setEditTheme(account.profileTheme ?? null);
    setEditSong(songLinkOf(account.profileSong));
    setEditSongVolume(account.profileSong?.volume ?? DEFAULT_SONG_VOLUME);
  }, [account]);

  // Load cosmetics when entering edit mode or when owned items change
  useEffect(() => {
    if (!isEditing || !isOwner) return;
    let cancelled = false;
    fetchCosmeticsCatalog()
      .then((data) => {
        if (cancelled) return;
        const bgColors = data.catalog.filter(
          (p) => p.type === "profile_color" && data.ownedCosmetics.includes(p.id)
        );
        setOwnedBgColors(bgColors);
      })
      .catch(() => {
        // Silently fail if store catalog cannot be reached
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, isOwner, authAccount?.ownedCosmetics]);

  // The catalogue, loaded only once the picker is on screen — it is a list of
  // filenames that never changes mid-session, and fetching it on mount would
  // put a request behind every profile view for a control most of them never
  // open.
  useEffect(() => {
    if (!isEditing || !isOwner) return;
    let cancelled = false;
    fetchAvatarOptions()
      .then((options) => {
        if (!cancelled) setAvatarOptions(options);
      })
      .catch(() => {
        // Shown in the panel rather than swallowed: this list is the only
        // content the pencil has, so losing it quietly looks like a dead
        // button.
        if (!cancelled) setAvatarOptionsError("Não foi possível carregar os avatares.");
      });
    return () => {
      cancelled = true;
    };
  }, [isEditing, isOwner]);

  // Closing the picker: a click anywhere outside it, or Escape. Bound only
  // while it is open, so a closed panel costs no listeners.
  useEffect(() => {
    if (!avatarPickerOpen && !bannerPickerOpen) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      // Each panel closes only on a click outside *itself*. The banner's
      // trigger lives inside its own wrapper, so a click on it lands as
      // "inside" and the button's toggle is left to do its job — treating it
      // as outside would close and reopen in one gesture, which reads as the
      // button doing nothing at all.
      if (!avatarPickerRef.current?.contains(target)) {
        const onAvatarPencil = (target as Element).closest?.(
          '[aria-label="Alterar foto de perfil"]'
        );
        if (!onAvatarPencil) setAvatarPickerOpen(false);
      }
      if (!bannerPickerRef.current?.contains(target)) setBannerPickerOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setAvatarPickerOpen(false);
      setBannerPickerOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [avatarPickerOpen, bannerPickerOpen]);

  /** A preset: stored as its own path, so no upload is involved. */
  function handlePickPreset(path: string) {
    setError(null);
    setPreviewAvatar(path);
    setAvatarDataUrl(path);
  }

  async function handleAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > AVATAR_IMAGE_MAX_BYTES) {
      setError(`A imagem deve ter no máximo ${Math.round(AVATAR_IMAGE_MAX_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    try {
      const prepared = await prepareAvatarImage(file);
      setPreviewAvatar(prepared.dataUrl);
      setAvatarDataUrl(prepared.dataUrl);
    } catch {
      setError("Não foi possível processar a foto selecionada.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleBannerPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    if (file.size > AVATAR_IMAGE_MAX_BYTES) {
      setError(`O banner deve ter no máximo ${Math.round(AVATAR_IMAGE_MAX_BYTES / (1024 * 1024))} MB.`);
      return;
    }
    try {
      // The same preparation the avatar gets, and deliberately so: it caps the
      // dimensions and re-encodes, which is what keeps a 12MP phone photo from
      // being posted to the CDN whole.
      const prepared = await prepareAvatarImage(file);
      setPreviewBanner(prepared.dataUrl);
      setBannerDataUrl(prepared.dataUrl);
    } catch {
      setError("Não foi possível processar o banner selecionado.");
    } finally {
      if (bannerInputRef.current) bannerInputRef.current.value = "";
    }
  }

  function handleRemoveBanner() {
    setPreviewBanner(null);
    setBannerDataUrl(null);
  }

  function handleRemoveAvatar() {
    setPreviewAvatar(null);
    setAvatarDataUrl(null);
  }

  function handleCancel() {
    setIsEditing(false);
    setEditDisplayName(account.displayName);
    setEditBio(account.bio ?? "");
    setEditBgColor(account.equippedProfileColor ?? null);
    setPreviewAvatar(account.avatarUrl ?? null);
    setAvatarDataUrl(undefined);
    setPreviewBanner(account.bannerUrl ?? null);
    setBannerDataUrl(undefined);
    setEditTheme(account.profileTheme ?? null);
    setEditSong(songLinkOf(account.profileSong));
    setEditSongVolume(account.profileSong?.volume ?? DEFAULT_SONG_VOLUME);
    setAvatarPickerOpen(false);
    setBannerPickerOpen(false);
    setOpenField(null);
    setError(null);
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmedName = editDisplayName.trim();
    if (!trimmedName) {
      setError("O nome de exibição não pode ficar vazio.");
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const updatedAccount = await updateProfile({
        displayName: trimmedName,
        bio: editBio.trim() ? editBio.trim() : null,
        avatar: avatarDataUrl,
        banner: bannerDataUrl,
        profileTheme: editTheme,
        // Only when it actually changed. Sending it on every save meant an
        // unrelated bio edit could be refused over whatever happened to be in
        // this field — one bad character here blocked saving the whole
        // profile. Unchanged means undefined, which the API reads as "leave
        // it alone"; "" is how it is told to clear one.
        ...(songChanged ? { song: editSong.trim() } : {}),
        // Sent whenever it moved, with or without a new link — the API keeps
        // the song and just moves the number.
        ...(editSongVolume !== (account.profileSong?.volume ?? DEFAULT_SONG_VOLUME)
          ? { songVolume: editSongVolume }
          : {}),
        equippedProfileColor: editBgColor,
      });

      onProfileUpdated?.({
        ...profile,
        account: updatedAccount,
      });

      await refreshAuth();

      // If user is currently in a room, announce the new name to participants
      if (state.name && state.name !== trimmedName) {
        signalingClient.register(trimmedName, getAccountToken());
      }

      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  // With the day, not just the month: "desde agosto de 2026" reads as an
  // approximation of something the site knows exactly.
  // The song as it stands in the form: what was typed, or what is saved.
  const songValue = editSong.trim();
  const songChanged = songValue !== songLinkOf(account.profileSong);
  const pendingSongId = songValue ? parseYouTubeId(songValue) : null;
  // A link that is not a YouTube video, said beside the field. It used to be
  // discovered only by pressing save and having the whole profile refused.
  const songError = songValue && !pendingSongId ? "Esse link não é um vídeo do YouTube." : null;

  const memberSince = new Date(account.createdAt).toLocaleDateString("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const activeBgColor = isEditing ? editBgColor : account.equippedProfileColor;
  // Same fallback as everywhere else — see UserAvatar. In edit mode this is
  // also what "Remover foto" leaves behind, which is the honest result: the
  // picture is gone and the default is what they have.
  const currentAvatar = (isEditing ? previewAvatar : account.avatarUrl) ?? DEFAULT_AVATAR_PATH;
  const currentBanner = isEditing ? previewBanner : account.bannerUrl;
  const canUploadBanner = hasFeature("banner_upload", authAccount?.features ?? []);
  const canEditTheme = hasFeature("profile_gradient", authAccount?.features ?? []);
  const canEditSong = hasFeature("profile_song", authAccount?.features ?? []);
  // While editing, the card *is* the preview — there is no second swatch to
  // compare against, and a preview that is not the thing itself always
  // disagrees with it somewhere.
  const theme = profileThemeStyle(isEditing ? editTheme : account.profileTheme);

  // The edit form wears the same palette as the profile behind it, so what
  // somebody is building is what they are looking at while they build it —
  // a neutral light-mode form pasted on top of a dark gradient was the one
  // place the preview stopped being a preview.
  //
  // Applied as inline styles over the existing classes rather than by
  // rewriting each className: an inline colour wins over any Tailwind
  // variant, so one object per role covers every element that plays that
  // role, and none can be missed by editing a class string wrong.
  const themedLabel = theme ? { color: theme.text, textShadow: theme.textShadow } : undefined;
  const themedHint = theme ? { color: theme.muted, textShadow: theme.textShadow } : undefined;
  const themedField = theme
    ? { background: theme.surface, borderColor: theme.border, color: theme.text }
    : undefined;
  const themedDivider = theme ? { borderColor: theme.border } : undefined;

  return (
    <div
      className={`overflow-hidden rounded-2xl border transition-colors ${
        theme ? "" : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950"
      }`}
      // The gradient is the card, not a strip behind it: borders, panels and
      // text all come from the same two colours (see lib/profileTheme), which
      // is the difference between a themed profile and a background shoved
      // under the old one.
      style={theme ? { background: theme.background, borderColor: theme.border, color: theme.text } : undefined}
    >
      {/* Banner image or background color purchased with points in cosmetics store */}
      <div
        className="relative h-32 w-full transition-all duration-300 sm:h-44"
        style={
          currentBanner
            ? {
                backgroundImage: `url(${currentBanner})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : activeBgColor
            ? {
                background: activeBgColor,
              }
            : theme
              ? // A band of its own, in the theme's own colours.
                //
                // This was `transparent`, on the reasoning that the card's
                // gradient should run unbroken from the top. What that
                // actually did was delete the banner: the strip became a
                // slice of the background behind it, so a profile with a
                // gradient had no banner at all. The overlay and the hairline
                // below give it back its edges without introducing a second
                // palette — which is what the default green band would be on
                // top of somebody's chosen colours.
                {
                  backgroundImage: `linear-gradient(${theme.surface}, ${theme.surface}), ${theme.background}`,
                  borderBottom: `1px solid ${theme.border}`,
                }
              : {
                  background: "linear-gradient(135deg, #18181b 0%, #10b981 140%)",
                }
        }
      >
        {/* On the banner it changes, in the corner, rather than in a section
            of the form below — the same move the avatar's pencil makes.

            It opens downward. Upward was the first instinct — keep the strip
            being edited visible — but the panel is taller than the banner, so
            it ran past the top of the card, which is overflow-hidden to round
            its corners, and got sliced. Downward it opens into the card's own
            body, which has all the room it needs. */}
        {isEditing && (
          <div className="absolute right-3 bottom-3" ref={bannerPickerRef}>
            <button
              type="button"
              onClick={() => setBannerPickerOpen((open) => !open)}
              aria-expanded={bannerPickerOpen}
              className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur-sm transition-colors hover:bg-black/70"
            >
              <MdPhotoCamera className="h-3.5 w-3.5" />
              Alterar banner
            </button>
            {bannerPickerOpen && (
              <div
                // Above the avatar row that overlaps this banner: that row
                // comes later in the DOM and would otherwise paint over the
                // panel opening under it.
                className="absolute right-0 top-full z-40 mt-2 flex w-80 max-w-[calc(100vw-3rem)] flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-800 dark:bg-zinc-950"
              >
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300" style={themedLabel}>
                  Alterar banner
                </label>
                <button
                  type="button"
                  onClick={() => openPopup("cosmetics_store", { data: {} })}
                  className="flex items-center gap-1 text-xs font-medium text-emerald-600 transition hover:text-emerald-700 hover:underline dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  <BsShop className="h-3 w-3" />
                  Loja de cosméticos
                </button>
              </div>
              {/* The gold ring, same as every other Pro Max control. Only
                  this row wears one: the store colours below are bought with
                  points, not with a plan, so a plan's colour on them would be
                  saying something untrue. */}
              <div className={planRowClass(!canUploadBanner, "flex flex-wrap items-center gap-2")}>
                <PlanRing tier="proMax" locked={!canUploadBanner} />
                <button
                  type="button"
                  disabled={!canUploadBanner}
                  onClick={() => bannerInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                >
                  <MdPhotoCamera className="h-3.5 w-3.5" />
                  Enviar banner
                </button>
                {previewBanner && canUploadBanner && (
                  <button
                    type="button"
                    onClick={handleRemoveBanner}
                    className="flex items-center gap-1 text-xs font-medium text-red-600 transition hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <MdDeleteOutline className="h-4 w-4" />
                    Remover banner
                  </button>
                )}
                {!canUploadBanner && (
                  <PlanLink tier="proMax" className="text-xs text-zinc-500 dark:text-zinc-400" />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditBgColor(null)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                    editBgColor === null
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <span className="h-4 w-4 rounded-full bg-gradient-to-br from-zinc-800 to-emerald-500 border border-zinc-300 dark:border-zinc-700" />
                  Padrão
                </button>

                {ownedBgColors.map((colorProduct) => (
                  <button
                    key={colorProduct.id}
                    type="button"
                    onClick={() => setEditBgColor(colorProduct.value)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
                      editBgColor === colorProduct.value
                        ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    <span
                      className="h-4 w-4 rounded-full border border-black/20"
                      style={{ background: colorProduct.value }}
                    />
                    {colorProduct.label}
                  </button>
                ))}
              </div>

              {ownedBgColors.length === 0 && (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-xs text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-900/50 dark:text-zinc-400">
                  <span>Você ainda não possui cores de banner compradas na loja.</span>
                  <button
                    type="button"
                    onClick={() => openPopup("cosmetics_store", { data: {} })}
                    className="shrink-0 font-semibold text-emerald-600 underline hover:text-emerald-700 dark:text-emerald-400"
                  >
                    Comprar cores
                  </button>
                </div>
              )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Avatar overlapping banner and Edit Profile trigger.
          pointer-events-none on the row, auto on the things in it: the row is
          pulled up over the banner by -mt-12 and spans the full width, so its
          empty middle sat invisibly on top of the banner's bottom strip and
          swallowed every click meant for the "alterar banner" button in that
          corner. */}
      <div className="pointer-events-none relative -mt-12 flex items-end justify-between px-5 sm:-mt-16 sm:px-6">
        <div
          className={`group pointer-events-auto relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl border-4 shadow-md sm:h-28 sm:w-28 ${
            theme ? "" : "border-white bg-zinc-100 dark:border-zinc-950 dark:bg-zinc-900"
          }`}
          style={theme ? { borderColor: theme.ring, background: theme.surface } : undefined}
        >
          {/* No empty case left to handle: currentAvatar falls back to the
              first default, so there is always a picture here. */}
          <img
            src={currentAvatar}
            alt={account.displayName}
            className="h-full w-full object-cover"
          />
          {/* Always visible on the picture, with the panel opening below it.
              A plain positioned panel rather than the shared Popover: that one
              anchors through Tippy, and here the trigger sits inside an
              overflow-hidden circle — this is markup whose behaviour is
              readable from the two elements involved. */}
          {isEditing && (
            <button
              type="button"
              onClick={() => setAvatarPickerOpen((open) => !open)}
              aria-expanded={avatarPickerOpen}
              aria-label="Alterar foto de perfil"
              className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/30 text-white transition-colors hover:bg-black/60 focus-visible:bg-black/60"
            >
              <MdEdit className="h-6 w-6 drop-shadow" />
            </button>
          )}
        </div>

        {/* Outside the avatar's box for the same reason the picker below is:
            that box is overflow-hidden to round the picture, so a dot
            positioned inside it would be clipped away at the corner. */}
        <PresenceDot
          presence={presence}
          size={18}
          // Parked on the avatar box's bottom-right corner, in the row's
          // coordinates: px-5 (20px) + w-24 (96px) puts that corner at 116px,
          // less half the dot; the sm: pair is the same sum with px-6 and w-28.
          className="pointer-events-none absolute bottom-1 left-[6.4rem] z-10 sm:left-[7.6rem]"
        />

        {/* Outside the avatar's own box on purpose: that one is
            overflow-hidden to round the picture, and anything positioned
            inside it is clipped to the circle. */}
        {isEditing && avatarPickerOpen && (
          <div
            ref={avatarPickerRef}
            className="pointer-events-auto absolute left-5 top-full z-30 mt-2 w-80 max-w-[calc(100%-2.5rem)] rounded-xl border border-zinc-200 bg-white p-3 shadow-lg sm:left-6 dark:border-zinc-800 dark:bg-zinc-950"
          >
                  {avatarOptions ? (
                    <div className="flex flex-col gap-3">
        {/* No close button: the popover closes on a click outside and on
            Escape, and a second way out only takes room from the options. */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
            Foto de perfil
          </span>
          {/* Lost when the old form went away — it lived in that form's
              header. It belongs here anyway: this is where the picture is
              chosen, so it is where clearing it belongs too. */}
          {previewAvatar && (
            <button
              type="button"
              onClick={handleRemoveAvatar}
              className="flex items-center gap-1 text-xs font-medium text-red-600 transition hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <MdDeleteOutline className="h-4 w-4" />
              Remover
            </button>
          )}
        </div>

        {/* currentAvatar, not previewAvatar: somebody who never chose
            is *wearing* the first default everywhere else in the app,
            so the picker has to show it as theirs. Marking nothing
            would invite them to "pick" the avatar they already have
            and then wonder why nothing changed.

            "Remover foto" above stays on previewAvatar on purpose —
            that one asks whether there is a stored picture to clear,
            which is a different question. */}
        <AvatarRow
          label="Padrão"
          paths={avatarOptions.defaults}
          selected={currentAvatar}
          onPick={handlePickPreset}
        />

        {avatarOptions.gallery.length > 0 && (
          <div className={planRowClass(!avatarOptions.canUseGallery, "")}>
            <PlanRing tier="pro" locked={!avatarOptions.canUseGallery} />
            <AvatarRow
            label="Avatares Pro"
            paths={avatarOptions.gallery}
            selected={currentAvatar}
            onPick={handlePickPreset}
            locked={!avatarOptions.canUseGallery}
            lockedHint="Disponível no Pro"
              lockedTier="pro"
            />
          </div>
        )}

        {/* The same hairline ring the form's sections wear, so the two paid
            rows in here are told apart the same way they are outside. */}
        <div className={planRowClass(!avatarOptions.canUpload, "flex flex-wrap items-center gap-2")}>
          <PlanRing tier="proMax" locked={!avatarOptions.canUpload} />
          <button
            type="button"
            disabled={!avatarOptions.canUpload}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-800 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <MdPhotoCamera className="h-3.5 w-3.5" />
            Enviar minha imagem
          </button>
          {!avatarOptions.canUpload && (
              <PlanLink tier="proMax" className="text-xs text-zinc-500 dark:text-zinc-400" />
          )}
        </div>
      </div>
                  ) : (
                    <p className="text-xs text-zinc-500 dark:text-zinc-400" style={themedHint}>
                      {avatarOptionsError ?? "Carregando os avatares…"}
                    </p>
                  )}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={AVATAR_IMAGE_ACCEPT}
          className="hidden"
          onChange={handleAvatarPicked}
        />

        <input
          ref={bannerInputRef}
          type="file"
          accept={AVATAR_IMAGE_ACCEPT}
          className="hidden"
          onChange={handleBannerPicked}
        />

        {isOwner && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            <MdEdit className="h-3.5 w-3.5 text-zinc-500" />
            Editar perfil
          </button>
        )}
      </div>

      <div className="px-5 pb-5 sm:px-6 sm:pb-6">
        {/* One view, always. Editing used to swap the whole card for a
            column of labelled inputs that looked nothing like the profile it
            produced — the only way to see the result was to save and find
            out. Now the fields are edited where they sit (see InlineEdit),
            and what is left down here is the part with nowhere else to live:
            the background, which is the card itself, and the actions. */}
            <div className="flex flex-wrap items-end justify-between gap-3 pt-3">
              <div className="min-w-0">
                <InlineEdit
                  editable={isEditing}
                  open={openField === "name"}
                  onOpen={() => setOpenField("name")}
                  onClose={() => setOpenField(null)}
                  label="Editar nome"
                  editor={
                    <input
                      autoFocus
                      maxLength={24}
                      value={editDisplayName}
                      onChange={(e) => setEditDisplayName(e.target.value)}
                      className="themed-field w-full rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-2xl font-semibold text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                      style={themedField}
                    />
                  }
                >
                  <h1
                    className="flex items-center gap-1.5 truncate text-2xl font-semibold text-zinc-950 dark:text-zinc-50"
                    style={theme ? { color: theme.text, textShadow: theme.textShadow } : undefined}
                  >
                    {/* The pending value, not the saved one: closing an editor
                        has to leave the card showing what saving would give. */}
                    <span
                      style={
                        account.equippedNameColor ? { color: account.equippedNameColor } : undefined
                      }
                    >
                      {isEditing ? editDisplayName : account.displayName}
                    </span>
                    <VerifiedBadge flags={account?.flags} className="h-6 w-6 shrink-0" />
                  </h1>
                </InlineEdit>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  <p
                    className="text-sm text-zinc-500 dark:text-zinc-400"
                    style={theme ? { color: theme.muted, textShadow: theme.textShadow } : undefined}
                  >
                    @{account.username}
                  </p>
                  <UserBadges account={account} isOwner={isOwner} theme={theme ?? undefined} />
                </div>
              </div>
              <span
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold ${
                  theme
                    ? ""
                    : "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                }`}
                // Amber is a fixed accent that fights an arbitrary palette;
                // themed, the pill borrows the card's own colours and the coin
                // stays gold on its own.
                style={theme ? { borderColor: theme.border, background: theme.surface, color: theme.text } : undefined}
              >
                <BsCoin className="h-4 w-4 shrink-0" />
                {account.points ?? 0} pontos
              </span>
            </div>

            {live && (
              <Link
                href={`/watch/${live.room}`}
                onClick={onNavigate}
                className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-500/20 dark:text-emerald-400"
              >
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                Está numa sala pública agora — {live.peopleCount}{" "}
                {live.peopleCount === 1 ? "pessoa" : "pessoas"}, entrar em &quot;{live.room}&quot;
              </Link>
            )}

            <div className="mt-4">
              <InlineEdit
                editable={isEditing}
                open={openField === "bio"}
                onOpen={() => setOpenField("bio")}
                onClose={() => setOpenField(null)}
                label="Editar descrição"
                editor={
                  <textarea
                    autoFocus
                    rows={3}
                    maxLength={300}
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    placeholder="Escreva algo sobre você..."
                    className="themed-field w-full resize-none rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                    style={themedField}
                  />
                }
              >
                <p
                  className="whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300"
                  style={theme ? { color: theme.muted, textShadow: theme.textShadow } : undefined}
                >
                  {(isEditing ? editBio : account.bio) || "Sem descrição."}
                </p>
              </InlineEdit>
            </div>

            {/* The song, edited where it plays.
                Shown for the whole of edit mode, including to somebody
                without the plan. It used to be gated on `canEditSong`, which
                made the entire slot vanish for them — no editor, no lock, no
                sign the feature exists — and vanish just the same if the API
                had not yet started publishing the permission. A locked row
                says which of those it is. */}
            {(account.profileSong || isEditing) && (
              // The gold ring, like every other locked Pro Max control — and
              // only while editing: on somebody else's profile the ring would
              // be selling a plan around a song that is simply playing.
              <div className={`mt-4 ${planRowClass(isEditing && !canEditSong, "")}`}>
                <PlanRing tier="proMax" locked={isEditing && !canEditSong} />
                <InlineEdit
                  editable={isEditing && canEditSong}
                  open={openField === "song"}
                  onOpen={() => setOpenField("song")}
                  onClose={() => setOpenField(null)}
                  label="Editar música"
                  editor={
                    <div className="flex flex-col gap-1">
                      <input
                        autoFocus
                        type="url"
                        inputMode="url"
                        value={editSong}
                        onChange={(e) => setEditSong(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="themed-field w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                        style={themedField}
                      />
                      {songError && <p className="text-xs text-red-500">{songError}</p>}
                      {/* The volume visitors hear, not a control for whoever
                          is listening: it is part of the choice, and the
                          person who picked the song is the one who knows how
                          loud it should sit under a page. */}
                      <label
                        className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
                        style={themedHint}
                      >
                        Volume
                        <input
                          type="range"
                          min={0}
                          max={100}
                          step={5}
                          value={editSongVolume}
                          onChange={(e) => setEditSongVolume(Number(e.target.value))}
                          className="h-1 flex-1 cursor-pointer accent-emerald-600"
                        />
                        <span className="w-9 shrink-0 tabular-nums text-right">
                          {editSongVolume}%
                        </span>
                      </label>
                    </div>
                  }
                >
                  {pendingSongId ? (
                    <ProfileSongPlayer
                      // The pending id, so closing the editor leaves the card
                      // showing what saving would produce — the same rule the
                      // name and the bio follow. The title only arrives from
                      // the API on save, so an unsaved song names itself
                      // generically until then.
                      song={{
                        videoId: pendingSongId,
                        title:
                          account.profileSong?.videoId === pendingSongId
                            ? account.profileSong.title
                            : "",
                        volume: isEditing ? editSongVolume : account.profileSong?.volume,
                      }}
                      // Never while editing: the card is being worked on, and
                      // music starting under that is not a preview anybody
                      // asked for.
                      autoPlay={autoPlaySong && !isEditing}
                      theme={theme}
                    />
                  ) : (
                    <p
                      className="flex flex-wrap items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400"
                      style={themedHint}
                    >
                      Sem música no perfil.
                      {isEditing && !canEditSong && <PlanLink tier="proMax" className="text-xs" />}
                    </p>
                  )}
                </InlineEdit>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatCard
                theme={theme}
                icon={<BsClock className="h-3.5 w-3.5" />}
                label="Tempo em call"
                seconds={account.callSeconds ?? 0}
              />
              <StatCard
                theme={theme}
                icon={<MicIcon className="h-3.5 w-3.5" />}
                label="Tempo com o mic aberto"
                seconds={account.micSeconds ?? 0}
              />
              <StatCard
                theme={theme}
                icon={<ScreenIcon className="h-3.5 w-3.5" />}
                label="Tempo compartilhando tela"
                seconds={account.shareSeconds ?? 0}
              />
            </div>

            {/* Adding and blocking live on the profile because that is where you
                land after clicking a name anywhere else — the room's participant
                list, a chat message, the header. See components/SocialActions. */}
            <SocialActions
              userId={account.id}
              displayName={account.displayName}
              className="mt-5"
              // Same callback the profile links use: opening the conversation
              // window is leaving this card, so the dialog holding it closes.
              onLeave={onNavigate}
            />

            <p
              className="mt-5 text-xs text-zinc-400 dark:text-zinc-600"
              style={theme ? { color: theme.faint, textShadow: theme.textShadow } : undefined}
            >
              No GoLive desde {memberSince}.
            </p>

        {isEditing && (
          <form onSubmit={handleSave} className="mt-5 flex flex-col gap-4">
            <PlanSection
              tier="proMax"
              title="Fundo do perfil"
              locked={!canEditTheme}
              titleStyle={themedLabel}
              neutralStyle={themedDivider}
            >
              {/* Shown to everybody and disabled without the plan, rather
                  than replaced by a sentence: the controls are what explain
                  the perk — two colours and a direction — and a line of text
                  where they would be leaves somebody guessing what they would
                  even be buying. */}
              <fieldset disabled={!canEditTheme} className="contents">
                <>
                  <div
                    className={`flex flex-wrap items-end gap-3 ${
                      canEditTheme ? "" : "cursor-not-allowed opacity-50"
                    }`}
                  >
                    <label
                      className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                      style={themedHint}
                    >
                      Cor 1
                      <input
                        type="color"
                        value={isHexColor(editTheme?.from ?? "") ? editTheme!.from : "#18181b"}
                        onChange={(e) =>
                          setEditTheme((current) => ({
                            from: e.target.value,
                            to: current?.to ?? "#10b981",
                            angle: current?.angle ?? 135,
                          }))
                        }
                        className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-300 bg-transparent dark:border-zinc-700"
                      />
                    </label>
                    <label
                      className="flex flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                      style={themedHint}
                    >
                      Cor 2
                      <input
                        type="color"
                        value={isHexColor(editTheme?.to ?? "") ? editTheme!.to : "#10b981"}
                        onChange={(e) =>
                          setEditTheme((current) => ({
                            from: current?.from ?? "#18181b",
                            to: e.target.value,
                            angle: current?.angle ?? 135,
                          }))
                        }
                        className="h-9 w-14 cursor-pointer rounded-lg border border-zinc-300 bg-transparent dark:border-zinc-700"
                      />
                    </label>
                    <label
                      className="flex flex-1 flex-col gap-1 text-xs text-zinc-600 dark:text-zinc-400"
                      style={themedHint}
                    >
                      Direção
                      <select
                        value={editTheme?.angle ?? 135}
                        onChange={(e) =>
                          setEditTheme((current) => ({
                            from: current?.from ?? "#18181b",
                            to: current?.to ?? "#10b981",
                            angle: Number(e.target.value),
                          }))
                        }
                        className="h-9 w-full min-w-36 rounded-lg border border-zinc-300 bg-white px-2 text-xs text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
                        style={themedField}
                      >
                        {GRADIENT_DIRECTIONS.map((direction) => (
                          <option
                            key={direction.angle}
                            value={direction.angle}
                            // Its own colours, never the theme's. An <option>
                            // inherits `color` from the select, but the open
                            // dropdown is drawn by the browser on its own
                            // background — so a white-text theme produced
                            // white text on the browser's white menu, i.e.
                            // nothing at all. This pair is legible in that
                            // menu whatever the profile's colours are.
                            style={{ color: "#18181b", backgroundColor: "#ffffff" }}
                          >
                            {direction.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {editTheme && canEditTheme && (
                    <button
                      type="button"
                      onClick={() => setEditTheme(null)}
                      className="self-start text-xs font-medium text-red-600 transition hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Voltar ao fundo padrão
                    </button>
                  )}
                </>
              </fieldset>
            </PlanSection>

            {error && (
              <p className="text-xs font-medium text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            {/* Actions */}
            <div className="mt-2 flex items-center justify-end gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
              <button
                type="button"
                disabled={saving}
                onClick={handleCancel}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving || !editDisplayName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-zinc-950 px-4 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {saving ? "Salvando foto e perfil..." : "Salvar alterações"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
