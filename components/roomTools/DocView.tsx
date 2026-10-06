"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  MdFileDownload,
  MdFormatAlignCenter,
  MdFormatAlignLeft,
  MdFormatAlignRight,
  MdFormatBold,
  MdFormatClear,
  MdFormatColorText,
  MdFormatItalic,
  MdFormatListBulleted,
  MdFormatListNumbered,
  MdFormatQuote,
  MdFormatStrikethrough,
  MdFormatUnderlined,
  MdHorizontalRule,
  MdLink,
  MdPrint,
  MdRedo,
  MdTableChart,
  MdUndo,
} from "react-icons/md";
import { docToWord, sanitizeDocHtml } from "@/lib/docHtml";
import { ROOM_TOOLS_EVENTS, roomTools, trackRoomToolsEvent, type TextTool } from "@/lib/roomTools";
import { useT } from "@/lib/useI18n";

// The room's document: a page everybody with access writes on at once —
// headings, bold and the rest, lists, links, tables. Its text is the page's
// HTML, shared exactly like the notepad's (lib/textSync.ts), and cleaned on
// the way in on every screen (lib/docHtml.ts): nobody's HTML reaches anybody
// else's page as sent.

const TEXT_COLORS = ["#000000", "#dc2626", "#16a34a", "#2563eb", "#9333ea", "#ea580c", "#71717a"];

// How a document looks: Tailwind's reset takes the look off headings and
// lists, so it is put back here, for the editor and for printing alike.
export const DOC_CONTENT_CLASS =
  "[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-2xl [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-xl [&_h3]:font-semibold [&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-7 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-7 [&_blockquote]:my-2 [&_blockquote]:border-l-4 [&_blockquote]:border-zinc-300 [&_blockquote]:pl-3 [&_blockquote]:text-zinc-600 dark:[&_blockquote]:border-zinc-600 dark:[&_blockquote]:text-zinc-400 [&_a]:text-blue-600 [&_a]:underline dark:[&_a]:text-sky-400 [&_table]:my-2 [&_table]:border-collapse [&_td]:min-w-16 [&_td]:border [&_td]:border-zinc-400 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-zinc-400 [&_th]:bg-zinc-100 [&_th]:px-2 [&_th]:py-1 dark:[&_th]:bg-zinc-800 [&_hr]:my-3 [&_hr]:border-zinc-300 [&_pre]:rounded [&_pre]:bg-zinc-100 [&_pre]:p-2 [&_pre]:font-mono dark:[&_pre]:bg-zinc-800";

const PRINT_STYLE =
  "body{font-family:Calibri,Arial,sans-serif;font-size:11pt;max-width:780px;margin:24px auto;color:#111}h1{font-size:24pt}h2{font-size:18pt}h3{font-size:14pt}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}blockquote{border-left:4px solid #ccc;margin-left:0;padding-left:12px;color:#555}";

const button =
  "flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-zinc-800";

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Where the caret is, as characters of text from the start of `root` — what survives a rewrite of its HTML. */
function textOffsets(root: HTMLElement): [number, number] | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const measure = (node: Node, offset: number) => {
    const before = root.ownerDocument.createRange();
    before.selectNodeContents(root);
    before.setEnd(node, offset);
    return before.toString().length;
  };
  return [measure(range.startContainer, range.startOffset), measure(range.endContainer, range.endOffset)];
}

