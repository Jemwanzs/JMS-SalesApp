import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service | JMS Sales App",
};

const LAST_UPDATED = "August 27, 2026";

export default function TermsOfServicePage() {
  return (
    <article className="space-y-6 text-sm leading-relaxed text-foreground">
      <div>
        <h1 className="text-2xl font-semibold">Terms of Service</h1>
        <p className="mt-1 text-muted-foreground">Last updated: {LAST_UPDATED}</p>
      </div>

      <p>
        These terms govern your use of JMS Sales App (the &quot;Service&quot;), operated by SyncScore Ltd (&quot;we&quot;,
        &quot;us&quot;). By creating an account or using the Service, you agree to these terms on behalf of yourself and, if
        you&apos;re signing up a business, on behalf of that business.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. The Service</h2>
        <p>
          JMS Sales App is a mobile-first sales-recording and analytics platform for businesses. It lets a business record
          daily sales, manage a product catalog, review reports and analytics, and manage staff access — and, optionally,
          track stock/inventory via a separate add-on described in Section 4.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Accounts</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>You must provide accurate information when creating an account.</li>
          <li>You&apos;re responsible for keeping your login credentials confidential and for activity under your account.</li>
          <li>
            A business owner (&quot;Tenant Administrator&quot;) is responsible for the staff they invite and the access
            level they grant each one.
          </li>
          <li>One account represents one business (&quot;tenant&quot;) — each business&apos;s data is kept separate from every other business on the platform.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Subscriptions and billing</h2>
        <ul className="list-disc space-y-2 pl-5">
          <li>New businesses start on a free trial. Continued use after the trial requires an active paid subscription.</li>
          <li>Payments are processed securely by Paystack; we don&apos;t collect or store your full card details.</li>
          <li>Subscriptions renew automatically at the end of each billing period unless cancelled beforehand.</li>
          <li>
            If a subscription lapses, the account enters a short grace period, after which access is restricted until the
            subscription is renewed. This never deletes your data — see Section 7.
          </li>
          <li>We may change pricing going forward; existing subscribers will be given reasonable notice before a price change takes effect for their next renewal.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. The Inventory/Stock add-on (optional)</h2>
        <p>
          Inventory & Stock Management is a separate, optional module with its own independent subscription — turning it on
          or off never affects your base subscription, and vice versa. It&apos;s billed, trialed, and cancelled separately
          from the base Service, on the same terms as this section otherwise describes for subscriptions generally.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Use the Service for anything unlawful, fraudulent, or that infringes on others&apos; rights.</li>
          <li>Attempt to access another business&apos;s data, or bypass or interfere with the Service&apos;s security or access controls.</li>
          <li>Reverse-engineer, decompile, or attempt to extract the source code of the Service, except as permitted by law.</li>
          <li>Interfere with or disrupt the Service&apos;s infrastructure or other users&apos; use of it.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Your data</h2>
        <p>
          You (or the business you represent) own the data you put into the Service — your product catalog, sales records,
          and business information. We don&apos;t claim ownership of it, and we don&apos;t sell it. See our{" "}
          <a href="/privacy-policy" className="underline">
            Privacy Policy
          </a>{" "}
          for how it&apos;s collected, used, and protected.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Termination and data after cancellation</h2>
        <p>
          You may stop using the Service at any time. We may suspend or terminate an account for a violation of these
          terms or extended non-payment. If you&apos;d like your business&apos;s data exported or permanently deleted after
          closing your account, contact us at{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>{" "}
          and we&apos;ll help with that request.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">8. Service availability</h2>
        <p>
          We work to keep the Service reliable and available, but it&apos;s provided on an &quot;as is&quot; basis without a
          guarantee of uninterrupted availability. We may need to perform maintenance or make changes that temporarily
          affect access.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">9. Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, SyncScore Ltd isn&apos;t liable for indirect, incidental, or consequential
          damages arising from your use of the Service. Nothing in these terms limits liability that can&apos;t be limited
          under applicable law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">10. Governing law</h2>
        <p>These terms are governed by the laws of Kenya.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">11. Changes to these terms</h2>
        <p>We&apos;ll update the &quot;Last updated&quot; date above if these terms change, and post the revised version here.</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">12. Contact</h2>
        <p>
          Questions about these terms:{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>
          .
        </p>
      </section>
    </article>
  );
}
