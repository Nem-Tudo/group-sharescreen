"use client";

// Commands for one tile from outside it — today the clip/record keyboard
// shortcuts (see keyboardShortcuts' clipTile/toggleRecordTile). The clip
// buffer and the recorder live inside VideoTile, so the room cannot call them
// directly: it names the tile (its RoomTile id) and the tile, which registered
// under that id, does the rest.

export type TileCommand = "clip" | "toggleRecord";

const handlers = new Map<string, (command: TileCommand) => void>();

/** Called by a tile; returns the unregister. Last one to register wins. */
export function registerTileCommands(tileId: string, handler: (command: TileCommand) => void): () => void {
  handlers.set(tileId, handler);
  return () => {
    if (handlers.get(tileId) === handler) handlers.delete(tileId);
  };
}

/** Whether a tile took the command (false: no such tile on screen). */
export function sendTileCommand(tileId: string, command: TileCommand): boolean {
  const handler = handlers.get(tileId);
  if (!handler) return false;
  handler(command);
  return true;
}
