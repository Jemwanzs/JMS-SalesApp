import type { Metadata } from "next";

import { CookiePreferencesTrigger } from "@/components/shared/cookie-preferences-trigger";

export const metadata: Metadata = {
  title: "Privacy Policy | JMS Sales App",
};

const LAST_UPDATED = "August 27, 2026";

export default function PrivacyPolicyPage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-foreground">
      <div>
        <h1 className="text-2xl font-semibold">Privacy Policy</h1>
        <p className="mt-1 text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>

      <p>
        JMS Sales App (&quot;we&quot;, &quot;us&quot;, the &quot;Service&quot;) is operated by SyncScore Ltd. This policy explains what
        information we collect from businesses (&quot;tenants&quot;) and their staff who use the Service, why we collect it, and
        how it&apos;s handled.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Information we collect</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Account information</strong> — name, email address, phone number, and password (stored securely by our
            authentication provider; we never see or store your password in plain text).
          </li>
          <li>
            <strong>Business information</strong> — business name, type, website, currency, timezone, location/address, and
            working hours, provided when a business sets up its account.
          </li>
          <li>
            <strong>Sales records</strong> — products, quantities, amounts, payment method, and any customer details a staff
            member chooses to enter when recording a sale.
          </li>
          <li>
            <strong>Employee/user activity</strong> — which staff member recorded, corrected, or voided a sale, and their
            assigned role and permissions within their business.
          </li>
          <li>
            <strong>Login and security data</strong> — sign-in timestamps, IP address, device/browser type, and session
            activity, used to protect accounts and let administrators review recent login activity.
          </li>
          <li>
            <strong>Location data</strong> — only if a business chooses to turn on location-based sign-in restrictions for
            its own staff; this is off by default and configured per business.
          </li>
          <li>
            <strong>Billing information</strong> — subscription status and payment history. Card and payment details are
            collected and processed directly by our payment processor, Paystack — we never receive or store your full card
            number.
          </li>
          <li>
            <strong>Product photos</strong> — images a business uploads for its own product catalog.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Why we collect it</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>To provide the Service — recording sales, managing a product catalog, generating reports and analytics.</li>
          <li>To secure accounts and detect suspicious activity (e.g. repeated failed sign-in attempts).</li>
          <li>To process subscription payments and communicate about billing.</li>
          <li>To respond to support requests.</li>
          <li>To keep an audit trail of sensitive account and permission changes, for accountability within a business.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Who we share it with</h2>
        <p>We don&apos;t sell personal information. Data is shared only with the service providers that run the platform itself:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong>Supabase</strong> — our database, authentication, and file-storage provider.
          </li>
          <li>
            <strong>Vercel</strong> — hosts the application itself.
          </li>
          <li>
            <strong>Paystack</strong> — processes subscription payments.
          </li>
        </ul>
        <p>
          Within a single business (&quot;tenant&quot;), data is only visible to that business&apos;s own staff, scoped by their
          assigned role and permissions. Businesses cannot see each other&apos;s data under any circumstance — this is
          enforced at the database level, not just in the app&apos;s interface.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Data retention</h2>
        <p>
          We keep account and sales data for as long as an account remains active, and afterward for as long as reasonably
          needed for legitimate business, accounting, or legal purposes. You can request deletion of your business&apos;s data
          at any time — see Section 6.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Security</h2>
        <p>
          Data is transmitted over encrypted connections. Access within the app is restricted per business and per staff
          role at the database level, not only by the interface. Sensitive account and permission changes are recorded in
          an audit trail. Businesses can optionally require multi-factor authentication and restrict sign-in to specific
          locations or working hours for their own staff.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Your rights</h2>
        <p>
          You can request access to, correction of, or deletion of your personal information, or export of your
          business&apos;s data, by contacting us at{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>
          . A business owner requesting deletion of their entire account should note this will remove access for every
          staff member of that business — we&apos;ll confirm scope with you before acting on the request.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Cookies</h2>
        <p>
          We use essential cookies to keep you signed in, remember your session, and keep the app working. With your
          permission, we may also use optional cookies to help us understand how the app is used and improve it. We
          don&apos;t use third-party advertising cookies.
        </p>
        <CookiePreferencesTrigger />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. Children</h2>
        <p>The Service is a business tool and isn&apos;t directed at, or knowingly used by, children.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">9. Changes to this policy</h2>
        <p>We&apos;ll update the &quot;Last updated&quot; date above if this policy changes, and post the revised version here.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">10. Contact</h2>
        <p>
          Questions about this policy or how your data is handled:{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>
          .
        </p>
      </section>
    </article>
  );
}
