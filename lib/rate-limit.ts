import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";

/**
 * Hardening roadmap Phase 4.3 (docs/22-hardening-roadmap.md): general
 * abuse protection on public, unauthenticated endpoints (sign-up,
 * password reset) -- distinct from Phase 2.1's login lockout, which is
 * account-specific and reuses data already in `login_events`. This is
 * IP-based, and needs a real distributed store (a serverless function
 * has no in-memory state that survives between invocations, so an
 * in-process counter would silently do nothing in production), which is
 * genuinely a new external tool -- Upstash Redis, chosen because it's
 * REST-based (no persistent connection, works from Vercel's edge/
 * serverless runtimes) and has a real free tier.
 *
 * Fails OPEN, not closed, when Upstash isn't configured (true until a
 * real account exists): `redis` is null, every limiter below is null,
 * and `checkRateLimit` always allows the request through. The
 * alternative -- failing closed -- would mean sign-up and password
 * reset silently stop working for everyone the moment this file is
 * deployed, before anyone has actually set up the account. Same
 * "safe to ship ahead of the account" posture as Phase 4.1's Sentry
 * integration.
 */
const redis =
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
    ? new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN })
    : null;

function createLimiter(prefix: string, maxRequests: number, window: `${number} ${"s" | "m" | "h" | "d"}`): Ratelimit | null {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(maxRequests, window),
    prefix: `jms-sales-app:ratelimit:${prefix}`,
  });
}

// 5 attempts per hour, per IP -- generous enough for a real user who
// mistypes a field or double-submits, tight enough to stop a scripted
// sweep. Both endpoints share the same shape (a public form, one
// submission is the normal case, no legitimate reason for dozens per
// hour from one address).
export const signUpRateLimit = createLimiter("sign-up", 5, "1 h");
export const passwordResetRateLimit = createLimiter("password-reset", 5, "1 h");

export async function checkRateLimit(limiter: Ratelimit | null, identifier: string): Promise<{ allowed: boolean }> {
  if (!limiter) {
    return { allowed: true };
  }
  const { success } = await limiter.limit(identifier);
  return { allowed: success };
}

/** Same x-forwarded-for/x-real-ip fallback chain sign-in.ts already uses for login_events -- kept here rather than importing from that file, since request-meta there also resolves userAgent, which these two callers don't need. */
export async function getClientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown";
}
