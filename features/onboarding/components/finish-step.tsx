"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

export function FinishStep({
  tenantSlug,
  tenantName,
}: {
  tenantSlug: string;
  tenantName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function onFinish() {
    startTransition(() => {
      router.push(`/t/${tenantSlug}/sales`);
    });
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <p className="text-lg font-medium">You&apos;re all set, {tenantName}</p>
      <p className="mt-2 max-w-[30ch] text-sm text-muted-foreground">
        Products, historical import, staff invites, and billing are ready
        for you to fill in from Settings whenever you&apos;re ready.
      </p>
      <Button onClick={onFinish} className="mt-6 w-full" disabled={isPending}>
        Start Recording Sales
      </Button>
    </div>
  );
}
