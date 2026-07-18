import { appendFileSync } from "node:fs";
import { assertSafeComposeCommand } from "./assert-safe-sandbox.mjs";

export function captureDockerCommand(argv, { sandboxRoot, captureFile }) {
  const safety = assertSafeComposeCommand(argv, sandboxRoot);
  appendFileSync(captureFile, `${JSON.stringify(argv)}\n`, "utf8");
  return safety;
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  captureDockerCommand(process.argv.slice(2), { sandboxRoot: process.env.DPF_TEST_SANDBOX, captureFile: process.env.DPF_TEST_DOCKER_CAPTURE });
}
