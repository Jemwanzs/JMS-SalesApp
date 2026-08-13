import type { Metadata } from "next";

import { RequestPasswordResetForm } from "@/features/auth/components/request-password-reset-form";

export const metadata: Metadata = {
  title: "Reset password | JMS Sales App",
};

export default function ResetPasswordPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Reset your password</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Enter the email on your account and we&apos;ll send a reset link.
      </p>
      <RequestPasswordResetForm />
    </div>
  );
}
