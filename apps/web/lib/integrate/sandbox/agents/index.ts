import type { BuildAgentId, BuildAgentRunner } from "../agent-runner-types";
import { claudeAgentRunner } from "./claude-agent-runner";
import { codexAgentRunner } from "./codex-agent-runner";
import { grokAgentRunner } from "./grok-agent-runner";
import { dpfNativeAgentRunner } from "./dpf-native-agent-runner";

const runners: Record<BuildAgentId, BuildAgentRunner | null> = {
  codex: codexAgentRunner,
  claude: claudeAgentRunner,
  grok: grokAgentRunner,
  "dpf-native": dpfNativeAgentRunner,
};

export function getBuildAgentRunner(id: BuildAgentId = "codex"): BuildAgentRunner {
  const runner = runners[id];
  if (!runner) throw new Error(`Build agent runner ${id} is not implemented`);
  return runner;
}
