import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Thin wrapper around Paystack's REST API + webhook signature
 * verification (docs/14-billing-paystack.md). `server-only` since it
 * reads `PAYSTACK_SECRET_KEY` -- never bundled into client code.
 *
 * Paystack has no separate "webhook signing secret" the way some
 * providers do: the `x-paystack-signature` header is an HMAC-SHA512 of
 * the raw request body, signed with the SAME secret key used for API
 * calls (see verifyPaystackSignature).
 */
const PAYSTACK_API_BASE = "https://api.paystack.co";

function secretKey(): string {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) {
    throw new Error("PAYSTACK_SECRET_KEY is not configured");
  }
  return key;
}

export interface InitializeTransactionInput {
  email: string;
  /** Major currency units (e.g. 2500.00) -- converted to Paystack's minor-unit integer internally. */
  amount: number;
  currency: string;
  reference: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export interface InitializeTransactionResult {
  authorizationUrl: string;
  accessCode: string;
  reference: string;
}

export async function initializeTransaction(
  input: InitializeTransactionInput
): Promise<InitializeTransactionResult> {
  const res = await fetch(`${PAYSTACK_API_BASE}/transaction/initialize`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: input.email,
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      reference: input.reference,
      callback_url: input.callbackUrl,
      metadata: input.metadata ?? {},
    }),
  });

  const body = await res.json();

  if (!res.ok || !body.status) {
    throw new Error(`Paystack initializeTransaction: ${body.message ?? res.statusText}`);
  }

  return {
    authorizationUrl: body.data.authorization_url,
    accessCode: body.data.access_code,
    reference: body.data.reference,
  };
}

/**
 * Verifies the `x-paystack-signature` header against the RAW request
 * body (must be the exact bytes Paystack sent, not a re-serialized
 * JSON.parse().JSON.stringify() round-trip, or the hash won't match).
 * `timingSafeEqual` over a constant-length hex digest avoids a timing
 * side-channel on the comparison itself.
 */
export function verifyPaystackSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac("sha512", secretKey()).update(rawBody).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;

  return timingSafeEqual(expectedBuf, actualBuf);
}
