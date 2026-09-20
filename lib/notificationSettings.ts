// The notification-settings experiment, in one place.
//
// The screen itself (app/me/notifications) is a new feature, so it goes out
// behind a feature flag created in the admin panel rather than to everybody at
// once — see CLAUDE.md. Only the *screen* is behind it: the fixes it was built
// alongside (the mute that now also stops pushes, the sign-out that now takes
// this device off the list) are corrections and are live for everybody.
//
// Keys and event names live here rather than being typed at each call site,
// because an event whose name is not exactly one of the feature's "site
// events" in the admin panel is an event that is silently dropped.

/** The feature's key in the admin panel. Target: user. */
export const NOTIFICATION_SETTINGS_FEATURE = "notification-settings";

/** The id the blue "NOVO" badge is tracked by — the feature's key. */
export const NOTIFICATION_SETTINGS_BADGE = NOTIFICATION_SETTINGS_FEATURE;

/**
 * Every event the screen reports. Each has to be registered as a "site event"
 * on the feature in the admin panel or it will not be counted.
 */
export const NOTIFICATION_SETTINGS_EVENTS = {
  /** Somebody opened the screen. */
  open: "notif_settings_open",
  /** The "does the whole chain work" probe was pressed. */
  test: "notif_test_push",
  /** A device was turned off from the list. */
  deviceRemoved: "notif_device_removed",
  /** A kind of notification was switched on or off. */
  kindMuted: "notif_kind_toggled",
  /** The quiet window was turned on or off. */
  quietHours: "notif_quiet_hours",
  /** One conversation was silenced or un-silenced from its own header. */
  dmMuted: "notif_dm_muted",
} as const;
