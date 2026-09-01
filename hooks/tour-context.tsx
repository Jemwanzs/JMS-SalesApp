"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { completeTourAction } from "@/features/onboarding/actions/complete-tour";
import { TOUR_STEPS, type TourStep } from "@/features/onboarding/tour-steps";
import { usePermission, useTenant } from "@/hooks/tenant-context";

const SESSION_STORAGE_KEY = "jms_tour_step_index";

/**
 * Which steps a given viewer actually gets shown -- a step is omitted
 * entirely (never shown-then-blocked) when the viewer lacks the
 * permission/entitlement it needs. Every step's own permission check
 * has to be a real hook call, not a lookup keyed by a string on the
 * step object, so this lives here (a client component already inside
 * TenantProvider) rather than on the static tour-steps.ts data.
 */
function useVisibleSteps(): TourStep[] {
  const { inventoryEnabled } = useTenant();
  const canManageSettings = usePermission("settings.manage");
  const canCreateProducts = usePermission("products.create");
  const canEditProducts = usePermission("products.edit");
  const canRecordSales = usePermission("sales.create");
  const canViewInventory = usePermission("inventory.view");
  const canViewAnalytics = usePermission("analytics.view_own");
  const canViewReports = usePermission("reports.view");

  const gates: Record<string, boolean> = {
    welcome: true,
    business: canManageSettings,
    branch: canManageSettings,
    products: canCreateProducts || canEditProducts,
    sale: canRecordSales,
    stock: canViewInventory && inventoryEnabled,
    analytics: canViewAnalytics,
    reports: canViewReports,
    finish: true,
  };

  return TOUR_STEPS.filter((step) => gates[step.id]);
}

export interface TourContextValue {
  isActive: boolean;
  currentStep: TourStep | null;
  stepNumber: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  next: () => void;
  back: () => void;
  skip: () => void;
  finish: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({
  tenantSlug,
  tourCompleted,
  children,
}: {
  tenantSlug: string;
  tourCompleted: boolean;
  children: React.ReactNode;
}) {
  const steps = useVisibleSteps();
  const searchParams = useSearchParams();
  const restartRequested = searchParams.get("restartTour") === "1";

  const [isActive, setIsActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  // Auto-starts once per mount: a never-completed profile lands here
  // and resumes wherever sessionStorage last left off (protects
  // against a hard reload mid-tour -- plain client-navigation state
  // already survives on its own, since TourProvider lives above every
  // dashboard route and never remounts between them).
  useEffect(() => {
    if (!tourCompleted) {
      const stored = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
      const resumeIndex = stored ? Number(stored) : 0;
      setStepIndex(Number.isFinite(resumeIndex) ? resumeIndex : 0);
      setIsActive(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate from the mount-only effect above: a Restart Tour link
  // (More menu / Help & Support) is a normal in-app navigation, so
  // TourProvider does NOT remount for it -- this has to react to
  // restartRequested actually changing, not just run once.
  useEffect(() => {
    if (!restartRequested) {
      return;
    }
    setStepIndex(0);
    setIsActive(true);
    const url = new URL(window.location.href);
    url.searchParams.delete("restartTour");
    window.history.replaceState({}, "", url.toString());
  }, [restartRequested]);

  useEffect(() => {
    if (isActive) {
      window.sessionStorage.setItem(SESSION_STORAGE_KEY, String(stepIndex));
    }
  }, [isActive, stepIndex]);

  function end() {
    setIsActive(false);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    completeTourAction(tenantSlug).catch(() => {});
  }

  const clampedIndex = Math.min(stepIndex, steps.length - 1);
  const currentStep = isActive ? (steps[clampedIndex] ?? null) : null;

  const value: TourContextValue = {
    isActive,
    currentStep,
    stepNumber: clampedIndex + 1,
    totalSteps: steps.length,
    isFirstStep: clampedIndex === 0,
    isLastStep: clampedIndex === steps.length - 1,
    next: () => setStepIndex((i) => Math.min(i + 1, steps.length - 1)),
    back: () => setStepIndex((i) => Math.max(i - 1, 0)),
    skip: end,
    finish: end,
  };

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) {
    throw new Error("useTour must be used within a TourProvider");
  }
  return ctx;
}
