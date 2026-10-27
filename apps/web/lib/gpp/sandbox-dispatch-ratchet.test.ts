// Confirmed exports: runSandboxAgentCli; dispatchClaudeTask, dispatchCodexTask,
// dispatchGrokTask, dispatchOpencodeTask. Provider ports: exec and writeFile.
// Labels describe the callers inspected in BI-D37B2C13, not inferred runtime phases.
import { describe, expect, it } from "vitest";
import { readWebSourceFiles } from "./source-files";
import { findSandboxDispatchSites, SANDBOX_DISPATCH_SITES, sandboxPhases } from "./sandbox-dispatch-sites";

describe("sandbox dispatch inventory", () => {
  it("ratchets actual calls per file and group, ignoring comments, declarations and tests", () => {
    expect(findSandboxDispatchSites([{ path: "lib/example.ts", content: `// runSandboxAgentCli(x)\nfunction runSandboxAgentCli(x: unknown) {}\nrunSandboxAgentCli(x);\nprovider.exec(x);` }, { path: "lib/example.test.ts", content: "dispatchCodexTask(x)" }])).toEqual({ "lib/example.ts": { cli: 1, provider: 1 } });
    const actual = findSandboxDispatchSites(readWebSourceFiles());
    const expected = Object.fromEntries(Object.entries(SANDBOX_DISPATCH_SITES).map(([file, site]) => [file, { [site.group]: site.count }]));
    expect(actual, "New files or changed counts need declared sandbox containment and reviewed phase labels").toEqual(expected);
  });
  it("returns only the classified lifecycle phases", () => {
    expect([...sandboxPhases()].sort()).toEqual(["build", "ideate"]);
  });
});
