// What a shared window says about its sharer's taste, for the personalised
// affiliate products (lib/affiliateInterests.ts): the title of the window
// being broadcast, matched against known games and apps, mapped to one of the
// room categories ("gameplay", "musica", ...).
//
// Only ever the window the person chose to broadcast, which the room already
// sees, and never the list of what else is open. The title itself stays where
// it is read: in the desktop app that is the shell's main process (see
// electron/main.ts, which runs this and hands the page nothing but the
// category); in a browser, the page's own track label.
//
// Pure and dependency-free on purpose: the Electron main process bundles it too.

export type ShareInterest =
  | "gameplay"
  | "conversa"
  | "musica"
  | "filmes"
  | "estudos"
  | "trabalho"
  | "esportes"
  | "programacao"
  | "arte";

// Order matters: the first match wins, so the specific comes before the
// general (a sports game is "esportes" before it is any game; YouTube Music
// is music before YouTube is video).
const RULES: [ShareInterest, RegExp][] = [
  // Sports games and sports streams.
  [
    "esportes",
    /\b(ea sports fc|fc ?2[4-9]|fifa ?\d{2}|efootball|pes ?20\d\d|nba ?2k\d*|madden|f1 ?2[0-9]|f1 ?manager|football manager|ge\.globo|espn|premiere fc|nba league pass|dazn|cazé ?tv)\b/i,
  ],
  // Music apps and music sites in a browser title.
  [
    "musica",
    /\b(spotify|deezer|youtube music|apple music|tidal|soundcloud|fl studio|ableton|reaper|audacity|cubase|studio one|garageband|logic pro|pro tools|bandlab|guitar pro|musescore|rekordbox|serato|virtual ?dj)\b/i,
  ],
  // Games, their launchers and emulators.
  [
    "gameplay",
    /\b(valorant|league of legends|counter-strike|cs2|csgo|minecraft|roblox|fortnite|grand theft auto|gta ?(v|iv|5|6|online)|free fire|apex legends|overwatch|dota ?2|rocket league|call of duty|warzone|rainbow six|pubg|genshin impact|honkai|zenless zone zero|wuthering waves|elden ring|cyberpunk 2077|the sims|stardew valley|terraria|among us|lethal company|palworld|fall guys|rust|ark: survival|dead by daylight|brawlhalla|osu!|hollow knight|hades|baldur's gate|diablo|world of warcraft|hearthstone|marvel rivals|deadlock|path of exile|warframe|destiny 2|paladins|phasmophobia|sea of thieves|euro truck simulator|forza|assassin's creed|god of war|red dead redemption|resident evil|hogwarts legacy|pok[eé]mon|the witcher|skyrim|fallout|starfield|helldivers|black myth|monster hunter|tibia|ragnarok|albion online|lost ark|naraka|delta force|the finals|r\.e\.p\.o|schedule i|twitch|steam|epic games|battle\.net|riot client|ea app|ubisoft connect|xbox|bluestacks|ldplayer|memu|nox ?player|yuzu|ryujinx|pcsx2|rpcs3|dolphin|retroarch|cemu|ppsspp|duckstation)\b/i,
  ],
  // Video: streaming services, players, and video sites in a browser title.
  [
    "filmes",
    /\b(netflix|prime video|disney\+|disney plus|hbo max|globoplay|crunchyroll|paramount\+|apple tv|star\+|mubi|pluto tv|vlc|mpc-hc|mpc-be|potplayer|stremio|plex|jellyfin|kodi|youtube)\b/i,
  ],
  // Code.
  [
    "programacao",
    /\b(visual studio|vs ?code|intellij|pycharm|webstorm|phpstorm|rider|clion|goland|android studio|cursor|sublime text|notepad\+\+|neovim|vim|github|gitlab|stack ?overflow|windows terminal|powershell|command prompt|prompt de comando|postman|docker desktop|unity|unreal editor|godot|xcode|eclipse|replit|codepen|leetcode)\b/i,
  ],
  // Drawing, design, 3D, video editing.
  [
    "arte",
    /\b(photoshop|illustrator|krita|clip studio|paint tool sai|aseprite|blender|gimp|inkscape|affinity|medibang|ibis paint|figma|canva|after effects|premiere pro|davinci resolve|capcut|sony vegas|vegas pro|zbrush|substance|maya|3ds max|cinema 4d|procreate|lightroom|paint\.net)\b/i,
  ],
  // Study.
  [
    "estudos",
    /\b(anki|duolingo|khan academy|google classroom|classroom|moodle|coursera|udemy|alura|descomplica|brainly|wolfram|geogebra|kindle|quizlet|chatgpt|notebooklm)\b/i,
  ],
  // Work.
  [
    "trabalho",
    /\b(excel|word|powerpoint|outlook|microsoft teams|teams|slack|zoom|google docs|google sheets|google slides|planilhas google|documentos google|trello|jira|notion|clickup|asana|power bi|libreoffice|onlyoffice|salesforce|hubspot)\b/i,
  ],
  // Chat apps: what sells to them is a microphone or a webcam.
  ["conversa", /\b(discord|whatsapp|telegram|skype|messenger)\b/i],
];

/** The category a shared window's title points at, or null when it says nothing. */
export function classifyShareTitle(title: string | null | undefined): ShareInterest | null {
  if (!title) return null;
  const text = title.trim();
  // Bare source ids ("screen:0:0", "window:1234:0") and whole-screen shares
  // carry no title worth reading.
  if (!text || /^(screen|window|web-contents-media-stream):/i.test(text)) return null;
  for (const [interest, re] of RULES) if (re.test(text)) return interest;
  return null;
}
