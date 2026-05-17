// Integration test: ADP MCP tools against the live integration-test-harness.
// Runs only when HARNESS_E2E=1 is set — skipped during normal `pnpm test`.
// Requires the harness reachable at $HARNESS_URL (default: http://localhost:8700).
//
// CI brings up: docker compose --profile integration-test up -d --wait integration-test-harness
// then invokes: HARNESS_E2E=1 pnpm --filter dpf-adp-mcp test
//
// The credential layer (getActiveCredential, recordToolCall) is mocked so no
// Postgres is needed for this test. adpGet makes real HTTP calls to the harness.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AdpApiError } from "../lib/adp-client.js";
import { getDeductions } from "../tools/get-deductions.js";
import { getPayStatements } from "../tools/get-pay-statements.js";
import { getTimeCards } from "../tools/get-time-cards.js";
import { listWorkers } from "../tools/list-workers.js";

// Mirror the pattern from list-workers.test.ts: mock only the DB and creds
// layers so the real adpGet code path runs against the harness.
vi.mock("../lib/creds.js", async () => {
  const actual = await vi.importActual<typeof import("../lib/creds.js")>("../lib/creds.js");
  return {
    ...actual,
    getActiveCredential: vi.fn(),
    recordToolCall: vi.fn(async () => {}),
  };
});

vi.mock("../lib/db.js", () => ({
  getSql: () => ({} as unknown),
  setSqlForTesting: () => {},
}));

import { getActiveCredential } from "../lib/creds.js";

// ─── Guard ───────────────────────────────────────────────────────────────────

const HARNESS_E2E = process.env.HARNESS_E2E === "1";
const HARNESS_URL = (process.env.HARNESS_URL ?? "http://localhost:8700").replace(/\/$/, "");
const CONTROL_TOKEN = process.env.HARNESS_CONTROL_TOKEN ?? "integration-test-token";

// ─── Shared test fixtures ─────────────────────────────────────────────────────

const FAKE_CREDENTIAL = {
  id: "harness-cred-1",
  environment: "sandbox" as const,
  // Pre-set the bearer token that the happy-path fixture expects.
  accessToken: "harness-token-123",
  certPem: "cert",
  privateKeyPem: "key",
};

const CTX = { coworkerId: "harness-e2e-coworker", userId: null };

// ─── Control API helper ───────────────────────────────────────────────────────

