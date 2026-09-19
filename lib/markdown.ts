// Chat markdown — Discord's flavour, parsed into a small tree that
// components/Markdown.tsx draws. Pure, so it is tested without a browser (see
// markdown.test.mts).
//
// Blocks:  ```lang code```, "> quote", ">>> quote to the end", "# / ## / ###"
//          headings, "-# subtext", "- item" / "1. item" lists.
// Inline:  **bold**, *italic* and _italic_, __underline__, ~~strike~~,
//          ||spoiler||, `code`, [label](https://link), and backslash escapes.
//          With `{ images: true }` (never in chat — see MarkdownOptions), also
//          ![alt](https://image).
//
// The text between the formatting is left exactly as written and handed back
// to the caller to draw (see Markdown.tsx's renderText) — which is where each
// chat's own mentions, room links and URLs are made clickable. Two rules keep
// the two from stepping on each other:
//
//   - URLs, the <@id> / <#id> tokens and custom emoji are "protected": nothing inside them
//     is ever read as formatting, so a link with underscores in it stays one
//     link and a token stays whole for the caller to find.
//   - An underscore only opens or closes italics at a word boundary, as on
//     Discord, so "@joao_silva" and "snake_case" stay as typed.

export type InlineNode =
  | { type: "text"; value: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "spoiler"; children: InlineNode[] }
  | { type: "code"; value: string }
  | { type: "link"; url: string; children: InlineNode[] }
  | { type: "image"; url: string; alt: string };

export type MarkdownOptions = {
  /** Reads ![alt](https://url) as an image. Off by default: chat has its own
   *  image uploads, and a message must not be able to embed arbitrary remote
   *  images. On for admin-written copy, like a partner ad's long description. */
  images?: boolean;
};

export type BlockNode =
  /** A run of ordinary lines; the newlines between them are kept in the text. */
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: 1 | 2 | 3; children: InlineNode[] }
  | { type: "subtext"; children: InlineNode[] }
  | { type: "quote"; children: BlockNode[] }
  | { type: "list"; ordered: boolean; start: number; items: InlineNode[][] }
  | { type: "codeBlock"; lang: string | null; value: string };

// ─── Blocks ───────────────────────────────────────────────────────────────

// ``` then an optional language — one word, and only when a newline follows it,
// which is what tells "```js\ncode```" from "```code```" — then anything up to
// the next ```.
const FENCE = /```(?:([A-Za-z0-9_+#.-]{1,20})\n)?([\s\S]*?)```/g;

export function parseMarkdown(text: string, options: MarkdownOptions = {}): BlockNode[] {
  const blocks: BlockNode[] = [];
  let last = 0;
  for (const match of text.matchAll(FENCE)) {
    const start = match.index ?? 0;
    const body = match[2];
    // An empty fence ("``````") is not a code block — it is six backticks.
    if (!body.trim()) continue;
    blocks.push(...parseLines(text.slice(last, start).replace(/\n$/, ""), true, options));
    blocks.push({ type: "codeBlock", lang: match[1]?.toLowerCase() ?? null, value: body.replace(/^\n/, "").replace(/\n$/, "") });
    last = start + match[0].length;
  }
  blocks.push(...parseLines(text.slice(last).replace(/^\n/, ""), true, options));
  return blocks;
}

