// BI-7FBE28A6 — Greenhouse inbound webhook logic (Seam A entry).
//
// Kept as a pure-ish handler so it is unit-testable without a Next request. The
// route (app/api/integrations/greenhouse/inbound/route.ts) is a thin wrapper
// that reads the stored webhook secret and delegates here.
//
// Greenhouse signs the webhook body with HMAC-SHA256 keyed by the configured
// secret, delivered in the `Signature` header. We verify that before parsing,
// then route `hire_candidate` to the idempotent hire landing.

import { createHmac, timingSafeEqual } from "node:crypto";
import { landGreenhouseHire, type GreenhouseHire, type HireLandingClient } from "./land-hire";

export interface VerifySignatureInput {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}

/** Constant-time HMAC-SHA256 verification of the raw body against the header. */
export function verifyGreenhouseSignature({
  rawBody,
  signatureHeader,
  secret,
}: VerifySignatureInput): boolean {
  if (!signatureHeader || !secret) return false;
  const provided = signatureHeader.replace(/^sha256=/i, "").trim();
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface GreenhouseWebhookCandidate {
  id?: number;
  first_name?: string;
  last_name?: string;
  email_addresses?: Array<{ value?: string }>;
  phone_numbers?: Array<{ value?: string }>;
}

interface GreenhouseWebhookBody {
  action?: string;
  payload?: {
    application?: {
      id?: number;
      candidate_id?: number;
      candidate?: GreenhouseWebhookCandidate;
      offer?: { starts_at?: string | null };
    };
    candidate?: GreenhouseWebhookCandidate;
    offer?: { starts_at?: string | null };
  };
}

export interface GreenhouseHireEvent {
  action: string;
  hire: GreenhouseHire | null;
}

/** Extract the action and, for `hire_candidate`, a normalized GreenhouseHire. */
export function parseGreenhouseHireEvent(body: unknown): GreenhouseHireEvent | null {
  if (!body || typeof body !== "object") return null;
  const b = body as GreenhouseWebhookBody;
  const action = typeof b.action === "string" ? b.action : "";
  if (!action) return null;

  if (action !== "hire_candidate") return { action, hire: null };

  const application = b.payload?.application;
  const candidate = application?.candidate ?? b.payload?.candidate;
  if (!candidate?.id) return { action, hire: null };

  const firstName = candidate.first_name?.trim() ?? "";
  const lastName = candidate.last_name?.trim() ?? "";
  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const startDate = application?.offer?.starts_at ?? b.payload?.offer?.starts_at ?? null;

  return {
    action,
    hire: {
      candidateId: String(candidate.id),
      applicationId: application?.id != null ? String(application.id) : null,
      firstName,
      lastName,
      displayName: displayName || `candidate-${candidate.id}`,
      workEmail: candidate.email_addresses?.find((e) => e.value)?.value ?? null,
      phoneWork: candidate.phone_numbers?.find((p) => p.value)?.value ?? null,
      startDate: startDate ?? null,
    },
  };
}

export interface WebhookHandlerInput {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
  db: HireLandingClient;
}

export interface WebhookHandlerResult {
  status: number;
  body: Record<string, unknown>;
}

/** Verify → parse → route. `hire_candidate` lands a hire; other events ack. */
export async function handleGreenhouseWebhook(
  input: WebhookHandlerInput,
): Promise<WebhookHandlerResult> {
  if (!verifyGreenhouseSignature(input)) {
    return { status: 401, body: { error: "invalid_signature" } };
  }

  let json: unknown;
  try {
    json = JSON.parse(input.rawBody);
  } catch {
    return { status: 400, body: { error: "invalid_json" } };
  }

  const event = parseGreenhouseHireEvent(json);
  if (!event) {
    return { status: 400, body: { error: "malformed_payload" } };
  }

  if (event.action === "hire_candidate" && event.hire) {
    const result = await landGreenhouseHire(input.db, event.hire);
    return { status: 200, body: { ok: true, action: event.action, ...result } };
  }

  // Other subscribed events (candidate_stage_change, offer_*) are acknowledged;
  // pipeline-state re-import is handled by the import orchestrator.
  return { status: 200, body: { ok: true, action: event.action, ignored: true } };
}
