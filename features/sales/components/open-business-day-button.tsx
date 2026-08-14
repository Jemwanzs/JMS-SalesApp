"use client";

import { useTransition } from "react";

import { openBusinessDayAction } from "@/features/sales/actions/open-business-day";
import { Button } from "@/components/ui/button";

export function OpenBusinessDayButton({
  tenantId,
  tenantSlug,
  locationId,
}: {
  tenantId: string;
  tenantSlug: string;
  locationId: string;
}) {
  const [isPending, startTransition] = useTransition();

  function onOpen() {
    startTransition(async () => {
      await openBusinessDayAction(tenantId, tenantSlug, locationId);
    });
  }

  return (
    <Button onClick={onOpen} disabled={isPending} className="w-full">
      {isPending ? "Opening..." : "Open Business Day"}
    </Button>
  );
}
