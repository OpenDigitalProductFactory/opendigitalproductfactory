import { spawnSandboxExec } from "@/lib/workroom-runtime/sandbox-exec";
import { createJsonRpcPeer } from "@/lib/workroom-runtime/json-rpc-peer";
import { CODEX_CATALOG_RUNNER, type CodexCatalogLogin } from "./codex-cli-model-catalog";
import { codexCapacityAvailable } from "./codex-capacity-observation";
import type { ChildProcess } from "node:child_process";

/** Same ephemeral selected-account transport as catalog discovery; no inference or token output. */
export async function readCodexCliCapacity(login: CodexCatalogLogin): Promise<boolean> {
  if (login.type !== "chatgptAuthTokens") return false;
  const childEnv = { ...process.env };
  delete childEnv.OPENAI_API_KEY; delete childEnv.CODEX_API_KEY;
  let proc: ChildProcess;
  try {
    proc = spawnSandboxExec(["exec", "-i", "-e", "OPENAI_API_KEY=", "-e", "CODEX_API_KEY=",
      process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1", "node", "-e", CODEX_CATALOG_RUNNER],
    { stdio: ["pipe", "pipe", "pipe"], env: childEnv });
  } catch { return false; }
  const peer = createJsonRpcPeer({ write: line => { proc.stdin?.write(line); },
    onData: listener => { proc.stdout?.on("data", listener); },
    onClose: listener => { proc.on("close", listener); }, end: () => { proc.stdin?.end(); } }, {
    requestTimeoutMs: 10_000, maxLineBytes: 1024 * 1024, onNotification: () => {}, onClose: () => {},
    onServerRequest: id => { peer.respondError(id, -32000, "Reconnect the selected account"); peer.close(); },
  });
  proc.stderr?.on("data", () => {});
  proc.on("error", () => peer.close());
  for (const stream of [proc.stdin, proc.stdout, proc.stderr]) stream?.on("error", () => peer.close());
  const deadline = setTimeout(() => { peer.close(); proc.kill("SIGTERM"); }, 30_000);
  try {
    await peer.request("initialize", { clientInfo: { name: "dpf-capacity-check", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    peer.notify("initialized");
    const loggedIn = await peer.request<{ type?: string }>("account/login/start", login);
    if (loggedIn?.type !== login.type) return false;
    return codexCapacityAvailable(await peer.request("account/rateLimits/read", null), login.chatgptAccountId);
  } catch { return false; }
  finally { clearTimeout(deadline); peer.close(); proc.kill("SIGTERM"); }
}
