import { FaDiscord, FaInstagram, FaXTwitter } from "react-icons/fa6";

// The three places to follow the project, in one component so a new one (or a
// changed handle) is a single edit rather than a hunt through every footer.
//
// The Discord invite is the odd one out and comes first for it: the other two
// are where updates get posted, but that one is where someone lands with a
// bug, a suggestion, or a room that will not connect — and it is already the
// contact address in the terms.
const LINKS = [
  {
    label: "discord.gg/nemtudo",
    href: "https://discord.gg/nemtudo",
    Icon: FaDiscord,
    // Brand colors on hover only. At rest the row stays in the page's own
    // greys, so three logos in a footer read as a set instead of as three
    // competing badges.
    hover: "hover:border-[#5865F2]/50 hover:text-[#5865F2] dark:hover:text-[#a5adff]",
  },
  {
    label: "@NemTudo_",
    href: "https://x.com/NemTudo_",
    Icon: FaXTwitter,
    hover: "hover:border-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50",
  },
  {
    label: "@onemtudo",
    href: "https://instagram.com/onemtudo",
    Icon: FaInstagram,
    hover: "hover:border-[#E1306C]/50 hover:text-[#E1306C] dark:hover:text-[#f472a0]",
  },
];

// This used to also carry the attribution line Google requires in exchange
// for hiding the reCAPTCHA badge. Turnstile neither plants a badge nor asks
// for attribution, so the footer is back to being only the follow links.

/**
 * Row of follow links. `title` is the line above them — pass null on a
 * surface that already says what they are.
 */
export function SocialLinks({
  title = "Acompanhe o GoLive",
  className = "",
}: {
  title?: string | null;
  className?: string;
}) {
  return (
    <div className={className}>
      {title && (
        <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {LINKS.map(({ label, href, Icon, hover }) => (
          <a
            key={href}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex items-center gap-2 rounded-full border border-zinc-300 px-3.5 py-1.5 text-sm font-medium text-zinc-600 transition dark:border-zinc-700 dark:text-zinc-400 ${hover}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
