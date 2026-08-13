import type { Metadata } from "next";

import { SignUpForm } from "@/features/auth/components/sign-up-form";

export const metadata: Metadata = {
  title: "Sign up | JMS Sales App",
};

export default function SignUpPage() {
  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Create your business account</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Start capturing sales in minutes.
      </p>
      <SignUpForm />
    </div>
  );
}
