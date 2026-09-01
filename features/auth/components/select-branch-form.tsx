"use client";

import { useState, useTransition } from "react";
import { MapPin } from "lucide-react";

import { selectBranchAction } from "@/features/auth/actions/select-branch";
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
