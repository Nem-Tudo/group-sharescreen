"use client";

// Draws chat markdown (see lib/markdown.ts). The plain text between the
// formatting goes back to the caller through `renderText`, so each chat keeps
// its own mentions, room links and link rules; without one, links are simply
// made clickable.

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { MdCheck, MdContentCopy } from "react-icons/md";
import { parseInline, parseMarkdown, type BlockNode, type InlineNode } from "@/lib/markdown";
import { highlightCode, type CodeTokenType } from "@/lib/codeHighlight";
import { useT } from "@/lib/useI18n";
import { CustomEmoji } from "@/components/CustomEmoji";
import { isJumboEmojiText, splitEmojiTokens } from "@/lib/customEmoji";

export type RenderText = (text: string, key: string) => ReactNode;

const LINK_SPLIT = /(https?:\/\/[^\s<]+)/g;

/** The default for plain text: its links made clickable. */
export function linkifyPlain(text: string, key: string): ReactNode {
  const parts = text.split(LINK_SPLIT);
  if (parts.length === 1) return text;
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <a
        key={`${key}-${index}`}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all underline underline-offset-2 hover:opacity-80"
      >
        {part}
      </a>
    ) : (
      <Fragment key={`${key}-${index}`}>{part}</Fragment>
    )
  );
}

/**
 * `renderText` with custom emoji (see lib/customEmoji) drawn first: the plain
 * runs between them go on to the caller as before, so no chat has to know
 * they exist. `jumbo` for a message that is nothing but emoji.
 */
function withCustomEmoji(renderText: RenderText, jumbo: boolean): RenderText {
  return (text, key) => {
    const segments = splitEmojiTokens(text);
    if (segments.length === 1 && segments[0].type === "text") return renderText(text, key);
    return segments.map((segment, index) =>
      segment.type === "emoji" ? (
        <CustomEmoji
          key={`${key}-e${index}`}
          id={segment.emoji.id}
          name={segment.emoji.name}
          size={jumbo ? 48 : 22}
          className="mx-px"
        />
      ) : (
        <Fragment key={`${key}-e${index}`}>{renderText(segment.value, `${key}-e${index}`)}</Fragment>
      )
    );
  };
}

/** A [label](url) turned into its label, all the way down. */
function withoutLinks(nodes: InlineNode[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (node.type === "link") return withoutLinks(node.children);
    if ("children" in node) return [{ ...node, children: withoutLinks(node.children) }];
    return [node];
  });
}

/**
 * One line of inline formatting — bold, italics, code, spoilers — and no
 * blocks: a heading or a list marker in it stays as typed. For titles. With
 * `insideLink`, a [label](url) in it is drawn as its label, since the whole
 * line is already a link and one link cannot hold another.
 */
export function InlineMarkdown({
  text,
  renderText = linkifyPlain,
  insideLink = false,
}: {
  text: string;
  renderText?: RenderText;
  insideLink?: boolean;
}) {
  const nodes = useMemo(() => {
    const parsed = parseInline(text);
    return insideLink ? withoutLinks(parsed) : parsed;
  }, [text, insideLink]);
  const render = useMemo(() => withCustomEmoji(renderText, false), [renderText]);
  return <Inline nodes={nodes} path="t" renderText={render} />;
}

interface MarkdownProps {
  text: string;
  renderText?: RenderText;
  /** Drawn at the end of the last line — the "(edited)" mark. */
  trailing?: ReactNode;
  /** Headings a notch smaller, for narrow places like the room chat. */
  compact?: boolean;
  /** Draws ![alt](url) images — see MarkdownOptions. Never for chat. */
  images?: boolean;
}

export function Markdown({ text, renderText: callerRenderText = linkifyPlain, trailing, compact = false, images = false }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(text, { images }), [text, images]);
  const jumbo = useMemo(() => isJumboEmojiText(text), [text]);
  const renderText = useMemo(() => withCustomEmoji(callerRenderText, jumbo), [callerRenderText, jumbo]);
  // The trailing mark goes inside the last block when that block is a line of
  // text, so "(edited)" sits after the words rather than on a line of its own.
  const last = blocks[blocks.length - 1];
  const trailingInside = Boolean(trailing) && last && (last.type === "paragraph" || last.type === "heading" || last.type === "subtext");
  return (
    <>
      {blocks.map((block, index) => (
        <Block
          key={index}
          block={block}
          path={String(index)}
          renderText={renderText}
          compact={compact}
          trailing={trailingInside && index === blocks.length - 1 ? trailing : undefined}
        />
      ))}
      {trailing && !trailingInside && <span className="block">{trailing}</span>}
    </>
  );
}

interface BlockProps {
  block: BlockNode;
  path: string;
  renderText: RenderText;
  compact: boolean;
  trailing?: ReactNode;
}

const HEADING_CLASS = {
  1: "text-xl font-bold",
  2: "text-lg font-bold",
  3: "text-base font-bold",
} as const;

const HEADING_CLASS_COMPACT = {
  1: "text-base font-bold",
  2: "text-[15px] font-bold",
  3: "text-sm font-bold",
} as const;

