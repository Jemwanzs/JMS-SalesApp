"use client";

import { Button } from "@/components/ui/button";

/**
 * Reusable placeholder for wizard steps that depend on functionality
 * from later phases (Products: 2a, Historical Import: Phase 5, Invite
 * Users: 4b, Subscription: Phase 6). Honest "not built yet" rather than
 * a fake form — matches the spec's own "Skip" option for the Import
 * step (S10 Step 4) generalized to the other not-yet-real steps.
 */
export function ComingLaterStep({
  title,
  description,
  onSkip,
}: {
  title: string;
  description: string;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <p className="text-lg font-medium">{title}</p>
      <p className="mt-2 max-w-[30ch] text-sm text-muted-foreground">
        {description}
      </p>
      <Button onClick={onSkip} variant="outline" className="mt-6">
        Skip for now
      </Button>
    </div>
  );
}
