"use client";

// The rich cards a webhook or bot message carries (see lib/messageEmbeds.ts),
// drawn the way Discord draws them: a colour bar down the left, an author
// line, a title, the description in markdown, fields (the inline ones side by
// side), a thumbnail in the corner, a picture and a footer.
//
// Pictures come straight from wherever the sender pointed them — https only,
// and without a referrer, so all the other site learns is that somebody
// opened a chat.

import type { ReactNode } from "react";
import { Markdown, linkifyPlain } from "@/components/Markdown";
import { formatLocale } from "@/lib/i18n";
import { safeHref, safeImage, type MessageEmbed } from "@/lib/messageEmbeds";

interface MessageEmbedsProps {
  embeds: MessageEmbed[] | undefined;
  /** Opens a picture in the chat's viewer; without it, a picture is not clickable. */
  onOpenImage?: (src: string) => void;
  /** A picture finished loading — the chat keeps its scroll pinned to the bottom. */
  onLoad?: () => void;
  className?: string;
}

export function MessageEmbeds({ embeds, onOpenImage, onLoad, className = "" }: MessageEmbedsProps) {
  if (!embeds || embeds.length === 0) return null;
  return (
    <div className={`mt-1 flex flex-col gap-1.5 ${className}`}>
      {embeds.map((embed, index) => (
        <EmbedCard key={index} embed={embed} onOpenImage={onOpenImage} onLoad={onLoad} />
      ))}
    </div>
  );
}

function colorOf(value: number | undefined): string | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffffff) return undefined;
  return `#${value.toString(16).padStart(6, "0")}`;
}

function timestampLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(formatLocale(), { dateStyle: "short", timeStyle: "short" });
}

function LinkOr({ href, className, children }: { href: string | undefined; className: string; children: ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${className} hover:underline`}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

function EmbedImage({
  src,
  className,
  onOpenImage,
  onLoad,
}: {
  src: string;
  className: string;
  onOpenImage?: (src: string) => void;
  onLoad?: () => void;
}) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={onLoad} className={className} />;
  if (!onOpenImage) return img;
  return (
    <button type="button" onClick={() => onOpenImage(src)} className="block cursor-zoom-in">
      {img}
    </button>
  );
}

function EmbedCard({
  embed,
  onOpenImage,
  onLoad,
}: {
  embed: MessageEmbed;
  onOpenImage?: (src: string) => void;
  onLoad?: () => void;
}) {
  const color = colorOf(embed.color);
  const thumbnail = safeImage(embed.thumbnail);
  const image = safeImage(embed.image);
  const authorIcon = safeImage(embed.author?.iconUrl);
  const footerIcon = safeImage(embed.footer?.iconUrl);
  const when = timestampLabel(embed.timestamp);
  const fields = embed.fields ?? [];

  return (
    <div
      className="grid w-fit min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 rounded-md border-l-4 border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-800 sm:max-w-[32rem] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200"
      style={color ? { borderLeftColor: color } : undefined}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {embed.author?.name && (
          <div className="flex min-w-0 items-center gap-2">
            {authorIcon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={authorIcon} alt="" referrerPolicy="no-referrer" className="h-6 w-6 shrink-0 rounded-full object-cover" />
            )}
            <LinkOr href={safeHref(embed.author.url)} className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              {embed.author.name}
            </LinkOr>
          </div>
        )}
        {embed.title && (
          <LinkOr
            href={safeHref(embed.url)}
            className={`break-words font-semibold ${embed.url ? "text-blue-600 dark:text-blue-400" : "text-zinc-900 dark:text-zinc-100"}`}
          >
            {embed.title}
          </LinkOr>
        )}
        {embed.description && (
          <div className="min-w-0 text-[13px] leading-relaxed">
            <Markdown text={embed.description} renderText={linkifyPlain} compact />
          </div>
        )}
        {fields.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2">
            {fields.map((field, index) => (
              <div key={index} className={field.inline ? "min-w-[7rem] flex-[1_1_28%]" : "basis-full"}>
                <div className="break-words text-xs font-semibold text-zinc-900 dark:text-zinc-100">{field.name}</div>
                <div className="min-w-0 text-[13px] leading-relaxed">
                  <Markdown text={field.value} renderText={linkifyPlain} compact />
                </div>
              </div>
            ))}
          </div>
        )}
        {image && (
          <EmbedImage
            src={image}
            onOpenImage={onOpenImage}
            onLoad={onLoad}
            className="mt-2 block max-h-80 max-w-full rounded-md object-contain"
          />
        )}
        {(embed.footer?.text || when) && (
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            {footerIcon && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={footerIcon} alt="" referrerPolicy="no-referrer" className="h-5 w-5 shrink-0 rounded-full object-cover" />
            )}
            <span className="min-w-0 break-words">
              {embed.footer?.text}
              {embed.footer?.text && when && " • "}
              {when}
            </span>
          </div>
        )}
      </div>
      {thumbnail && (
        <EmbedImage
          src={thumbnail}
          onOpenImage={onOpenImage}
          onLoad={onLoad}
          className="mt-0.5 h-20 w-20 rounded-md object-cover"
        />
      )}
    </div>
  );
}
