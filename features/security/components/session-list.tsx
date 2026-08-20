"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { signOutOtherSessionsAction } from "@/features/security/actions/sign-out-other-sessions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CollapsibleCard } from "@/components/shared/collapsible-card";
import type { SessionSummary } from "@/services/SecurityService";

export function SessionList({
  sessions,
  currentSessionId,
}: {
  sessions: SessionSummary[];
  currentSessionId: string | null;
}) {
  const [isPending, startTransition] = useTransition();

  function onSignOutOthers() {
    if (!window.confirm("Sign out of every other device? You'll stay signed in here.")) {
      return;
    }
    startTransition(async () => {
      const result = await signOutOtherSessionsAction();
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Signed out of other devices");
    });
  }

  const hasOtherActive = sessions.some((s) => s.id !== currentSessionId && !s.revokedAt);

  return (
    <CollapsibleCard
      title="Where you're signed in"
      meta={`${sessions.length} session${sessions.length === 1 ? "" : "s"}`}
    >
      {sessions.length === 0 && (
        <p className="text-sm text-muted-foreground">No session history yet.</p>
      )}
      {sessions.map((session) => (
        <div key={session.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{session.device}</span>
              {session.id === currentSessionId && <Badge variant="secondary">This device</Badge>}
              {session.revokedAt && <Badge variant="destructive">Signed out</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {session.ip ?? "Unknown IP"} · last seen{" "}
              {new Date(session.lastSeenAt).toLocaleString()}
            </p>
          </div>
        </div>
      ))}

      {hasOtherActive && (
        <Button variant="outline" size="sm" disabled={isPending} onClick={onSignOutOthers}>
          {isPending ? "Signing out..." : "Sign out of other devices"}
        </Button>
      )}
    </CollapsibleCard>
  );
}
