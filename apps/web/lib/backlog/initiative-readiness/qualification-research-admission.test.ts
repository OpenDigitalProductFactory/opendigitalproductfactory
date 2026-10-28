import { describe, expect, it } from "vitest";

import {
  parseQualificationExperimentBinding,
  validateQualificationExperimentAdmission,
} from "./qualification-research-admission";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const BLOB = "c".repeat(40);
const NOW = new Date("2026-10-28T20:00:00.000Z");

const binding = {
  schemaVersion: 1,
  phase: "prepare",
  itemId: "BI-B3DEC077",
  workroomId: "WC-7036EB63",
  repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory",
  baseSha: SHA_A,
  headSha: SHA_B,
  protocol: {
    path: "docs/superpowers/specs/diagnostic.md",
    commitSha: SHA_B,
    providerBlobId: BLOB,
  },
  installationId: "install-dev",
  accountablePrincipalRef: "principal:owner",
  authorityDecisionId: "AUTH-1",
  permittedTools: ["read_source_at_version", "write_sandbox_file", "run_sandbox_tests", "record_workroom_evidence"],
  allowedPaths: ["apps/web/lib/example.test.ts", "apps/web/lib/example.test-helper.ts"],
  issuedAt: "2026-10-28T19:55:00.000Z",
  expiresAt: "2026-10-28T20:25:00.000Z",
  maxStarts: 1,
  maxDurationMs: 600_000,
} as const;

const context = {
  itemId: binding.itemId,
  workroomId: binding.workroomId,
  repositoryFullName: binding.repositoryFullName,
  baseSha: binding.baseSha,
  headSha: binding.headSha,
  protocol: binding.protocol,
  installationId: binding.installationId,
  accountablePrincipalRef: binding.accountablePrincipalRef,
  authorityDecisionId: binding.authorityDecisionId,
  startCount: 0,
  now: NOW,
};

describe("qualification research admission", () => {
  it("admits one exact bounded preparation without turning it into research PASS", () => {
    const parsed = parseQualificationExperimentBinding(binding);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(validateQualificationExperimentAdmission(parsed.binding, context)).toEqual({
      ok: true,
      binding: parsed.binding,
      researchSatisfied: false,
      ordinaryImplementationAuthorized: false,
    });
  });

  it.each([
    ["item", { itemId: "BI-OTHER" }],
    ["workroom", { workroomId: "WC-OTHER" }],
    ["repository", { repositoryFullName: "other/repo" }],
    ["base", { baseSha: "d".repeat(40) }],
    ["head", { headSha: "d".repeat(40) }],
    ["protocol path", { protocol: { ...binding.protocol, path: "other.md" } }],
    ["protocol blob", { protocol: { ...binding.protocol, providerBlobId: "d".repeat(40) } }],
    ["installation", { installationId: "install-prod" }],
    ["owner", { accountablePrincipalRef: "principal:other" }],
    ["authority", { authorityDecisionId: "AUTH-2" }],
    ["duplicate start", { startCount: 1 }],
    ["expiry", { now: new Date("2026-10-28T20:25:00.001Z") }],
  ])("fails closed when %s changes", (_name, change) => {
    const parsed = parseQualificationExperimentBinding(binding);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(validateQualificationExperimentAdmission(parsed.binding, { ...context, ...change })).toMatchObject({ ok: false });
  });

  it("requires a separately reviewed candidate for final verification", () => {
    const parsed = parseQualificationExperimentBinding({ ...binding, phase: "verify" });
    expect(parsed).toMatchObject({ ok: false, code: "qualification-binding-malformed" });

    const verified = parseQualificationExperimentBinding({
      ...binding,
      phase: "verify",
      candidate: {
        headSha: "d".repeat(40),
        diffDigest: `sha256:${"e".repeat(64)}`,
        testBlobIds: ["f".repeat(40)],
        productionBytesUnchanged: true,
        reviewReceiptId: "review-1",
      },
    });
    expect(verified).toMatchObject({ ok: true });
  });

  it("rejects caller widening and malformed bounds", () => {
    expect(parseQualificationExperimentBinding({ ...binding, permittedTools: [...binding.permittedTools, "deploy_feature"] }))
      .toMatchObject({ ok: false });
    expect(parseQualificationExperimentBinding({ ...binding, maxStarts: 2 })).toMatchObject({ ok: false });
    expect(parseQualificationExperimentBinding({ ...binding, allowedPaths: ["apps/web/lib/production.ts"] }))
      .toMatchObject({ ok: false });
  });
});
