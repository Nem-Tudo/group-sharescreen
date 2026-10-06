// The room's document (see components/roomTools/DocView): its text is HTML,
// shared like the notepad's (lib/textSync.ts). Anybody in the room can send
// anything as that HTML, so every client cleans it before it touches the
// page: only the tags and attributes a document needs, no scripts, no event
// handlers, no styles beyond alignment and color, links only to http(s).

const ALLOWED_TAGS = new Set([
  "P",
  "DIV",
  "BR",
  "H1",
  "H2",
  "H3",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "A",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TD",
  "TH",
  "SPAN",
  "FONT",
  "HR",
  "SUB",
  "SUP",
  "CODE",
  "PRE",
]);

// Dropped with everything in them, rather than unwrapped.
const DROPPED_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "TEMPLATE", "NOSCRIPT", "SVG", "MATH", "LINK", "META", "TITLE", "HEAD"]);

const SAFE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i;

function cleanStyle(style: CSSStyleDeclaration): string {
  const out: string[] = [];
  const align = style.textAlign;
  if (align === "left" || align === "center" || align === "right" || align === "justify") out.push(`text-align: ${align}`);
  if (style.color && SAFE_COLOR.test(style.color)) out.push(`color: ${style.color}`);
  if (style.backgroundColor && SAFE_COLOR.test(style.backgroundColor)) out.push(`background-color: ${style.backgroundColor}`);
  if (style.fontWeight === "bold" || style.fontWeight === "700") out.push("font-weight: bold");
  if (style.fontStyle === "italic") out.push("font-style: italic");
  if (/underline|line-through/.test(style.textDecoration)) out.push(`text-decoration: ${style.textDecoration.match(/underline|line-through/)![0]}`);
  return out.join("; ");
}

function cleanNode(node: Node, doc: Document): Node[] {
  if (node.nodeType === Node.TEXT_NODE) return [doc.createTextNode(node.textContent ?? "")];
  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as HTMLElement;
  const tag = el.tagName.toUpperCase();
  if (DROPPED_TAGS.has(tag)) return [];
  const children = [...el.childNodes].flatMap((child) => cleanNode(child, doc));
  // Anything else is unwrapped: its text stays, the tag goes.
  if (!ALLOWED_TAGS.has(tag)) return children;
  const out = doc.createElement(tag === "FONT" ? "span" : tag.toLowerCase());
  const style = cleanStyle(el.style);
  if (tag === "FONT") {
    const color = el.getAttribute("color");
    const fontStyle = [style, color && SAFE_COLOR.test(color) ? `color: ${color}` : ""].filter(Boolean).join("; ");
    if (fontStyle) out.setAttribute("style", fontStyle);
  } else if (style) {
    out.setAttribute("style", style);
  }
  if (tag === "A") {
    const href = el.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      out.setAttribute("href", href);
      out.setAttribute("target", "_blank");
      out.setAttribute("rel", "noopener noreferrer nofollow");
    }
  }
  if (tag === "TD" || tag === "TH") {
    for (const attr of ["colspan", "rowspan"]) {
      const value = Number(el.getAttribute(attr));
      if (Number.isInteger(value) && value > 1 && value <= 50) out.setAttribute(attr, String(value));
    }
  }
  for (const child of children) out.appendChild(child);
  return [out];
}

/** `html` with only what a document may hold. In the browser only. */
export function sanitizeDocHtml(html: string): string {
  if (typeof DOMParser === "undefined" || !html) return "";
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const out = document.implementation.createHTMLDocument("");
  const container = out.createElement("div");
  for (const child of [...parsed.body.childNodes]) for (const node of cleanNode(child, out)) container.appendChild(node);
  return container.innerHTML;
}

/** The document's text, without its markup — for the picture-in-picture and the like. */
export function docPlainText(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return parsed.body.innerText ?? parsed.body.textContent ?? "";
}

/**
 * As a Word file: HTML in Word's own namespace, which Word opens as a
 * document with its formatting.
 */
export function docToWord(html: string, title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, "");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${safeTitle}</title><style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px}</style></head><body>${sanitizeDocHtml(html)}</body></html>`;
}
