"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Download,
  History,
  Lightbulb,
  MapPinned,
  Sparkles,
  Trophy,
  UserCheck,
  X,
  Zap,
} from "lucide-react";

const VISITS_KEY = "jms_auth_promo_visits";
const AUTO_OPEN_VISITS = 3;

const VALUE_PROPS = [
  { icon: MapPinned, text: "Manage sales from anywhere" },
  { icon: Activity, text: "Real-time sales visibility" },
  { icon: Zap, text: "Instant reports & insights" },
  { icon: Trophy, text: "See your top-performing products" },
  { icon: History, text: "Full historical sales records" },
  { icon: UserCheck, text: "Track employee performance" },
  { icon: Lightbulb, text: "Turn sales data into better decisions" },
];

type Phase = "open" | "closing" | "collapsed";

/**
 * Floating promo poster for Login/Sign Up only (rendered directly in
 * those two page.tsx files, not the shared AuthLayout, so it never
 * shows on reset-password/verify-email/invite-confirm or anywhere
 * inside the authenticated app). Confined to the ~430px mobile-app-fit
 * column via the auth layout's own `contain-layout` (see that file's
 * header comment) -- `fixed` here anchors to that column, not the full
 * browser viewport, on a wide desktop screen.
 *
 * Visit-count logic: increments a localStorage counter once per mount
 * (one per page load, capped so it doesn't grow unbounded). Visits 1-3
 * default to `open`; visit 4 onward defaults to `collapsed`. That's the
 * ONLY thing persisted -- there's no separate "user manually closed it"
 * flag, since the spec's own "does not automatically reopen on every
 * subsequent visit" requirement is already satisfied by the visit count
 * alone (a user who closes it on visit 2 still sees it auto-open on
 * visit 3, matching "visits 1-3 -> opens automatically" literally).
 * Starts as `null` (renders nothing) until the effect resolves the real
 * phase client-side, avoiding an SSR/client mismatch.
 */
export function AuthPromoBanner() {
  const [phase, setPhase] = useState<Phase | null>(null);

  useEffect(() => {
    let visits = 1;
    try {
      const raw = window.localStorage.getItem(VISITS_KEY);
      visits = raw ? Number(raw) + 1 : 1;
      window.localStorage.setItem(VISITS_KEY, String(Math.min(visits, 999)));
    } catch {
      // Private browsing / storage disabled -- fall back to always
      // treating this as a first visit rather than breaking the banner.
    }
    setPhase(visits <= AUTO_OPEN_VISITS ? "open" : "collapsed");
  }, []);

  function close() {
    setPhase("closing");
    window.setTimeout(() => setPhase("collapsed"), 300);
  }

  if (phase === null) return null;

  if (phase === "collapsed") {
    return (
      <button
        type="button"
        aria-label="Show app highlights"
        onClick={() => setPhase("open")}
        className="fixed right-0 top-1/2 z-40 flex h-14 w-10 -translate-y-1/2 items-center justify-center rounded-l-2xl bg-[#0B1220] text-[#F2A65A] shadow-lg transition-all hover:w-12"
      >
        <Sparkles className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35 p-4">
      <div
        className={`relative w-full max-w-[380px] overflow-hidden rounded-3xl bg-[#0B1220] p-6 text-white shadow-2xl transition-all duration-300 ease-out ${
          phase === "closing" ? "translate-x-[130%] opacity-0" : "translate-x-0 opacity-100"
        }`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-[#F2A65A]/15 blur-2xl"
        />

        <button
          type="button"
          aria-label="Close"
          onClick={close}
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <p className="pr-8 text-[10px] font-bold uppercase tracking-[0.14em] text-[#F2A65A]">JMS Sales App</p>
        <h2 className="mt-1 pr-8 text-xl font-bold leading-tight">Run your business from anywhere.</h2>

        <ul className="mt-4 space-y-2.5">
          {VALUE_PROPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-2.5 text-[13px] text-white/85">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#8B5E34]/40 text-[#F2A65A]">
                <Icon className="h-3.5 w-3.5" />
              </span>
              {text}
            </li>
          ))}
        </ul>

        <a
          href="/docs/User-Guide.pdf"
          download="JMS-Sales-App-User-Guide.pdf"
          className="mt-5 flex items-center justify-center gap-1.5 rounded-full border border-[#F2A65A]/40 bg-[#F2A65A]/10 py-2 text-sm font-semibold text-[#F2A65A] transition-colors hover:bg-[#F2A65A]/20"
        >
          User Guide
          <Download className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  );
}
