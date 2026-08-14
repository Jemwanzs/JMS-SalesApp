"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { BusinessDetailsStep } from "@/features/onboarding/components/business-details-step";
import { ComingLaterStep } from "@/features/onboarding/components/coming-later-step";
import { FinishStep } from "@/features/onboarding/components/finish-step";
import { LocationHoursStep } from "@/features/onboarding/components/location-hours-step";

const STEP_TITLES = [
  "Business details",
  "Business hours",
  "Products",
  "Import historical sales",
  "Invite your team",
  "Subscription",
  "Finish",
];

export function OnboardingWizard({
  tenantId,
  tenantSlug,
  tenantName,
}: {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}) {
  const [step, setStep] = useState(1);
  const next = () => setStep((s) => Math.min(s + 1, 7));

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex items-center gap-1.5">
        {STEP_TITLES.map((title, i) => (
          <div
            key={title}
            className={cn(
              "h-1.5 flex-1 rounded-full",
              i + 1 <= step ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Step {step} of 7
      </p>
      <h1 className="mb-6 text-xl font-semibold">{STEP_TITLES[step - 1]}</h1>

      {step === 1 && (
        <BusinessDetailsStep tenantId={tenantId} onSaved={next} />
      )}
      {step === 2 && <LocationHoursStep tenantId={tenantId} onSaved={next} />}
      {step === 3 && (
        <ComingLaterStep
          title="Products"
          description="Add your product catalog from Settings once you're ready — manual entry or bulk upload."
          onSkip={next}
        />
      )}
      {step === 4 && (
        <ComingLaterStep
          title="Import historical sales"
          description="Bring in past sales from a spreadsheet later, from Settings → Data & Imports."
          onSkip={next}
        />
      )}
      {step === 5 && (
        <ComingLaterStep
          title="Invite your team"
          description="Invite staff and assign roles from Settings → Users whenever you're ready."
          onSkip={next}
        />
      )}
      {step === 6 && (
        <ComingLaterStep
          title="Subscription"
          description="Your free trial is active. Manage billing anytime from Settings → Billing."
          onSkip={next}
        />
      )}
      {step === 7 && (
        <FinishStep tenantSlug={tenantSlug} tenantName={tenantName} />
      )}
    </div>
  );
}
