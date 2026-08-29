"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { removeTenantLogoAction } from "@/features/workspace/actions/remove-tenant-logo";
import { setTenantLogoAction } from "@/features/workspace/actions/set-tenant-logo";
import { LogoUpload, type TenantLogoValue } from "@/features/workspace/components/logo-upload";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * User & Tenant Branding Personalization. Persists on every change
 * immediately (no separate Save button) -- same "edit dialog persists
 * immediately" shape edit-product-dialog.tsx already uses for its own
 * image upload, since there's nothing else on this card to batch the
 * change with.
 */
export function BrandingForm({
  tenantId,
  tenantSlug,
  initial,
}: {
  tenantId: string;
  tenantSlug: string;
  initial: TenantLogoValue | null;
}) {
  const [logo, setLogo] = useState<TenantLogoValue | null>(initial);
  const [, startTransition] = useTransition();

  function onChange(next: TenantLogoValue | null) {
    setLogo(next);
    startTransition(async () => {
      const result = next
        ? await setTenantLogoAction(tenantId, tenantSlug, next.storagePath, next.url)
        : await removeTenantLogoAction(tenantId, tenantSlug);

      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(next ? "Logo updated" : "Logo removed");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Shown at the top of the app for everyone on your team. Optional — if you don&apos;t upload one, nothing
          changes.
        </p>
        <LogoUpload tenantId={tenantId} value={logo} onChange={onChange} />
      </CardContent>
    </Card>
  );
}
