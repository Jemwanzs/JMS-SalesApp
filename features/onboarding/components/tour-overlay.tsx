"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";

import { Popover, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useTenant } from "@/hooks/tenant-context";
import { useTour } from "@/hooks/tour-context";

const ANCHOR_RETRY_MS = 150;
const ANCHOR_MAX_ATTEMPTS = 20; // ~3s -- covers client-hydration + a same-page navigation's own render

/**
 * Mounted once in (dashboard)/layout.tsx so it survives every in-tour
 * page change (the layout tree isn't torn down between dashboard
 * routes) -- see hooks/tour-context.tsx's own header comment. Steps
 * with a `route` different from the current page show a transitional
 * "take me there" card instead of trying to anchor to an element that
 * isn't on the page yet.
 */
export function TourOverlay() {
  const { tenantSlug } = useTenant();
  const { isActive, currentStep, stepNumber, totalSteps, isFirstStep, isLastStep, next, back, skip, finish } = useTour();
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations("Tour");

  const [anchorEl, setAnchorEl] = useState<Element | null>(null);

  const targetRoute = currentStep?.route(tenantSlug) ?? null;
  const needsNavigation = targetRoute !== null && pathname !== targetRoute;

  useEffect(() => {
    setAnchorEl(null);
    if (!currentStep?.anchorSelectors || needsNavigation) {
      return;
    }

    let attempts = 0;
    let cancelled = false;

    function tryFind() {
      if (cancelled) return;
      for (const selector of currentStep!.anchorSelectors!) {
        const el = document.querySelector(selector);
        if (el) {
          setAnchorEl(el);
          return;
        }
      }
      attempts += 1;
      if (attempts < ANCHOR_MAX_ATTEMPTS) {
        window.setTimeout(tryFind, ANCHOR_RETRY_MS);
      }
    }

    tryFind();
    return () => {
      cancelled = true;
    };
  }, [currentStep, needsNavigation]);

  if (!isActive || !currentStep) {
    return null;
  }

  const title = t(currentStep.titleKey);
  const body = t(currentStep.bodyKey);

  const footer = (
    <div className="mt-4 flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{t("stepOf", { current: stepNumber, total: totalSteps })}</span>
      <div className="flex gap-2">
        {!isFirstStep && (
          <Button variant="outline" size="sm" onClick={back}>
            {t("back")}
          </Button>
        )}
        {isLastStep ? (
          <Button size="sm" onClick={finish}>
            {t("finish")}
          </Button>
        ) : (
          <Button size="sm" onClick={next}>
            {t("next")}
          </Button>
        )}
      </div>
    </div>
  );

  const closeButton = (
    <button
      type="button"
      aria-label={t("skip")}
      onClick={skip}
      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
    >
      <X className="h-4 w-4" />
    </button>
  );

  // No anchor needed at all (welcome/finish), or the tour needs to
  // navigate the user to a different page first -- both render as a
  // centered card rather than a positioned popover.
  if (!currentStep.anchorSelectors || needsNavigation) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
        <div className="relative w-full max-w-[340px] rounded-xl bg-popover p-4 text-sm text-popover-foreground shadow-xl ring-1 ring-foreground/10">
          {closeButton}
          <p className="pr-6 font-medium">{title}</p>
          <p className="mt-1 text-muted-foreground">{body}</p>
          {needsNavigation ? (
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">{t("stepOf", { current: stepNumber, total: totalSteps })}</span>
              <div className="flex gap-2">
                {!isFirstStep && (
                  <Button variant="outline" size="sm" onClick={back}>
                    {t("back")}
                  </Button>
                )}
                <Button size="sm" onClick={() => router.push(targetRoute!)}>
                  {t("takeMeThere")}
                </Button>
              </div>
            </div>
          ) : (
            footer
          )}
        </div>
      </div>
    );
  }

  // Anchor selector(s) given, but not found in the DOM yet (still
  // hydrating) -- render nothing rather than a dangling popover with
  // no anchor; the retry loop above will pick it up within ~3s.
  if (!anchorEl) {
    return null;
  }

  return (
    <Popover open modal={false} onOpenChange={(open) => !open && skip()}>
      <PopoverContent anchor={anchorEl} className="relative">
        {closeButton}
        <p className="pr-6 font-medium">{title}</p>
        <p className="mt-1 text-muted-foreground">{body}</p>
        {footer}
      </PopoverContent>
    </Popover>
  );
}
