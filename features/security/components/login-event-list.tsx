"use client";

import { Badge } from "@/components/ui/badge";
import { CollapsibleCard } from "@/components/shared/collapsible-card";
import type { LoginEventSummary } from "@/services/SecurityService";

export function LoginEventList({
  title,
  events,
}: {
  title: string;
  events: Array<LoginEventSummary & { who?: string }>;
}) {
  return (
    <CollapsibleCard title={title} meta={`${events.length} event${events.length === 1 ? "" : "s"}`}>
      {events.length === 0 && <p className="text-sm text-muted-foreground">No login activity yet.</p>}
      {events.map((event) => (
        <div key={event.id} className="flex items-center justify-between gap-3 text-sm">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {event.who && <span className="truncate font-medium">{event.who}</span>}
              <Badge variant={event.success ? "default" : "destructive"}>
                {event.success ? "Success" : "Failed"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {event.device} · {event.ip ?? "Unknown IP"} · {new Date(event.createdAt).toLocaleString()}
            </p>
            {!event.success && event.failureReason && (
              <p className="text-xs text-destructive">{event.failureReason}</p>
            )}
          </div>
        </div>
      ))}
    </CollapsibleCard>
  );
}
