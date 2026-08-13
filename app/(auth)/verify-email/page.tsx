import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Verify your email | JMS Sales App",
};

export default function VerifyEmailPage() {
  return (
    <div className="text-center">
      <h1 className="mb-2 text-2xl font-semibold">Check your email</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        We&apos;ve sent a confirmation link to your email address. Click it
        to activate your account, then log in.
      </p>
      <Button className="w-full" render={<Link href="/login">Go to log in</Link>} />
    </div>
  );
}
