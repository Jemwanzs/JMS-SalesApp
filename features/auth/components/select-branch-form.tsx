"use client";

import { useEffect, useState, useTransition } from "react";
import { MapPin } from "lucide-react";

import { selectBranchAction } from "@/features/auth/actions/select-branch";
import { signOutAction } from "@/features/auth/actions/sign-out";
import { Button } from "@/components/ui/button";
import type { BranchOption } from "@/lib/tenant/resolve-user-branches";

export function SelectBranchForm({
  branches,
  adminBypass,
}: {
  branches: BranchOption[];
  adminBypass?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Choosing a branch is mandatory to reach anywhere in the tenant, so
  // there's no "cancel" affordance here -- the browser's own back button
  // is the only way out, and it lands somewhere broken: /login (now
  // already authenticated) bounces back toward the tenant, which
  // self-heals right back to THIS page since no branch was ever chosen
  // -- a redirect chain triggered by a popstate traversal rather than a
  // normal navigation, which this Next.js build's client router doesn't
  // reliably finish committing (the same class of issue documented for
  // router.push() elsewhere in this app -- confirmed live: a full page
  // reload of any point in that chain resolves correctly every time,
  // only the back-button-triggered client transition goes blank). Rather
  // than chase that framework defect, treat "the user pressed back here"
  // as exactly what it obviously means -- they don't want to pick a
  // branch right now -- and end the incomplete session outright: sign
  // out and force a real (non-client-router) navigation to /login, which
  // is also just a cleaner outcome than leaving them mid-login anyway.
  // A guard entry is pushed on mount so the very first back press is
  // guaranteed to fire this handler instead of the browser silently
  // consuming a history entry the user can't see the effect of.
  useEffect(() => {
    window.history.pushState(null, "", window.location.href);

    function onPopState() {
      signOutAction().catch(() => {});
      window.location.href = "/login";
    }

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) {
      setError("Choose a branch to continue");
      return;
    }
    setError(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.set("locationId", selected);
      if (adminBypass) formData.set("adminBypass", adminBypass);

      const result = await selectBranchAction({}, formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        {branches.map((branch) => {
          const isSelected = selected === branch.id;
          return (
            <label
              key={branch.id}
              className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${
                isSelected ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <input
                type="radio"
                name="branch"
                value={branch.id}
                checked={isSelected}
                onChange={() => setSelected(branch.id)}
                className="sr-only"
              />
              <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{branch.name}</span>
              <span
                className={`h-4 w-4 shrink-0 rounded-full border ${
                  isSelected ? "border-primary bg-primary" : "border-muted-foreground"
                }`}
              />
            </label>
          );
        })}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "Continuing..." : "Continue"}
      </Button>
    </form>
  );
}