function placeCaret(root: HTMLElement, [start, end]: [number, number]) {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = doc.createRange();
  let seen = 0;
  let startSet = false;
  let node = walker.nextNode();
  while (node) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && seen + length >= start) {
      range.setStart(node, start - seen);
      startSet = true;
    }
    if (startSet && seen + length >= end) {
      range.setEnd(node, end - seen);
      break;
    }
    seen += length;
    node = walker.nextNode();
  }
  if (!startSet) {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  const selection = doc.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function DocView({ tool, canUse }: { tool: TextTool; canUse: boolean }) {
  const t = useT();
  const editorRef = useRef<HTMLDivElement>(null);
  // The HTML this editor last had from the room or sent to it: anything else
  // arriving is somebody else's edit, and goes on the page.
  const shownRef = useRef<string | null>(null);
  const [colorsOpen, setColorsOpen] = useState(false);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor || tool.text === shownRef.current) return;
    const focused = editor.ownerDocument.activeElement === editor;
    const caret = focused ? textOffsets(editor) : null;
    editor.innerHTML = sanitizeDocHtml(tool.text);
    shownRef.current = tool.text;
    if (caret) placeCaret(editor, caret);
  }, [tool.text]);

  // Paragraphs rather than bare <div>s for every new line.
  useEffect(() => {
    try {
      editorRef.current?.ownerDocument.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Older browsers: <div> it is.
    }
  }, []);

  function sync() {
    const editor = editorRef.current;
    if (!editor || !canUse) return;
    const html = editor.innerHTML;
    if (html === shownRef.current) return;
    shownRef.current = html;
    roomTools.editText(tool.id, html);
  }

  function exec(command: string, value?: string) {
    const editor = editorRef.current;
    if (!editor || !canUse) return;
    editor.focus();
    editor.ownerDocument.execCommand(command, false, value);
    sync();
  }

  function onPaste(e: React.ClipboardEvent) {
    if (!canUse) return;
    // What comes from another page or from Word is cleaned like everything
    // else — before it is on this page at all.
    const html = e.clipboardData.getData("text/html");
    e.preventDefault();
    if (html) exec("insertHTML", sanitizeDocHtml(html));
    else exec("insertText", e.clipboardData.getData("text/plain"));
  }

  function insertLink() {
    const url = window.prompt(t("roomTools.doc.linkPrompt"), "https://");
    if (url && /^https?:\/\//i.test(url)) exec("createLink", url);
  }

  function insertTable() {
    const row = `<tr>${"<td><br></td>".repeat(3)}</tr>`;
    exec("insertHTML", `<table><tbody>${row.repeat(3)}</tbody></table><p><br></p>`);
  }

  function exportWord() {
    const name = tool.title || "documento";
    download(`${name}.doc`, new Blob([docToWord(tool.text, name)], { type: "application/msword" }));
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.export);
    trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.export}.doc`);
  }

  // Printing — and "Salvar como PDF" in the print dialog — from a page of its own.
  function print() {
    const win = window.open("", "_blank", "width=900,height=700");
    if (!win) return;
    const title = (tool.title || "Documento").replace(/[<>&"]/g, "");
    win.document.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${PRINT_STYLE}</style></head><body>${sanitizeDocHtml(tool.text)}</body></html>`
    );
    win.document.close();
    win.focus();
    win.print();
    trackRoomToolsEvent(ROOM_TOOLS_EVENTS.export);
    trackRoomToolsEvent(`${ROOM_TOOLS_EVENTS.export}.doc_pdf`);
  }

  const blocks: [string, string][] = [
    ["p", t("roomTools.doc.paragraph")],
    ["h1", t("roomTools.doc.heading1")],
    ["h2", t("roomTools.doc.heading2")],
    ["h3", t("roomTools.doc.heading3")],
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex shrink-0 flex-wrap items-center gap-0.5">
        {canUse && (
          <>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) exec("formatBlock", e.target.value);
                e.target.value = "";
              }}
              className="rounded-md border border-zinc-300 bg-white px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              aria-label={t("roomTools.doc.style")}
            >
              <option value="" disabled>
                {t("roomTools.doc.style")}
              </option>
              {blocks.map(([tag, label]) => (
                <option key={tag} value={tag}>
                  {label}
                </option>
              ))}
            </select>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("bold")} title={t("roomTools.sheet.bold")}>
              <MdFormatBold className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("italic")} title={t("roomTools.sheet.italic")}>
              <MdFormatItalic className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("underline")} title={t("roomTools.doc.underline")}>
              <MdFormatUnderlined className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("strikeThrough")} title={t("roomTools.doc.strike")}>
              <MdFormatStrikethrough className="h-4 w-4" />
            </button>
            <span className="relative">
              <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => setColorsOpen((v) => !v)} title={t("roomTools.sheet.textColor")}>
                <MdFormatColorText className="h-4 w-4" />
              </button>
              {colorsOpen && (
                <span className="absolute left-0 top-full z-30 mt-1 flex gap-1 rounded-lg border border-zinc-200 bg-white p-1.5 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
                  {TEXT_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        exec("foreColor", color);
                        setColorsOpen(false);
                      }}
                      className="h-5 w-5 rounded border border-zinc-300 dark:border-zinc-600"
                      style={{ background: color }}
                      aria-label={color}
                    />
                  ))}
                </span>
              )}
            </span>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertUnorderedList")} title={t("roomTools.doc.bullets")}>
              <MdFormatListBulleted className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertOrderedList")} title={t("roomTools.doc.numbers")}>
              <MdFormatListNumbered className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("formatBlock", "blockquote")} title={t("roomTools.doc.quote")}>
              <MdFormatQuote className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyLeft")} title={t("roomTools.sheet.alignLeft")}>
              <MdFormatAlignLeft className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyCenter")} title={t("roomTools.sheet.alignCenter")}>
              <MdFormatAlignCenter className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("justifyRight")} title={t("roomTools.sheet.alignRight")}>
              <MdFormatAlignRight className="h-4 w-4" />
            </button>
            <span className="mx-1 h-5 w-px bg-zinc-300 dark:bg-zinc-700" />
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={insertLink} title={t("roomTools.doc.link")}>
              <MdLink className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={insertTable} title={t("roomTools.doc.table")}>
              <MdTableChart className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("insertHorizontalRule")} title={t("roomTools.doc.divider")}>
              <MdHorizontalRule className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("removeFormat")} title={t("roomTools.doc.clearFormat")}>
              <MdFormatClear className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("undo")} title={t("roomTools.undo")}>
              <MdUndo className="h-4 w-4" />
            </button>
            <button type="button" className={button} onMouseDown={(e) => e.preventDefault()} onClick={() => exec("redo")} title={t("roomTools.doc.redo")}>
              <MdRedo className="h-4 w-4" />
            </button>
          </>
        )}
        <span className="ml-auto flex items-center gap-0.5">
          <button type="button" className={button} onClick={exportWord} title={t("roomTools.doc.exportWord")}>
            <MdFileDownload className="h-4 w-4" />
            Word
          </button>
          <button type="button" className={button} onClick={print} title={t("roomTools.doc.print")}>
            <MdPrint className="h-4 w-4" />
            PDF
          </button>
        </span>
      </div>
      {/* The page, on a desk: Word's look, in either theme. */}
      <div className="min-h-0 flex-1 overflow-auto rounded-md bg-zinc-200 p-2 sm:p-4 dark:bg-zinc-800">
        <div
          ref={editorRef}
          contentEditable={canUse}
          suppressContentEditableWarning
          spellCheck
          onInput={sync}
          onBlur={sync}
          onPaste={onPaste}
          onKeyDown={(e) => {
            e.stopPropagation();
            // Tab indents a list item rather than leaving the page.
            if (e.key === "Tab" && canUse) {
              e.preventDefault();
              exec(e.shiftKey ? "outdent" : "indent");
            }
          }}
          data-placeholder={canUse ? t("roomTools.doc.placeholder") : ""}
          className={`mx-auto min-h-full max-w-[816px] rounded-sm bg-white px-6 py-6 text-[15px] leading-relaxed text-zinc-900 shadow outline-none sm:px-12 sm:py-10 dark:bg-zinc-950 dark:text-zinc-100 empty:before:text-zinc-400 empty:before:content-[attr(data-placeholder)] ${DOC_CONTENT_CLASS}`}
        />
      </div>
      {!canUse && <span className="shrink-0 text-xs text-zinc-500">{t("roomTools.viewOnly")}</span>}
    </div>
  );
}
