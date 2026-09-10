import type { Metadata } from "next";
import { redirect } from "next/navigation";

// The link a present travels as: golive.../gift/ABCD2345
//
// It is a redirect and not a page, which is the whole design. What somebody
// arriving here should see is the site — their site, with their rooms and
// their friends on it — and a present on top of it, rather than a landing page
// that talks about GoLive to somebody who is *being given* GoLive. So the code
// is handed to the home page as a query parameter and the dialog opens there
// (see components/GiftClaimHost).
//
// The parameter survives what has to happen next, which is the reason it is a
// parameter and not a one-shot handoff: whoever follows this link often has no
// account yet, and creating one happens in a dialog on that same page. A code
// kept in memory would not survive the sign-up; one in the URL does.

export const metadata: Metadata = {
  title: "Você recebeu um presente — GoLive",
  // Not indexable, and not for the usual privacy reason: a code in a search
  // result is a present anybody can walk off with.
  robots: { index: false, follow: false },
};

export default async function GiftPage(props: PageProps<"/gift/[code]">) {
  const { code } = await props.params;
  redirect(`/?presente=${encodeURIComponent(code)}`);
}
