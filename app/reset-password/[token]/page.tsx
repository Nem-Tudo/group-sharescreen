import type { Metadata } from "next";
import { PasswordLinkForm } from "./PasswordLinkForm";
import { translate } from "@/lib/i18n";

// The link an administrator generates in /admin ("Gerar link de nova senha").
// Whoever opens it sets the password of the account it names — no login
// needed. The token in the path is the credential, so: never indexed, and no
// Referer, so it does not leak to any image or script host the page loads.

export const metadata: Metadata = {
  get title() {
    return translate("passwordLink.title");
  },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ResetPasswordPage(props: { params: Promise<{ token: string }> }) {
  const { token } = await props.params;
  return (
    <div className="flex flex-1 flex-col items-center bg-zinc-50 px-4 py-12 dark:bg-black">
      <PasswordLinkForm token={token} />
    </div>
  );
}
