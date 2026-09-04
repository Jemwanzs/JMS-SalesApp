import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Delete My Account | JMS Sales App",
};

/**
 * The publicly accessible account-deletion page Google Play's Account
 * Deletion policy requires -- readable without signing in, describing
 * both real in-app paths this app actually has (More → Security):
 * an invited employee's own self-service deletion, and a Tenant
 * Administrator's request-plus-30-day-grace-period business deletion.
 * See features/settings/components/{self-delete-account-card,request-
 * tenant-deletion-card}.tsx for the flows this describes.
 */
export default function AccountDeletionPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-foreground">
      <div>
        <h1 className="text-2xl font-semibold">Delete My Account</h1>
        <p className="mt-1 text-muted-foreground">
          What deletion means for JMS Sales App depends on whether you&apos;re an individual member of a business, or
          the business itself.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. If you&apos;re an employee of a business</h2>
        <p>
          Open the app, go to <strong>More → Security</strong>, and choose <strong>Delete My Account</strong>. After
          typing your email to confirm, you&apos;re signed out immediately and lose access to that business.
        </p>
        <p>
          Your past sales and other recorded activity stay exactly as they are, attributed to you, so the business
          keeps an accurate historical record — only your login access is removed. This takes effect right away and
          cannot be undone from within the app; contact the business&apos;s Tenant Administrator, or{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>
          , if you need anything further.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. If you&apos;re a Tenant Administrator (the business owner)</h2>
        <p>
          Open <strong>More → Security</strong> and choose <strong>Delete My Business</strong>. After typing the
          business&apos;s name to confirm, the business is deactivated immediately — every member, including you,
          loses access at that moment.
        </p>
        <p>
          The business and all of its data — sales records, products, stock, staff accounts, everything — is{" "}
          <strong>permanently deleted 30 days later</strong>. You can cancel the request at any time before then from
          the deactivated screen you&apos;re shown after signing back in. Once the 30 days pass, deletion happens
          automatically and cannot be reversed.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Can&apos;t sign in?</h2>
        <p>
          Email{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>{" "}
          from the address on the account, and let us know whether you want your own access removed or the whole
          business account closed — we&apos;ll confirm scope with you before acting on the request.
        </p>
      </section>

      <p className="text-muted-foreground">
        See the{" "}
        <Link href="/privacy-policy" className="underline">
          Privacy Policy
        </Link>{" "}
        for more on what information is collected and how it&apos;s handled.
      </p>
    </article>
  );
}
