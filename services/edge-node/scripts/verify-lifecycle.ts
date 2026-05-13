#!/usr/bin/env -S pnpm exec tsx
/**
 * Edge Node end-to-end lifecycle verification.
 *
 * Exercises the spec's reference flow against a real running
 * Authority Core:
 *
 *   1. enroll → returns nodeId + plaintext nodeToken
 *   2. heartbeat → returns intervals + acceptedCapabilities
 *   3. discovery-runs submit → returns 201 + persistence summary
 *   4. discovery-runs idempotent replay → returns 200 + idempotentReplay
 *   5. discovery-runs stale_observation rejection (boundary test)
 *   6. discovery-runs rate limit (4/min ceiling)
 *
 * Run after an operator has:
 *   - Started the platform (e.g. `dpf-start`)
 *   - Issued a bootstrap token via Admin > Platform Development >
 *     Edge Nodes (or the issueEdgeBootstrapTokenAction surface)
 *   - Set DPF_AUTHORITY_URL + DPF_BOOTSTRAP_TOKEN
 *
 * Exits 0 on full lifecycle pass; non-zero with a clear error
 * message on any assertion failure. Designed to be wired into CI's
 * install-verification workflow as an additional step after the
 * /api/health gate.
 *
 * Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
 *   § Enrollment, rotation, and lifecycle
 *   § Ingestion contract
 *   § REST ingestion controls (Phase 0)
 */

import { randomUUID } from "node:crypto";
import { request as undiciRequest, type Dispatcher } from "undici";

type Json = Record<string, unknown>;

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    fatal(`required env var ${name} is not set`);
  }
  return v;
}

const AUTHORITY_URL = env("DPF_AUTHORITY_URL", "http://localhost:3000").replace(/\/$/, "");
const BOOTSTRAP_TOKEN = env("DPF_BOOTSTRAP_TOKEN");
const NODE_DISPLAY_NAME = env(
  "DPF_VERIFY_NODE_NAME",
  `verify-lifecycle-${new Date().toISOString().slice(0, 16)}`,
);

let pass = 0;
let fail = 0;

function step(label: string): void {
  console.log(`\n→ ${label}`);
}

function ok(label: string): void {
  pass++;
  console.log(`  [ok]   ${label}`);
}

