"use client";

// Copying text to the clipboard, in a way that also works inside the Electron
// shell.
//
// `navigator.clipboard.writeText` is the only API worth using in a browser,
// but in the desktop build it goes through Chromium's permission layer under
// the name `clipboard-sanitized-write`, and Electron routes that at the
// *main* process's permission handlers rather than granting it on the user
// gesture the way a browser does. electron/main.ts allows it now, but every
// already-installed build still denies it — and the UI those builds load is
// this deployed site, so they pick up this file without updating. Hence the
// fallback: it is what makes "Compartilhar sala" work on the copies of the
// app that are out there today.
//
// The fallback is the old `document.execCommand("copy")` dance. It is
// deprecated and does nothing on a page without a user gesture, which is
// exactly the shape of every caller here (a click handler), and it does not
// consult the Permissions API at all — which is the whole reason it survives
// where the modern path does not.

function copyViaExecCommand(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  // Off-screen rather than `display: none`/`hidden`: the selection APIs
  // ignore an element that isn't rendered, so it has to be laid out — just
  // nowhere anybody can see it, and never focusable by tabbing to it.
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-9999px";
  area.style.opacity = "0";
  area.style.pointerEvents = "none";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}

/** Copies `text`, returning whether it actually made it to the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    // Guarded rather than called straight: `navigator.clipboard` is undefined
    // altogether outside a secure context, so this would throw a TypeError
    // before any promise exists to reject.
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission denied, document not focused, or an origin the browser
    // refuses to grant — fall through to the legacy path below rather than
    // giving up, since it answers to none of those.
  }
  return copyViaExecCommand(text);
}

/**
 * Copies the picture itself (not its address), as a PNG — the one image type
 * every browser's clipboard accepts. A GIF goes as its first frame.
 *
 * The bytes are fetched again rather than read off the <img>: drawing a
 * cross-origin <img> on a canvas taints it, while a CORS fetch of the same
 * address does not (our uploads and the CDN answer with CORS). Returns false
 * when the browser refuses or the host has no CORS, so the caller can fall
 * back to the link.
 */
export async function copyImage(src: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
    // The promise goes into the ClipboardItem as is, not awaited first:
    // Safari only allows the write inside the click, and the fetch would
    // outlive it.
    await navigator.clipboard.write([new ClipboardItem({ "image/png": imageAsPng(src) })]);
    return true;
  } catch {
    return false;
  }
}

async function imageAsPng(src: string): Promise<Blob> {
  const response = await fetch(src, { mode: "cors", credentials: "omit" });
  if (!response.ok) throw new Error(`image ${response.status}`);
  const blob = await response.blob();
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((png) => (png ? resolve(png) : reject(new Error("toBlob"))), "image/png")
  );
}

/** "Copiar imagem" for a context menu: the picture, or its address when the browser will not take the picture. */
export async function copyImageOrLink(src: string): Promise<void> {
  if (await copyImage(src)) return;
  if (!src.startsWith("data:")) await copyText(src);
}
