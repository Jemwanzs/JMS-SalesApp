import { Download, PlayCircle } from "lucide-react";

/**
 * "Watch: Demo Video" download button -- Login only, same treatment as
 * UserGuideLink right above it (a static file in public/, no client
 * interactivity needed). Points at the Sales Agent walkthrough produced
 * by scripts/demo-video/ (see docs/25-demo-video-generation.md for how
 * to regenerate it after a UI change) -- a portrait MP4 sized for
 * WhatsApp/mobile sharing, not a page player, since a direct download
 * is what was asked for.
 */
export function DemoVideoLink() {
  return (
    <div className="mt-2 flex justify-center">
      <a
        href="/demo-video-v1.mp4"
        download="JMS-Sales-App-Demo-Video-v1.mp4"
        className="inline-flex items-center gap-1.5 rounded-full border border-[#10786A]/25 bg-[#10786A]/8 px-4 py-1.5 text-xs font-semibold text-[#10786A] transition-colors hover:bg-[#10786A]/15"
      >
        <PlayCircle className="h-3.5 w-3.5" />
        Watch: Demo Video
        <Download className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
