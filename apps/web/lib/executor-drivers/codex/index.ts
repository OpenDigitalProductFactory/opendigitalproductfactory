// The Codex driver (BI-A01B06F6): Codex over its own CLI, with no proprietary
// SDK. The session face (`codex app-server`) serves the Workroom runtime; the
// one-shot face (`codex exec`) serves Build Studio dispatch, Ideate and
// inference routing, which all resolve credentials through `resolveCodexAuth`.

import type { CodexCatalogLogin } from "@/lib/routing/codex-cli-model-catalog";
import { sandboxRuntimeLauncher, type RuntimeLauncher } from "@/lib/workroom-runtime/sandbox-launcher";
import type { ExecutorDriver } from "../types";
import { createCodexSessionDriver } from "./session";

export { codexAuthJson, resolveCodexAuth, type CodexAuth } from "./auth";
export { CODEX_INFERENCE_ONLY_ARGS, codexExecArgs, type CodexExecOptions } from "./exec";
export { CODEX_CAPABILITIES, CODEX_SESSION_SCRIPT, codexApprovalResponse } from "./session";

export function createCodexDriver(deps: { launch: RuntimeLauncher; login: () => Promise<CodexCatalogLogin> }): ExecutorDriver {
  return createCodexSessionDriver(deps);
}

/**
 * The Codex driver on the sandbox. The session logs in with the
 * connection-checked login model discovery uses (codex-cli-catalog-auth), which
 * app-server takes as an object rather than an auth.json file. Folding it into
 * `resolveCodexAuth` waits for instances (S3 PR 3), which select the connection.
 */
export const codexDriver: ExecutorDriver = createCodexDriver({
  launch: sandboxRuntimeLauncher,
  login: async () => (await import("@/lib/inference/codex-cli-catalog-auth")).resolveCodexCatalogAuth("codex"),
});
