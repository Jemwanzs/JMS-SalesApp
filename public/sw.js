// Minimal service worker: satisfies PWA installability (manifest + HTTPS +
// a registered SW) without implementing an offline caching strategy yet.
// "Offline Sales Capture" is an explicitly deferred future enhancement
// (docs/01-development-roadmap.md, spec S116/S149) -- this is deliberately
// a network-passthrough no-op until that's actually built, not a
// half-finished cache implementation.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op: falls through to normal network handling.
});
