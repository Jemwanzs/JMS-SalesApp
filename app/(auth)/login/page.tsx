import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";
import { AuthPromoBanner } from "@/components/shared/auth-promo-banner";
import { UserGuideLink } from "@/components/shared/user-guide-link";
import { DemoVideoLink } from "@/components/shared/demo-video-link";

export const metadata: Metadata = {
  title: "Log in | JMS Sales App",
};

export default function LoginPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Welcome back</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Log in to record today&apos;s sales.
      </p>
      <LoginForm />
      <UserGuideLink />
      <DemoVideoLink />
      <AuthPromoBanner />
    </div>
  );
}
