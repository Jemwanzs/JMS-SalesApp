"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { LocationSummary } from "@/services/LocationService";

/**
 * Multi-Branch User Access Phase 3 -- shared between InviteUserDialog
 * and UserList's per-user branch editor, so both pick branches the
 * same way. Deliberately never rendered at all for a single-branch
 * tenant (the only caller-side gate this needs -- see both call
 * sites), so nobody who's never added a second branch ever sees a
 * "which branch" question at all.
 *
 * `value: null` means "All branches" (every branch the tenant
 * currently has, and any added later -- see UserService.listUsers'
 * own header comment on the null-location convention). Only switching
 * to "Specific branches" reveals the checkbox list; unchecking every
 * box there is deliberately not the same as `null` -- it's an
 * (invalid, blocked by the caller) empty specific set, not "all."
 */
export function BranchAssignmentField({
  locations,
  value,
  onChange,
}: {
  locations: LocationSummary[];
  value: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const isAllBranches = value === null;

  return (
    <div className="space-y-2">
      <Label className="font-normal text-muted-foreground">Branches</Label>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="branch-mode"
            checked={isAllBranches}
            onChange={() => onChange(null)}
          />
          All branches
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="branch-mode"
            checked={!isAllBranches}
            onChange={() => onChange([])}
          />
          Specific branches
        </label>
      </div>

      {!isAllBranches && (
        <div className="space-y-1.5 rounded-lg border p-3">
          {locations.map((location) => {
            const checked = value?.includes(location.id) ?? false;
            return (
              <label key={location.id} className="flex items-center gap-2 py-1 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(next) => {
                    const set = new Set(value ?? []);
                    if (next) {
                      set.add(location.id);
                    } else {
                      set.delete(location.id);
                    }
                    onChange([...set]);
                  }}
                />
                {location.name}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
