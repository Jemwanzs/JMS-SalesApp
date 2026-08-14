import { createClient } from "@/lib/supabase/server";
import { SalesVisibilityBadge } from "@/features/sales/components/sales-visibility-badge";

/**
 * Capture Sales is the golden-path landing screen (spec S13: "the user's
 * first destination after login shall be Capture Sales, NOT a
 * dashboard"). This is still a placeholder -- greeting, date, and the
 * empty-state pattern from spec S120 -- since the real product grid and
 * sale-recording flow are Phase 2a/2d. Kept honest rather than faked.
 */
export default async function SalesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = user
    ? await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };

  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="flex flex-1 flex-col p-6">
      <p className="text-sm text-muted-foreground">{today}</p>
      <h1 className="mt-1 text-xl font-semibold">Good day, {firstName}</h1>

      <div className="mt-6">
        <SalesVisibilityBadge />
      </div>

      <div className="mt-8 flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center">
        <p className="text-lg font-medium">Today&apos;s Sales</p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">KES 0</p>
        <p className="mt-3 max-w-[26ch] text-sm text-muted-foreground">
          No sales recorded yet. Product capture lands in the next
          development phase.
        </p>
      </div>
    </div>
  );
}
