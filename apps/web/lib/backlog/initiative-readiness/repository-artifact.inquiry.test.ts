import { describe, expect, it, vi } from "vitest";
import { resolveRepositoryArtifact } from "./repository-artifact";
import { bytes, locator, capsule, db, providerFetch } from "./repository-artifact.test-fixtures";

describe("immutable source inquiry research", () => {
  it.each(["valid", "wrong-subject", "wrong-path", "revoked", "blob-mismatch", "unsigned", "wrong-author"])(
    "preserves provider and authority checks: %s", async scenario => {
      const isCurrent = vi.fn().mockResolvedValue(true);
      if (scenario === "revoked") isCurrent.mockResolvedValueOnce(true).mockResolvedValue(false);
      const inquiryAdmission = { itemId: scenario === "wrong-subject" ? "BI-OTHER" : "BI-TEST",
        workroomId: "WC-TEST0001", artifactRef: scenario === "wrong-path" ? { ...locator, path: "other.ts" } : locator, isCurrent };
      const fetchImpl = scenario === "blob-mismatch"
        ? vi.fn(async (url: string | URL | Request) => String(url).includes("/commits/") ? providerFetch()(url)
          : new Response(JSON.stringify({ type: "file", sha: "c".repeat(40), encoding: "base64", content: bytes.toString("base64") })))
        : providerFetch(scenario === "unsigned" ? "" : undefined);
      const result = await resolveRepositoryArtifact({ locator, inquiryAdmission,
        subject: { kind: "backlog-item", id: "BI-TEST" }, db: db({
          capsules: [capsule({ headBranch: null, headSha: null })],
          ...(scenario === "wrong-author" ? { emailPrincipalIds: ["other-author"] } : {}),
        }) as never, fetchImpl: fetchImpl as typeof fetch });
      expect(result.ok).toBe(scenario === "valid");
      if (scenario === "valid" && result.ok) expect(result.artifact.bytes).toEqual(bytes);
    });
});