function bad(label: string, detail?: string): void {
  fail++;
  console.log(`  [FAIL] ${label}${detail ? `: ${detail}` : ""}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}\n`);
  process.exit(2);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual === expected) {
    ok(`${label} = ${JSON.stringify(actual)}`);
  } else {
    bad(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertTrue(condition: boolean, label: string, detail?: string): void {
  if (condition) ok(label);
  else bad(label, detail);
}

async function call(
  method: "POST",
  path: string,
  body: Json,
  bearer?: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Json; headers: Dispatcher.ResponseData["headers"] }> {
  const url = `${AUTHORITY_URL}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extraHeaders,
  };
  if (bearer) headers["Authorization"] = `Bearer ${bearer}`;
  const response = await undiciRequest(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.body.text();
  let parsed: Json = {};
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as Json;
    } catch {
      parsed = { _raw: text };
    }
  }
  return { status: response.statusCode, body: parsed, headers: response.headers };
}

// ── Lifecycle phases ───────────────────────────────────────────────────────

async function phaseEnroll(): Promise<{ nodeId: string; nodeToken: string; trustState: string }> {
  step("Phase 1 — POST /api/v1/edge/enroll");
  const result = await call(
    "POST",
    "/api/v1/edge/enroll",
    {
      displayName: NODE_DISPLAY_NAME,
      platform: "linux",
      installMode: "container-host",
      version: "0.0.0-verify",
      advertisedCapabilities: ["discovery.network"],
      metadata: { source: "verify-lifecycle.ts", runId: randomUUID() },
    },
    BOOTSTRAP_TOKEN,
  );
  assertEqual(result.status, 200, "enroll status");
  assertTrue(typeof result.body.nodeId === "string" && (result.body.nodeId as string).startsWith("edge_"), "nodeId looks like edge_<hex>", JSON.stringify(result.body.nodeId));
  assertTrue(typeof result.body.nodeToken === "string" && (result.body.nodeToken as string).startsWith("dpfedge_"), "nodeToken has dpfedge_ prefix");
  assertTrue(["pending", "trusted"].includes(result.body.trustState as string), "trustState is pending|trusted");
  assertTrue(Array.isArray(result.body.acceptedCapabilities) && (result.body.acceptedCapabilities as unknown[]).includes("discovery.network"), "acceptedCapabilities contains discovery.network");
  if (typeof result.body.nodeId !== "string" || typeof result.body.nodeToken !== "string") {
    fatal("enroll did not return nodeId + nodeToken; cannot proceed");
  }
  return {
    nodeId: result.body.nodeId as string,
    nodeToken: result.body.nodeToken as string,
    trustState: result.body.trustState as string,
  };
}

async function phaseHeartbeat(nodeToken: string, expectedTrustState: string): Promise<void> {
  step("Phase 2 — POST /api/v1/edge/heartbeat");
  const result = await call(
    "POST",
    "/api/v1/edge/heartbeat",
    { capabilityReports: [{ capability: "discovery.network", status: "healthy" }] },
    nodeToken,
  );
  assertEqual(result.status, 200, "heartbeat status");
  assertEqual(result.body.trustState, expectedTrustState, "heartbeat preserves trustState");
  assertTrue(typeof result.body.heartbeatIntervalSec === "number" && (result.body.heartbeatIntervalSec as number) > 0, "heartbeatIntervalSec positive");
  assertTrue(Array.isArray(result.body.acceptedCapabilities), "acceptedCapabilities is array");
}

function makeObservation(suffix: string): Json {
  return {
    runKey: `verify-${suffix}-${randomUUID()}`,
    agentMode: "container-host",
    agentVersion: "0.0.0-verify",
    observedAt: new Date().toISOString(),
    capabilities: ["discovery.network"],
    items: [
      {
        observedKey: `verify:host:${suffix}`,
        itemType: "host",
        name: `verify-host-${suffix}`,
        rawData: { kernel: "test-kernel-1.0", from: "verify-lifecycle.ts" },
      },
    ],
    relationships: [],
  };
}

async function phaseSubmit(nodeToken: string): Promise<{ runKey: string; runId: string }> {
  step("Phase 3 — POST /api/v1/edge/discovery-runs (first submission)");
  const body = makeObservation("first") as Json & { runKey: string };
  const result = await call("POST", "/api/v1/edge/discovery-runs", body, nodeToken);

  if (result.status === 401 && result.body.error === "node_quarantined") {
    fatal("node is quarantined — cannot submit. Approve the node from Admin > Edge Nodes first.");
  }
  if (result.status === 401 && (result.body.error as string)?.startsWith("scope_")) {
    fatal("node lacks discovery:submit scope. Approve the node (trust state must be `trusted`) first.");
  }
  if (result.status === 401 && (result.body.error as string) === "missing_scope") {
    fatal("node lacks discovery:submit scope (likely still in trustState=pending). Approve via Admin > Edge Nodes.");
  }

  assertEqual(result.status, 201, "submit status (first)");
  assertEqual(result.body.accepted, true, "accepted: true");
  assertTrue(typeof result.body.runId === "string", "runId returned");
  assertEqual((result.body.persisted as Json)?.createdEntities, 1, "createdEntities = 1");
  return {
    runKey: body.runKey,
    runId: result.body.runId as string,
  };
}

async function phaseIdempotentReplay(nodeToken: string, runKey: string, priorRunId: string): Promise<void> {
  step("Phase 4 — POST /api/v1/edge/discovery-runs (same runKey → idempotent replay)");
  const body = { ...makeObservation("replay"), runKey };
  const result = await call("POST", "/api/v1/edge/discovery-runs", body, nodeToken);
  assertEqual(result.status, 200, "replay status (200, not 201)");
  assertEqual(result.body.idempotentReplay, true, "idempotentReplay: true");
  assertEqual(result.body.runId, priorRunId, "runId matches prior submission");
}

async function phaseStaleObservation(nodeToken: string): Promise<void> {
  step("Phase 5 — POST /api/v1/edge/discovery-runs (stale_observation, > 24h past)");
  const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
  const body = { ...makeObservation("stale"), observedAt: stale };
  const result = await call("POST", "/api/v1/edge/discovery-runs", body, nodeToken);
  assertEqual(result.status, 400, "stale status");
  assertEqual(result.body.error, "stale_observation", "stale error code");
}

async function phaseRateLimit(nodeToken: string): Promise<void> {
  step("Phase 6 — POST /api/v1/edge/discovery-runs (4/min rate limit)");
  // Burn the 4/min ceiling fast. Each submission uses a unique runKey
  // so idempotent replay doesn't mask the rate-limit response.
  let rateLimitedHit = false;
  let lastStatus = 0;
  for (let i = 0; i < 8; i++) {
    const body = makeObservation(`burst-${i}`);
    const result = await call("POST", "/api/v1/edge/discovery-runs", body, nodeToken);
    lastStatus = result.status;
    if (result.status === 429) {
      assertEqual(result.body.error, "rate_limited", "rate_limited error on 429");
      assertTrue(typeof result.body.retryAfter === "number" && (result.body.retryAfter as number) > 0, "retryAfter present + positive");
      const retryAfterHeader = result.headers["retry-after"];
      assertTrue(retryAfterHeader != null, "Retry-After header present");
      rateLimitedHit = true;
      break;
    }
  }
  assertTrue(rateLimitedHit, "rate limit fires within 8 rapid submissions", `last status was ${lastStatus}`);
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`DPF Edge Node lifecycle verification`);
  console.log(`  authority: ${AUTHORITY_URL}`);
  console.log(`  display name: ${NODE_DISPLAY_NAME}`);
  console.log(`  bootstrap token prefix: ${BOOTSTRAP_TOKEN.slice(0, 12)}...`);

  const { nodeId, nodeToken, trustState } = await phaseEnroll();
  console.log(`\n  enrolled as ${nodeId} (trustState=${trustState})`);

  await phaseHeartbeat(nodeToken, trustState);

  if (trustState !== "trusted") {
    console.log(
      `\nWARNING: node trustState is ${trustState}; the discovery-runs submission will fail until\n` +
      "the operator approves the node via Admin > Edge Nodes. Pausing phases 3-6.",
    );
    console.log(`\nResults: ${pass} passed, ${fail} failed (partial run; node needs approval)`);
    process.exit(fail > 0 ? 1 : 0);
  }

  const { runKey, runId } = await phaseSubmit(nodeToken);
  await phaseIdempotentReplay(nodeToken, runKey, runId);
  await phaseStaleObservation(nodeToken);
  await phaseRateLimit(nodeToken);

  console.log(`\nResults: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\nUNEXPECTED ERROR during verification:", err);
  process.exit(2);
});
