// Experiment "connecting-peer-tile": a tile for a transmission that is on but
// has not reached this viewer — instead of no tile at all.
//
// A viewer's tile only exists while there is a stream behind it. When the
// connection to a broadcaster fails, the viewer closes its side (see
// useRoomMedia's recoverRecvPC) and waits for the broadcaster's retry, which
// is backed off — seconds at first, up to a minute later. In that gap the tile
// is simply gone, and with nobody else sharing the room says "Ninguém está
// transmitindo ainda" while the broadcaster's row in the list says AO VIVO
// (ticket 1421: "depois de muito tempo carregando ele mostra que não há
// ninguém transmitindo, mesmo que mostre no perfil dela AO VIVO").
//
// The room's peer list is the authority for "is this on" (the same one the
// stopped/resuming placeholders already trust, see WatchRoom's
// announcesScreen), so a peer who announces a channel with no stream here gets
// a "Conectando…" tile. After a while it says why that usually happens and
// offers "Tentar de novo" — a "resume", which has the broadcaster rebuild its
// side at once instead of waiting out the backoff.

export const CONNECTING_TILE_FEATURE = "connecting-peer-tile";

export const CONNECTING_TILE_EVENTS = {
  /** The tile sat there long enough to show the explanation and the button. */
  slow: "connecting_tile_slow",
  /** "Tentar de novo" pressed. */
  retry: "connecting_tile_retry",
} as const;

/** How long "Conectando…" is shown alone before the explanation and the button join it. */
export const CONNECTING_TILE_SLOW_MS = 20_000;