async function flipScenario(sessionId: string, scenario: string): Promise<void> {
  const res = await fetch(`${HARNESS_URL}/__control/scenario/adp/${scenario}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-dpf-control-token": CONTROL_TOKEN,
    },
    body: JSON.stringify({ sessionId }),
  });
  if (!res.ok) {
    throw new Error(`Scenario flip to '${scenario}' failed: ${res.status} ${await res.text()}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!HARNESS_E2E)("ADP MCP tools e2e (integration-test-harness)", () => {
  // Capture originals before any beforeAll runs.
  const originalApiBaseUrl = process.env.ADP_API_BASE_URL;
  const originalSessionId = process.env.DPF_INTEGRATION_TEST_SESSION_ID;

  // Unique per test run — prevents session state collisions between parallel CI jobs.
  const sessionId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  beforeAll(() => {
    process.env.ADP_API_BASE_URL = HARNESS_URL;
    process.env.DPF_INTEGRATION_TEST_SESSION_ID = sessionId;
    vi.mocked(getActiveCredential).mockResolvedValue(FAKE_CREDENTIAL);
  });

  afterAll(() => {
    if (originalApiBaseUrl === undefined) {
      delete process.env.ADP_API_BASE_URL;
    } else {
      process.env.ADP_API_BASE_URL = originalApiBaseUrl;
    }
    if (originalSessionId === undefined) {
      delete process.env.DPF_INTEGRATION_TEST_SESSION_ID;
    } else {
      process.env.DPF_INTEGRATION_TEST_SESSION_ID = originalSessionId;
    }
  });

  // Reset harness to happy-path after every test so failure scenarios don't leak.
  afterEach(async () => {
    await flipScenario(sessionId, "happy-path");
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  describe("happy path", () => {
    it("list-workers: returns contract-shaped workers with correct field mapping", async () => {
      const result = await listWorkers({}, CTX);

      expect(result.workers).toHaveLength(1);
      const w = result.workers[0];
      expect(w?.displayName).toBe("Jane Doe");
      expect(w?.employeeNumber).toBe("EMP0042");
      expect(w?.associateOID).toBe("G3QZ9WB3KH1234567");
      expect(w?.positionTitle).toBe("Senior Engineer");
      expect(w?.hireDate).toBe("2020-03-15");
      expect(w?.status).toBe("Active");
      expect(result.suspiciousContentDetected).toBe(false);
      expect(result.nextSkip).toBeNull(); // one result < default top=50
    });

    it("get-pay-statements: returns contract-shaped statements", async () => {
      const result = await getPayStatements(
        { workerId: "EMP0042", fromDate: "2026-01-01", toDate: "2026-12-31" },
        CTX,
      );

      expect(result.payStatements).toHaveLength(1);
      const s = result.payStatements[0];
      expect(s?.statementId).toBe("PS-2026-0401");
      expect(s?.payDate).toBe("2026-04-15");
      expect(s?.grossPay).toBe(4500);
      expect(s?.netPay).toBeCloseTo(3187.4, 1);
      expect(s?.currency).toBe("USD");
      expect(result.suspiciousContentDetected).toBe(false);
      expect(result.nextCursor).toBeNull();
    });

    it("get-time-cards: returns contract-shaped time cards with entries", async () => {
      const result = await getTimeCards(
        { workerId: "EMP0042", payPeriodStart: "2026-04-06", payPeriodEnd: "2026-04-12" },
        CTX,
      );

      expect(result.timeCards).toHaveLength(1);
      const tc = result.timeCards[0];
      expect(tc?.timeCardId).toBe("TC-2026-W15-EMP0042");
      expect(tc?.payPeriodStart).toBe("2026-04-06");
      expect(tc?.payPeriodEnd).toBe("2026-04-12");
      expect(tc?.totalHours).toBe(42.5);
      expect(tc?.entries).toHaveLength(1);
      expect(tc?.entries[0]?.date).toBe("2026-04-06");
      expect(tc?.entries[0]?.hoursWorked).toBe(8.5);
      expect(tc?.entries[0]?.positionCode).toBe("ENG-SR");
      expect(result.suspiciousContentDetected).toBe(false);
    });

    it("get-deductions: returns contract-shaped deductions", async () => {
      const result = await getDeductions({ workerId: "EMP0042" }, CTX);

      expect(result.deductions).toHaveLength(1);
      const d = result.deductions[0];
      expect(d?.deductionId).toBe("DED-HEALTH-EMP0042");
      expect(d?.code).toBe("HEALTH");
      expect(d?.shortName).toBe("Medical");
      expect(d?.description).toBe("BCBS PPO family plan");
      expect(d?.amount).toBe(280);
      expect(d?.currency).toBe("USD");
      expect(d?.frequency).toBe("biweekly");
      expect(result.suspiciousContentDetected).toBe(false);
    });
  });

  // ── Scenario: rate-limited ──────────────────────────────────────────────────

  describe("scenario: rate-limited", () => {
    beforeEach(async () => {
      await flipScenario(sessionId, "rate-limited");
    });

    it("list-workers: throws AdpApiError(RATE_LIMITED) on 429", async () => {
      await expect(listWorkers({}, CTX)).rejects.toMatchObject({
        name: "AdpApiError",
        code: "RATE_LIMITED",
      });
    });

    it("get-pay-statements: throws AdpApiError(RATE_LIMITED) on 429", async () => {
      await expect(
        getPayStatements({ workerId: "EMP0042", fromDate: "2026-01-01", toDate: "2026-12-31" }, CTX),
      ).rejects.toMatchObject({ name: "AdpApiError", code: "RATE_LIMITED" });
    });

    it("get-time-cards: throws AdpApiError(RATE_LIMITED) on 429", async () => {
      await expect(
        getTimeCards(
          { workerId: "EMP0042", payPeriodStart: "2026-04-06", payPeriodEnd: "2026-04-12" },
          CTX,
        ),
      ).rejects.toMatchObject({ name: "AdpApiError", code: "RATE_LIMITED" });
    });

    it("get-deductions: throws AdpApiError(RATE_LIMITED) on 429", async () => {
      await expect(getDeductions({ workerId: "EMP0042" }, CTX)).rejects.toMatchObject({
        name: "AdpApiError",
        code: "RATE_LIMITED",
      });
    });
  });

  // ── Scenario: auth-failure ──────────────────────────────────────────────────

  describe("scenario: auth-failure", () => {
    beforeEach(async () => {
      await flipScenario(sessionId, "auth-failure");
    });

    it("list-workers: throws AdpApiError(AUTH_FAILED) on 401", async () => {
      await expect(listWorkers({}, CTX)).rejects.toMatchObject({
        name: "AdpApiError",
        code: "AUTH_FAILED",
      });
    });

    it("get-deductions: throws AdpApiError(AUTH_FAILED) on 401", async () => {
      await expect(getDeductions({ workerId: "EMP0042" }, CTX)).rejects.toMatchObject({
        name: "AdpApiError",
        code: "AUTH_FAILED",
      });
    });
  });

  // ── X-DPF-Harness-Session forwarding ───────────────────────────────────────

  describe("session header forwarding", () => {
    it("scenario flip applies only to the scoped session — proves X-DPF-Harness-Session is forwarded", async () => {
      // Rate-limit a different session; our session must still return happy-path.
      const otherSession = `other-${Date.now()}`;
      await flipScenario(otherSession, "rate-limited");

      // Our session (sessionId) is still on happy-path — proves the header is forwarded.
      const result = await listWorkers({}, CTX);
      expect(result.workers).toHaveLength(1);
      expect(result.workers[0]?.displayName).toBe("Jane Doe");

      // Confirm the other session gets 429 via a direct fetch using that session header.
      const probeRes = await fetch(`${HARNESS_URL}/hr/v2/workers`, {
        headers: {
          authorization: "Bearer harness-token-123",
          "x-dpf-harness-session": otherSession,
        },
      });
      expect(probeRes.status).toBe(429);

      // Clean up the other session.
      await flipScenario(otherSession, "happy-path");
    });
  });
});

// Suppress unused-import lint warnings — these are imported for their type-level side effects.
void AdpApiError;
