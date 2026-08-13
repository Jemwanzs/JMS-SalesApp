import type { Metadata } from "next";

import { UpdatePasswordForm } from "@/features/auth/components/update-password-form";

export const metadata: Metadata = {
  title: "Set new password | JMS Sales App",
};

export default function ResetPasswordConfirmPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Set a new password</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Choose a new password for your account.
      </p>
      <UpdatePasswordForm />
    </div>
  );
}
