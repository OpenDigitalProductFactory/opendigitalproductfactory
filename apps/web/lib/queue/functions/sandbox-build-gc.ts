// BI-8BD61C30 — scheduled fleet backstop for Build Studio sandbox .builds worktrees.
//
// Primary cleanup is transactional (releaseSandboxForTerminalBuild on terminal
// FeatureBuild transitions). This job sweeps leftovers after crashes.

import { cron } from "inngest";
import { inngest } from "../inngest-client";
import { runSandboxBuildGc } from "@/lib/build/sandbox/sandbox-build-gc";

export const sandboxBuildGc = inngest.createFunction(
  {
    id: "ops/sandbox-build-gc",
    retries: 1,
    // After host worktree backstop (05:40) — sandbox disk hygiene.
    triggers: [cron("50 5 * * *")],
  },
  async ({ step }) => {
    return await step.run("sandbox-build-gc", () => runSandboxBuildGc());
  },
);
