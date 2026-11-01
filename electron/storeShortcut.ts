// Desktop shortcut for the Microsoft Store (MSIX) install.
//
// The NSIS installer creates one (createDesktopShortcut in
// electron-builder.yml); the Store installs nothing but the Start menu entry.
// So the Store build makes its own, on the very first run only — the same
// "and never again" as applyFirstRunDefaults: someone who deletes it has
// answered, and putting it back every launch would be refusing that answer.
//
// The shortcut cannot point at process.execPath. A packaged app lives in
// C:\Program Files\WindowsApps\<name>_<version>_<arch>__<publisherId>\, and
// that folder is renamed on every Store update — a shortcut to it dies with
// the first update. It points instead at the package's stable entry,
// shell:AppsFolder\<PackageFamilyName>!<applicationId>, through explorer.exe.
//
// The icon has the same problem (an .ico inside the versioned folder dies
// too), so it is copied to the package's LocalState folder, which survives
// updates and is removed together with the package.

import { app, shell } from "electron";
import path from "node:path";
import fs from "node:fs";

// Must match appx.applicationId in electron-builder.yml.
const APPLICATION_ID = "GoLive";

// Spelled out rather than app.getName(), which answers "sharescreen": there is
// no productName in package.json, and adding one would move userData and log
// everyone out.
const SHORTCUT_FILE = "Go Live.lnk";
// What the builds up to 1.0.28 called it, by way of app.getName().
const LEGACY_SHORTCUT_FILE = "sharescreen.lnk";

/**
 * <name>_<publisherId>, read off the install folder's name
 * (<name>_<version>_<arch>_<resourceId>_<publisherId>). Null when the
 * executable is not where a Store package would put it.
 */
function packageFamilyName(): string | null {
  const parts = process.execPath.split(path.sep);
  const at = parts.findIndex((p) => p.toLowerCase() === "windowsapps");
  const folder = at >= 0 ? parts[at + 1] : undefined;
  if (!folder) return null;
  const fields = folder.split("_");
  if (fields.length < 5) return null;
  const name = fields[0];
  const publisherId = fields[fields.length - 1];
  return name && publisherId ? `${name}_${publisherId}` : null;
}

/**
 * Corrects the name on a shortcut an older build already made. Only one that
 * opens this package: a "sharescreen.lnk" pointing anywhere else is not ours.
 * Runs past the marker on purpose, since those installs have one already; a
 * shortcut they deleted or renamed is simply not found.
 */
function renameLegacyShortcut(shortcut: string, family: string): void {
  const legacy = path.join(path.dirname(shortcut), LEGACY_SHORTCUT_FILE);
  try {
    if (!fs.existsSync(legacy) || fs.existsSync(shortcut)) return;
    if (!shell.readShortcutLink(legacy).args?.includes(family)) return;
    fs.renameSync(legacy, shortcut);
  } catch {
    // Keeps its old name and is retried next launch.
  }
}

export function createStoreDesktopShortcutOnce(): void {
  if (process.platform !== "win32" || !process.windowsStore) return;

  const family = packageFamilyName();
  if (!family) return;
  const shortcut = path.join(app.getPath("desktop"), SHORTCUT_FILE);
  renameLegacyShortcut(shortcut, family);

  const marker = path.join(app.getPath("userData"), "store-shortcut-initialized");
  if (fs.existsSync(marker)) return;

  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return;

  try {
    // The NSIS installer's shortcut has this same name, and "create" would
    // overwrite it with one that opens a different copy of the app.
    if (fs.existsSync(shortcut)) {
      fs.writeFileSync(marker, String(Date.now()));
      return;
    }

    let icon: string | undefined;
    try {
      const dir = path.join(localAppData, "Packages", family, "LocalState");
      fs.mkdirSync(dir, { recursive: true });
      icon = path.join(dir, "shortcut.ico");
      fs.copyFileSync(path.join(process.resourcesPath, "icon.ico"), icon);
    } catch {
      // A shortcut with explorer's icon still opens the app; not worth
      // giving up the shortcut over.
      icon = undefined;
    }

    const windir = process.env.SystemRoot || "C:\\Windows";
    const created = shell.writeShortcutLink(shortcut, "create", {
      target: path.join(windir, "explorer.exe"),
      args: `shell:AppsFolder\\${family}!${APPLICATION_ID}`,
      ...(icon ? { icon, iconIndex: 0 } : {}),
    });
    // Only marked once it exists, so a failure is retried next launch.
    if (created) fs.writeFileSync(marker, String(Date.now()));
  } catch {
    // Retried next launch; nothing for the user to act on.
  }
}
