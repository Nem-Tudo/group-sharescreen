import type { Metadata } from "next";
import { GiftRedirect } from "@/app/gift/[code]/GiftRedirect";
import { pageMetadata } from "@/lib/seo";
import { translate } from "@/lib/i18n";

// Where somebody holding a gift *code* (rather than a link) goes to type it in.
//
// Same shape as /gift/[code]: the site with a present on top of it, so this
// only moves to the home page with an empty ?gift= and GiftClaimHost opens the
// dialog in its "type the code" state.

export const metadata: Metadata = pageMetadata({
  path: "/redeem",
  title: translate("redeem.title"),
  description: translate("redeem.description"),
});

export default function RedeemPage() {
  return <GiftRedirect code="" />;
}
