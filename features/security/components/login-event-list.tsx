import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LoginEventSummary } from "@/services/SecurityService";

export function LoginEventList({
  title,
  events,
}: {
  title: string;
  events: Array<LoginEventSummary & { who?: string }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
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
      </CardContent>
    </Card>
  );
}
