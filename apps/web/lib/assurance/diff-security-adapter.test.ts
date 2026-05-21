import { describe, expect, it } from "vitest";
import { createDiffSecurityAdapter } from "./diff-security-adapter";

describe("createDiffSecurityAdapter", () => {
  it("normalizes critical regex scanner findings into assurance findings", async () => {
    const adapter = createDiffSecurityAdapter();
    const output = await adapter.run({
      scope: { type: "source-file", id: "apps/web/app/page.tsx" },
      input: {
        diff: [
          "diff --git a/apps/web/app/page.tsx b/apps/web/app/page.tsx",
          "@@ -1,0 +1,1 @@",
          "+const html = { __html: userInput }; return <div dangerouslySetInnerHTML={html} />;",
        ].join("\n"),
      },
    });

    expect(output.status).toBe("failed");
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0]).toMatchObject({
      adapterKey: "diff-security",
      findingKind: "policy-violation",
      affectedType: "source-file",
      affectedId: "apps/web/app/page.tsx",
      policySeverity: "critical",
      releaseImpact: "block",
      reachability: "unknown",
      exposure: "unknown",
    });
    expect(output.findings[0]?.findingKey).toMatch(/^[a-f0-9]{24}$/);
  });
});
