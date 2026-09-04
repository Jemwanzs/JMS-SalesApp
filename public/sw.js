// Minimal service worker: satisfies PWA installability (manifest + HTTPS +
// a registered SW) without implementing an offline caching strategy yet.
// "Offline Sales Capture" is an explicitly deferred future enhancement
// (docs/01-development-roadmap.md, spec S116/S149) -- fetch handling below
// stays a deliberate network-passthrough no-op until that's actually
// built, not a half-finished cache implementation. Push notifications
// (Web Push, Feature 3) are real, not deferred -- see
// features/preferences/components/push-notification-card.tsx for the
// subscribe/unsubscribe flow this receives events for.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op: falls through to normal network handling.
});

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.svg",
      data: { url: payload.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(url) && "focus" in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(url);
      }
    })
  );
});
