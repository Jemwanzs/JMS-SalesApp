"use client";

import { useState } from "react";
import { Download, PlayCircle } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface DemoVideoOption {
  id: string;
  label: string;
  description: string;
  path: string;
  downloadName: string;
}

// Newest first -- matches the order the two videos were described in.
// "v1" (JMS_App_Demo.mp4) is the newer, freshly recorded walkthrough;
// demo-video-v1.mp4 is the original one produced by the repeatable
// scripts/demo-video/ pipeline (docs/25-demo-video-generation.md) --
// kept, not replaced, since a returning visitor may already have
// shared/bookmarked that link.
const VIDEOS: DemoVideoOption[] = [
  {
    id: "video-01",
    label: "Video 01",
    description: "Latest demo walkthrough",
    path: "/JMS_App_Demo.mp4",
    downloadName: "JMS-Sales-App-Demo-Video-01.mp4",
  },
  {
    id: "video-02",
    label: "Video 02",
    description: "Original demo walkthrough",
    path: "/demo-video-v1.mp4",
    downloadName: "JMS-Sales-App-Demo-Video-02.mp4",
  },
];

/**
 * "Watch: Demo Video" on Login -- used to be a direct-download link to
 * a single video (demo-video-v1.mp4); now opens a picker between that
 * one and a newer recording (JMS_App_Demo.mp4), each with its own
 * Watch/Download actions, rather than always grabbing the older file.
 * "Watch" opens the video in a new tab (the browser's own native
 * player -- no custom in-page player needed, these are already
 * portrait MP4s sized for mobile viewing). No next-intl here: Login
 * sits outside the tenant/platform-admin trees, which are the only
 * ones with a NextIntlClientProvider (see components/ui/dialog.tsx's
 * own header comment on this exact gotcha) -- plain English throughout,
 * matching this file's previous version and UserGuideLink's.
 */
export function DemoVideoLink() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mt-2 flex justify-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#10786A]/25 bg-[#10786A]/8 px-4 py-1.5 text-xs font-semibold text-[#10786A] transition-colors hover:bg-[#10786A]/15"
        >
          <PlayCircle className="h-3.5 w-3.5" />
          Watch: Demo Video
        </button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Demo Videos</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            {VIDEOS.map((video) => (
              <div key={video.id} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{video.label}</p>
                <p className="text-xs text-muted-foreground">{video.description}</p>
                <div className="mt-2 flex gap-2">
                  <a
                    href={video.path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#10786A]/25 bg-[#10786A]/8 px-3 py-1.5 text-xs font-semibold text-[#10786A] transition-colors hover:bg-[#10786A]/15"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    Watch Video
                  </a>
                  <a
                    href={video.path}
                    download={video.downloadName}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download
                  </a>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
