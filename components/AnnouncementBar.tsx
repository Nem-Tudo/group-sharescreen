"use client";

import { ANNOUNCEMENT_COLOR_PRESETS, type Announcement } from "@/lib/announcement";
import { Tooltip } from "@/components/Tooltip";
import { useT } from "@/lib/useI18n";

// Pure presentational — reused both by the real site-wide banner
// (AnnouncementBanner, wired to signalingClient) and by the admin panel's
// preview button, so what the admin sees while composing one is pixel-for-
// pixel what visitors get.
export function AnnouncementBar({
  announcement,
  onDismiss,
  onButtonClick,
}: {
  announcement: Announcement;
  onDismiss?: () => void;
  // Fired right before the actual button behavior — kept separate from that
  // behavior (rather than baked into this component) so the admin panel's
  // preview can render the exact same bar without also emitting analytics
  // for a click that never really reached a visitor.
  onButtonClick?: () => void;
}) {
  const t = useT();
  const preset = ANNOUNCEMENT_COLOR_PRESETS[announcement.color];

  function handleButtonClick() {
    onButtonClick?.();
    if (announcement.buttonAction === "reload") {
      window.location.reload();
      return;
    }
    if (!announcement.buttonUrl) return;
    if (announcement.buttonAction === "open-new-tab") {
      window.open(announcement.buttonUrl, "_blank", "noopener,noreferrer");
    } else {
      window.location.href = announcement.buttonUrl;
    }
  }

  return (
    <div
      className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium"
      style={{ backgroundColor: preset.bg, color: preset.text }}
    >
      <p className="min-w-0 flex-1 break-words">{announcement.text}</p>
      {(announcement.hasButton || (announcement.dismissible && onDismiss)) && (
        <div className="flex shrink-0 items-center gap-3">
          {announcement.hasButton && (
            <button
              type="button"
              onClick={handleButtonClick}
              className="rounded-md border px-3 py-1.5 text-xs font-semibold transition hover:opacity-80"
              style={{ borderColor: preset.text, color: preset.text }}
            >
              {announcement.buttonLabel}
            </button>
          )}
          {announcement.dismissible && onDismiss && (
            <Tooltip content={t("common.closeNotice")}>
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("common.closeNotice")}
                className="text-lg leading-none opacity-80 transition hover:opacity-100"
                style={{ color: preset.text }}
              >
                ×
              </button>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}
