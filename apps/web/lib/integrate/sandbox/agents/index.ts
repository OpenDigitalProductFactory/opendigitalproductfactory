import type { BuildAgentId, BuildAgentRunner } from "../agent-runner-types";
import { claudeAgentRunner } from "./claude-agent-runner";
import { codexAgentRunner } from "./codex-agent-runner";

const runners: Record<BuildAgentId, BuildAgentRunner | null> = {
  codex: codexAgentRunner,
  claude: claudeAgentRunner,
  "dpf-native": null,
};

export function getBuildAgentRunner(id: BuildAgentId = "codex"): BuildAgentRunner {
  const runner = runners[id];
  if (!runner) throw new Error(`Build agent runner ${id} is not implemented`);
  return runner;
}