const HEADING = /^(#{1,3}) (.+)$/;
const SUBTEXT = /^-# (.+)$/;
const QUOTE = /^> ?(.*)$/;
const LIST_ITEM = /^\s*(?:([-*])|(\d{1,9})\.) (.+)$/;

/** The lines of text between code fences. `quotesAllowed` is false inside a quote — quotes do not nest. */
function parseLines(text: string, quotesAllowed: boolean, options: MarkdownOptions): BlockNode[] {
  if (!text) return [];
  const lines = text.split("\n");
  const blocks: BlockNode[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join("\n"), options) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // ">>> " quotes everything from here to the end of the message.
    if (quotesAllowed && (line === ">>>" || line.startsWith(">>> "))) {
      flush();
      const rest = [line.slice(4), ...lines.slice(i + 1)].join("\n");
      blocks.push({ type: "quote", children: parseLines(rest, false, options) });
      return blocks;
    }

    if (quotesAllowed && QUOTE.test(line)) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]) && !lines[i].startsWith(">>>")) {
        quoted.push(lines[i].replace(QUOTE, "$1"));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: "quote", children: parseLines(quoted.join("\n"), false, options) });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ type: "heading", level: heading[1].length as 1 | 2 | 3, children: parseInline(heading[2], options) });
      continue;
    }

    const subtext = SUBTEXT.exec(line);
    if (subtext) {
      flush();
      blocks.push({ type: "subtext", children: parseInline(subtext[1], options) });
      continue;
    }

    const item = LIST_ITEM.exec(line);
    if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const start = ordered ? Number(item[2]) : 1;
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const next = LIST_ITEM.exec(lines[i]);
        if (!next || Boolean(next[2]) !== ordered) break;
        items.push(parseInline(next[3], options));
        i += 1;
      }
      i -= 1;
      blocks.push({ type: "list", ordered, start, items });
      continue;
    }

    paragraph.push(line);
  }
  flush();
  return blocks;
}

// ─── Inline ───────────────────────────────────────────────────────────────

const ESCAPABLE = new Set(["\\", "*", "_", "~", "`", "|", ">", "#", "-", "[", "]", "(", ")"]);

// What is never formatting: links (as the chats linkify them), the mention
// and room tokens (see messageTokens) and custom emoji (see customEmoji) —
// whose names are full of underscores that must not turn into italics.
const PROTECTED = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?*_~|]|<[@#][^>\s]+>|<a?:[A-Za-z0-9_]{2,32}:[A-Za-z0-9]{8,32}>/g;

const MASKED_LINK = /^\[([^\]\n]{1,256})\]\((https?:\/\/[^\s)]+)\)/;
const IMAGE = /^!\[([^\]\n]{0,256})\]\((https?:\/\/[^\s)]+)\)/;

type Delimiter = { mark: string; type: "bold" | "italic" | "underline" | "strike" | "spoiler" };

// Longest first, so "**" is tried before "*" and "__" before "_".
const DELIMITERS: Delimiter[] = [
  { mark: "**", type: "bold" },
  { mark: "__", type: "underline" },
  { mark: "~~", type: "strike" },
  { mark: "||", type: "spoiler" },
  { mark: "*", type: "italic" },
  { mark: "_", type: "italic" },
];

const WORD = /[\p{L}\p{N}]/u;

function protectedSpans(text: string): Map<number, number> {
  const spans = new Map<number, number>();
  for (const match of text.matchAll(PROTECTED)) {
    const start = match.index ?? 0;
    spans.set(start, start + match[0].length);
  }
  return spans;
}

function insideProtected(spans: Map<number, number>, index: number): boolean {
  for (const [start, end] of spans) if (index >= start && index < end) return true;
  return false;
}

/**
 * Where `mark` closes, searching from `from` — or -1. Skips escaped marks and
 * ones inside a link or token. A run of the same character counts as one
 * mark: "**" closes at the last pair of "***" (so "***x***" is bold around
 * italic), and a single "*" never closes on a "**".
 */
function findCloser(text: string, from: number, mark: string, spans: Map<number, number>): number {
  const ch = mark[0];
  let k = text.indexOf(mark, from);
  while (k !== -1) {
    if (text[k - 1] === "\\" || insideProtected(spans, k)) {
      k = text.indexOf(mark, k + 1);
      continue;
    }
    if (mark.length === 1 && (text[k + 1] === ch || (k > from && text[k - 1] === ch))) {
      let end = k;
      while (text[end] === ch) end += 1;
      k = text.indexOf(mark, end);
      continue;
    }
    if (mark.length === 2) {
      while (text[k + 2] === ch) k += 1;
    }
    return k;
  }
  return -1;
}