function Block({ block, path, renderText, compact, trailing }: BlockProps) {
  const inline = (nodes: InlineNode[]) => <Inline nodes={nodes} path={path} renderText={renderText} />;
  switch (block.type) {
    case "paragraph":
      return (
        <div className="whitespace-pre-wrap break-words">
          {inline(block.children)}
          {trailing}
        </div>
      );
    case "heading":
      return (
        <div className={`mt-1 whitespace-pre-wrap break-words leading-snug ${(compact ? HEADING_CLASS_COMPACT : HEADING_CLASS)[block.level]}`}>
          {inline(block.children)}
          {trailing}
        </div>
      );
    case "subtext":
      return (
        <div className="whitespace-pre-wrap break-words text-xs text-zinc-500 dark:text-zinc-400">
          {inline(block.children)}
          {trailing}
        </div>
      );
    case "quote":
      return (
        <blockquote className="my-0.5 border-l-4 border-zinc-300 pl-2.5 dark:border-zinc-600">
          {block.children.map((child, index) => (
            <Block key={index} block={child} path={`${path}.${index}`} renderText={renderText} compact={compact} />
          ))}
        </blockquote>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="whitespace-pre-wrap break-words">
          <Inline nodes={item} path={`${path}.${index}`} renderText={renderText} />
        </li>
      ));
      return block.ordered ? (
        <ol start={block.start} className="my-0.5 list-decimal pl-6">
          {items}
        </ol>
      ) : (
        <ul className="my-0.5 list-disc pl-6">{items}</ul>
      );
    }
    case "codeBlock":
      return <CodeBlock code={block.value} lang={block.lang} />;
  }
}

interface InlineProps {
  nodes: InlineNode[];
  path: string;
  renderText: RenderText;
}

function Inline({ nodes, path, renderText }: InlineProps): ReactNode {
  return nodes.map((node, index) => {
    const key = `${path}-${index}`;
    switch (node.type) {
      case "text":
        return <Fragment key={key}>{renderText(node.value, key)}</Fragment>;
      case "bold":
        return (
          <strong key={key} className="font-bold">
            <Inline nodes={node.children} path={key} renderText={renderText} />
          </strong>
        );
      case "italic":
        return (
          <em key={key}>
            <Inline nodes={node.children} path={key} renderText={renderText} />
          </em>
        );
      case "underline":
        return (
          <u key={key} className="underline-offset-2">
            <Inline nodes={node.children} path={key} renderText={renderText} />
          </u>
        );
      case "strike":
        return (
          <s key={key}>
            <Inline nodes={node.children} path={key} renderText={renderText} />
          </s>
        );
      case "spoiler":
        return (
          <Spoiler key={key}>
            <Inline nodes={node.children} path={key} renderText={renderText} />
          </Spoiler>
        );
      case "code":
        return (
          <code
            key={key}
            className="rounded bg-zinc-200/80 px-1 py-px font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
          >
            {node.value}
          </code>
        );
      case "image":
        // Only ever reached with `images` on (admin-written copy); the parser
        // already limits the address to http(s).
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={key}
            src={node.url}
            alt={node.alt}
            title={node.alt || undefined}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="my-1 inline-block h-auto max-w-full rounded-md align-middle"
          />
        );
      case "link":
        // The label is drawn as plain text — a mention or a link inside a
        // link would be a click target inside another. The address shows on
        // hover, since the label can say anything.
        return (
          <a
            key={key}
            href={node.url}
            title={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            <Inline nodes={node.children} path={key} renderText={(plain) => plain} />
          </a>
        );
    }
  });
}

function Spoiler({ children }: { children: ReactNode }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  if (shown) {
    return <span className="rounded bg-zinc-500/20 px-0.5">{children}</span>;
  }
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={t("markdown.spoiler")}
      title={t("markdown.spoiler")}
      onClick={(event) => {
        event.stopPropagation();
        setShown(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          setShown(true);
        }
      }}
      // Hidden, not just dark: the words are not selectable or clickable
      // until the spoiler is opened.
      className="cursor-pointer select-none rounded bg-zinc-700 px-0.5 text-transparent transition hover:bg-zinc-600 dark:bg-zinc-600 dark:hover:bg-zinc-500 [&_*]:pointer-events-none [&_*]:text-transparent"
    >
      {children}
    </span>
  );
}

const TOKEN_CLASS: Record<CodeTokenType, string> = {
  comment: "italic text-zinc-500 dark:text-zinc-500",
  string: "text-emerald-700 dark:text-emerald-400",
  number: "text-orange-700 dark:text-orange-300",
  keyword: "text-violet-700 dark:text-violet-400",
  literal: "text-orange-700 dark:text-orange-300",
  func: "text-blue-700 dark:text-sky-400",
  tag: "text-rose-700 dark:text-rose-400",
  attr: "text-amber-700 dark:text-amber-300",
  added: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  removed: "bg-red-500/15 text-red-700 dark:text-red-400",
};

function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const t = useT();
  const tokens = useMemo(() => highlightCode(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);
  return (
    <div className="group/code relative my-1 max-w-full">
      <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-50 p-2.5 pr-9 font-mono text-[13px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        <code>
          {tokens.map((token, index) =>
            token.type ? (
              <span key={index} className={TOKEN_CLASS[token.type]}>
                {token.value}
              </span>
            ) : (
              <Fragment key={index}>{token.value}</Fragment>
            )
          )}
        </code>
      </pre>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          void navigator.clipboard?.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          });
        }}
        title={copied ? t("common.copied") : t("common.copy")}
        aria-label={copied ? t("common.copied") : t("common.copy")}
        className="absolute right-1.5 top-1.5 rounded p-1 text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-zinc-700 focus-visible:opacity-100 group-hover/code:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        {copied ? <MdCheck className="h-4 w-4" /> : <MdContentCopy className="h-4 w-4" />}
      </button>
    </div>
  );
}
