"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { forceSignOutUserAction } from "@/features/security/actions/force-sign-out-user";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SessionSummary } from "@/services/SecurityService";

type TenantSession = SessionSummary & { profileId: string; who: string };

/**
 * security.manage's tenant-wide view of who's currently signed in, with
 * a "Force sign out" action per OTHER member (docs/05: "revoke
 * capability (self-service and admin-driven)"). Grouped by profile, not
 * shown as raw session rows -- the underlying capability is account-
 * wide (see SecurityService.forceSignOutUser), so a per-row button next
 * to each individual session would imply a precision the action doesn't
 * actually have.
 */
export function TenantSessionList({
  sessions,
  tenantId,
  tenantSlug,
  currentUserId,
}: {
  sessions: TenantSession[];
  tenantId: string;
  tenantSlug: string;
  currentUserId: string;
}) {
  const [signedOut, setSignedOut] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();
  const [pendingProfileId, setPendingProfileId] = useState<string | null>(null);

  const byProfile = new Map<string, { who: string; sessionCount: number }>();
  for (const s of sessions) {
    if (signedOut.has(s.profileId)) continue;
    const existing = byProfile.get(s.profileId);
    byProfile.set(s.profileId, { who: s.who, sessionCount: (existing?.sessionCount ?? 0) + 1 });
  }

  function onForceSignOut(profileId: string, who: string) {
    if (!window.confirm(`Sign "${who}" out of every device? Their account will be temporarily blocked from signing back in for 1 hour.`)) {
      return;
    }
    setPendingProfileId(profileId);
    startTransition(async () => {
      const result = await forceSignOutUserAction(tenantId, tenantSlug, profileId);
      setPendingProfileId(null);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      setSignedOut((prev) => new Set(prev).add(profileId));
      toast.success(`Signed "${who}" out of every device`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Who else is signed in</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {byProfile.size === 0 && <p className="text-sm text-muted-foreground">No other active sessions right now.</p>}
        {[...byProfile.entries()].map(([profileId, { who, sessionCount }]) => (
          <div key={profileId} className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{who}</p>
              <p className="text-xs text-muted-foreground">
                {sessionCount} active session{sessionCount === 1 ? "" : "s"}
              </p>
            </div>
            {profileId !== currentUserId && (
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending && pendingProfileId === profileId}
                onClick={() => onForceSignOut(profileId, who)}
              >
                {isPending && pendingProfileId === profileId ? "Signing out..." : "Force sign out"}
              </Button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
