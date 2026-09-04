import Link from "next/link";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Headset, ScrollText, Shield } from "lucide-react";

import { BackLinkSmart } from "@/components/shared/back-link-smart";
import { RestartTourButton } from "@/features/support/components/restart-tour-button";
import { SupportNavCard } from "@/features/support/components/support-nav-card";

export const metadata: Metadata = {
  title: "Support | JMS Sales App",
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <article className="space-y-6 text-sm leading-relaxed text-foreground">
      <Suspense fallback={null}>
        <BackLinkSmart fallbackHref="/" fallbackLabel="home" />
      </Suspense>

      <div>
        <h1 className="text-2xl font-semibold">Help &amp; Support</h1>
        <p className="mt-1 text-muted-foreground">We&apos;re happy to help.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <SupportNavCard
          href="/privacy-policy"
          icon={Shield}
          title="Privacy Policy"
          description="Learn how your information is handled."
        />
        <SupportNavCard
          href="/terms-of-service"
          icon={ScrollText}
          title="Terms & Conditions"
          description="Review the terms governing use of the application."
        />
        <SupportNavCard
          href="#contact"
          icon={Headset}
          title="Get Help"
          description="Get assistance with your account or application."
        />
      </div>

      <section id="contact" className="space-y-2 scroll-mt-4">
        <h2 className="text-lg font-semibold">Contact us</h2>
        <p>
          For any question, issue, or feedback about JMS Sales App, email{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>
          . Include your business name and, if it&apos;s about a specific problem, what you were trying to do and what
          happened instead — that helps us get back to you with an answer faster.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">User Guide</h2>
        <p>
          The full User Guide covers every part of the app — signing up, recording sales, inviting your team, reports and
          analytics, billing, and the optional Inventory module — in one downloadable PDF.
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href="/docs/User-Guide.pdf"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-lg border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Download the User Guide (PDF)
          </a>
          <RestartTourButton from={from} />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Common questions</h2>
        <div className="space-y-4">
          <div>
            <p className="font-medium">I forgot my password.</p>
            <p className="text-muted-foreground">
              Use &quot;Forgot password?&quot; on the login screen to reset it by email.
            </p>
          </div>
          <div>
            <p className="font-medium">An employee can&apos;t sign in.</p>
            <p className="text-muted-foreground">
              Check More → Users to confirm their invite was accepted and their account is active, and More → Security if
              your business restricts sign-in by location or working hours.
            </p>
          </div>
          <div>
            <p className="font-medium">I recorded a sale by mistake.</p>
            <p className="text-muted-foreground">
              Open the sale in Sales History and use Void or Correct — every change stays visible in history with a
              reason, nothing is silently edited away.
            </p>
          </div>
          <div>
            <p className="font-medium">What is the Inventory/Stock module, and do I have to use it?</p>
            <p className="text-muted-foreground">
              It&apos;s a completely optional, separately-billed add-on for tracking stock levels — More → Settings →
              Modules. If you never turn it on, nothing else about the app changes.
            </p>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Deleting your account</h2>
        <p>
          Both an individual account and an entire business can be deleted from within the app — More → Security. See{" "}
          <Link href="/account-deletion" className="underline">
            Delete My Account
          </Link>{" "}
          for exactly what each option does and what happens to your data. If you can&apos;t sign in to use either
          option, email{" "}
          <a href="mailto:jamosammy@gmail.com" className="underline">
            jamosammy@gmail.com
          </a>{" "}
          from the address on the account and we&apos;ll process the request manually.
        </p>
      </section>
    </article>
  );
}
