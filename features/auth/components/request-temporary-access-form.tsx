"use client";

import { useState, useTransition } from "react";

import { requestTemporaryAccessAction } from "@/features/auth/actions/request-temporary-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shown only when signInAction reports blockedBy: "geofence" (see
 * login-form.tsx) -- docs/05-authentication-security.md's "Request
 * Temporary Access" flow. Re-sends the email/password the user just
 * typed (not re-prompted -- see request-temporary-access.ts's header
 * comment for why re-authenticating is still necessary server-side).
 */
export function RequestTemporaryAccessForm({
  email,
  password,
  latitude,
  longitude,
}: {
  email: string;
  password: string;
  latitude: number | null;
  longitude: number | null;
}) {
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("60");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("email", email);
    formData.set("password", password);
    formData.set("reason", reason);
    formData.set("durationMinutes", durationMinutes);
    if (latitude != null) formData.set("latitude", String(latitude));
    if (longitude != null) formData.set("longitude", String(longitude));

    startTransition(async () => {
      const result = await requestTemporaryAccessAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setSubmitted(true);
    });
  }

  if (submitted) {
    return (
      <p className="rounded-md border border-border bg-muted/50 p-3 text-sm text-muted-foreground">
        Your request has been sent for review. You&rsquo;ll be able to sign in once an admin approves it.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded-md border border-border p-3">
      <div className="space-y-1">
        <Label htmlFor="tar-reason">Reason for access</Label>
        <Input
          id="tar-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      <div className="space-y-1">
        <Label htmlFor="tar-duration">Requested duration (minutes)</Label>
        <Input
          id="tar-duration"
          type="number"
          min={1}
          max={720}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" variant="outline" className="w-full" disabled={isPending}>
        {isPending ? "Submitting..." : "Request Temporary Access"}
      </Button>
    </form>
  );
}
