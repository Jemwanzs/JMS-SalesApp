"use client";

import { useTransition } from "react";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("Sales");

  function onOpen() {
    startTransition(async () => {
      await openBusinessDayAction(tenantId, tenantSlug, locationId);
    });
  }

  return (
    <Button onClick={onOpen} disabled={isPending} className="w-full">
      {isPending ? t("opening") : t("openBusinessDay")}
    </Button>
  );
}
