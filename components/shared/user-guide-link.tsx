import { Download } from "lucide-react";

/**
 * "User Guide" download button (spec: Product Enhancements follow-up) --
 * placed on Login and Sign Up only, not the whole shared auth layout,
 * so it doesn't crowd the less first-time-relevant screens (reset
 * password, verify email, invite confirm). Points at the static PDF in
 * public/docs -- see docs/USER_GUIDE.md for the editable source content
 * and scripts/build-user-guide-pdf.mjs for how the PDF itself is
 * generated from it. A plain `download` link needs no client-side
 * interactivity, so this stays a server component.
 */
export function UserGuideLink() {
  return (
    <div className="mt-6 flex justify-center">
      <a
        href="/docs/User-Guide.pdf"
        download="JMS-Sales-App-User-Guide.pdf"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#10786A]/25 bg-[#10786A]/8 px-4 py-1.5 text-xs font-semibold text-[#10786A] transition-colors hover:bg-[#10786A]/15"
      >
        User Guide
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
