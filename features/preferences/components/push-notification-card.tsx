"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { subscribePushAction } from "@/features/preferences/actions/subscribe-push";
import { unsubscribePushAction } from "@/features/preferences/actions/unsubscribe-push";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** The Push API wants the VAPID public key as a raw Uint8Array, not the
 * base64url string it's distributed as -- standard conversion, no
 * library needed for it. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

type SupportState = "checking" | "unsupported" | "supported";

/**
 * Web Push (Feature 3) -- personal, per-device, not tenant-scoped (same
 * "per-profile column/preference" convention as FontPreferenceCard/
 * LanguagePreferenceCard). Resolves its own subscribed state client-side
 * via registration.pushManager.getSubscription() on mount rather than a
 * server prop, since "is THIS device subscribed" is inherently a
 * browser-local question a server render can't answer.
 */
export function PushNotificationCard() {
  const [support, setSupport] = useState<SupportState>("checking");
  const [subscribed, setSubscribed] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      setSupport("unsupported");
      return;
    }
    setSupport("supported");

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setSubscribed(!!subscription))
      .catch(() => {});
  }, []);

  function onToggle(next: boolean) {
    startTransition(async () => {
      if (next) {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          toast.error("Notifications were not allowed");
          return;
        }

        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!),
          });
          const json = subscription.toJSON();
          const result = await subscribePushAction({
            endpoint: json.endpoint!,
            p256dh: json.keys!.p256dh,
            auth: json.keys!.auth,
            userAgent: navigator.userAgent,
          });
          if (result.error) {
            toast.error(result.error);
            return;
          }
          setSubscribed(true);
          toast.success("Notifications turned on");
        } catch {
          toast.error("Could not turn on notifications");
        }
      } else {
        try {
          const registration = await navigator.serviceWorker.ready;
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await unsubscribePushAction(endpoint);
          }
          setSubscribed(false);
          toast.success("Notifications turned off");
        } catch {
          toast.error("Could not turn off notifications");
        }
      }
    });
  }

  if (support !== "supported") {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="push-toggle" className="font-normal text-muted-foreground">
            Get notified on this device when your business day closes.
          </Label>
          <Switch id="push-toggle" checked={subscribed} disabled={isPending} onCheckedChange={onToggle} />
        </div>
      </CardContent>
    </Card>
  );
}
