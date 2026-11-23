// The Codex driver (BI-A01B06F6): Codex over its own CLI, with no proprietary
// SDK. The session face (`codex app-server`) serves the Workroom runtime; the
// one-shot face (`codex exec`) serves Build Studio dispatch, Ideate and
// inference routing, which all resolve credentials through `resolveCodexAuth`.

import { resolveCodexAuth } from "./auth";
import { sandboxRuntimeLauncher } from "@/lib/workroom-runtime/sandbox-launcher";
import type { ExecutorDriver } from "../types";
import { createCodexSessionDriver } from "./session";

export { codexAuthJson, resolveCodexAuth, type CodexAuth } from "./auth";
export { CODEX_INFERENCE_ONLY_ARGS, codexExecArgs, type CodexExecOptions } from "./exec";
export { CODEX_CAPABILITIES, CODEX_SESSION_SCRIPT, codexApprovalResponse } from "./session";

export { createCodexSessionDriver as createCodexDriver } from "./session";

export const codexDriver: ExecutorDriver = createCodexSessionDriver({
  launch: sandboxRuntimeLauncher,
  login: (account) => resolveCodexAuth(account?.providerId ?? "codex", account ?? { connectionId: "provider-default-codex" }, "app-server"),
});
