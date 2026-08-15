"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { reopenBusinessDayAction } from "@/features/sales/actions/reopen-business-day";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function defaultUntilTime(): string {
  const inOneHour = new Date(Date.now() + 60 * 60 * 1000);
  return `${String(inOneHour.getHours()).padStart(2, "0")}:${String(inOneHour.getMinutes()).padStart(2, "0")}`;
}

export function ReopenBusinessDayDialog({
  businessDayId,
  tenantId,
  tenantSlug,
}: {
  businessDayId: string;
  tenantId: string;
  tenantSlug: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [untilTime, setUntilTime] = useState(defaultUntilTime);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const [hours, minutes] = untilTime.split(":").map(Number);
    const until = new Date();
    until.setHours(hours, minutes, 0, 0);
    if (until.getTime() <= Date.now()) {
      until.setDate(until.getDate() + 1);
    }

    const formData = new FormData();
    formData.set("businessDayId", businessDayId);
    formData.set("reason", reason);
    formData.set("until", until.toISOString());

    startTransition(async () => {
      const result = await reopenBusinessDayAction(tenantId, tenantSlug, {}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.fieldErrors) {
        setError(Object.values(result.fieldErrors)[0] ?? "Please check your entries");
        return;
      }
      if (result.result) {
        setOpen(false);
        setReason("");

        if (result.result.status === "pending_approval") {
          toast("Submitted for approval", {
            description: "This will reopen once a reviewer approves it.",
          });
        } else {
          toast.success("Business day reopened");
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="w-full" />}>
        Reopen business day
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reopen this business day</DialogTitle>
          <DialogDescription>
            Sales can be recorded again until the time below, then it automatically locks back.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reopen-reason">Reason</Label>
            <Input
              id="reopen-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reopen-until">Reopen until</Label>
            <Input
              id="reopen-until"
              type="time"
              value={untilTime}
              onChange={(e) => setUntilTime(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Reopening..." : "Reopen"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