function opens(text: string, i: number, d: Delimiter, close: number): boolean {
  const inner = text.slice(i + d.mark.length, close);
  if (!inner) return false;
  if (d.mark.length === 1) {
    // *x* and _x_ want something right against both marks, as on Discord.
    if (/\s/.test(inner[0]) || /\s/.test(inner[inner.length - 1])) return false;
  }
  if (d.mark === "_") {
    // Only at a word boundary: "snake_case" and "@joao_silva" stay as typed.
    if (i > 0 && WORD.test(text[i - 1])) return false;
    const after = text[close + 1];
    if (after && WORD.test(after)) return false;
  }
  return true;
}

export function parseInline(text: string, options: MarkdownOptions = {}): InlineNode[] {
  const out: InlineNode[] = [];
  const spans = protectedSpans(text);
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ type: "text", value: buffer });
    buffer = "";
  };

  let i = 0;
  while (i < text.length) {
    const protectedEnd = spans.get(i);
    if (protectedEnd !== undefined) {
      buffer += text.slice(i, protectedEnd);
      i = protectedEnd;
      continue;
    }

    const ch = text[i];

    if (ch === "\\" && i + 1 < text.length && ESCAPABLE.has(text[i + 1])) {
      buffer += text[i + 1];
      i += 2;
      continue;
    }

    if (ch === "`") {
      let run = i;
      while (text[run] === "`") run += 1;
      const ticks = text.slice(i, run);
      // Three or more left over here were not a code block (parseMarkdown
      // takes those) — they are just backticks.
      if (ticks.length > 2) {
        buffer += ticks;
        i = run;
        continue;
      }
      const end = text.indexOf(ticks, run);
      if (end !== -1 && text.slice(run, end).trim()) {
        flush();
        out.push({ type: "code", value: text.slice(run, end) });
        i = end + ticks.length;
        continue;
      }
      buffer += ticks;
      i = run;
      continue;
    }

    if (ch === "!" && options.images && text[i + 1] === "[") {
      const image = IMAGE.exec(text.slice(i));
      if (image) {
        flush();
        out.push({ type: "image", url: image[2], alt: image[1] });
        i += image[0].length;
        continue;
      }
    }

    if (ch === "[") {
      const link = MASKED_LINK.exec(text.slice(i));
      if (link) {
        flush();
        out.push({ type: "link", url: link[2], children: parseInline(link[1], options) });
        i += link[0].length;
        continue;
      }
    }

    let matched = false;
    for (const d of DELIMITERS) {
      if (!text.startsWith(d.mark, i)) continue;
      const close = findCloser(text, i + d.mark.length, d.mark, spans);
      if (close === -1 || !opens(text, i, d, close)) continue;
      flush();
      out.push({ type: d.type, children: parseInline(text.slice(i + d.mark.length, close), options) });
      i = close + d.mark.length;
      matched = true;
      break;
    }
    if (matched) continue;

    buffer += ch;
    i += 1;
  }
  flush();
  return out;
}

/**
 * The text with its formatting marks taken off — for places that show a
 * message as one line of plain text (a reply's quote, a notification).
 */
export function stripMarkdown(text: string): string {
  const inline = (nodes: InlineNode[]): string =>
    nodes
      .map((node) =>
        node.type === "text" || node.type === "code"
          ? node.value
          : node.type === "image"
            ? node.alt
            : node.type === "spoiler"
            ? "▒▒▒"
            : inline(node.children)
      )
      .join("");
  const block = (nodes: BlockNode[]): string =>
    nodes
      .map((node) => {
        switch (node.type) {
          case "codeBlock":
            return node.value;
          case "quote":
            return block(node.children);
          case "list":
            return node.items.map(inline).join("\n");
          default:
            return inline(node.children);
        }
      })
      .join("\n");
  return block(parseMarkdown(text));
}
