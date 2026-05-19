import fs from "fs";
import path from "path";

import { buildSetupSnippets } from "./mcp-setup-snippets";

/**
 * Writes .mcp.json and .vscode/mcp.json to the host-mounted install directory.
 * The files point at the stable DPF_MCP_BEARER_TOKEN env var so future token
 * rotation changes the secret, not the client config shape.
 * No-ops silently when the bind mount does not exist (dev / CI environments).
 */
export function writeMcpJsonToHost(plaintext: string, baseUrl: string): void {
  const mountPath = "/host-dpf";
  if (!fs.existsSync(mountPath)) return;

  const snippets = buildSetupSnippets(plaintext, baseUrl);

  // Use path.posix so paths always use forward slashes — this code runs inside
  // a Linux Docker container regardless of the OS running the build/tests.
  try {
    fs.writeFileSync(path.posix.join(mountPath, ".mcp.json"), snippets.claudeCode, "utf-8");
    const vsDir = path.posix.join(mountPath, ".vscode");
    if (!fs.existsSync(vsDir)) fs.mkdirSync(vsDir, { recursive: true });
    fs.writeFileSync(path.posix.join(vsDir, "mcp.json"), snippets.vscode, "utf-8");
  } catch (err) {
    console.error("[mcp-host-writer] Failed to write .mcp.json to host:", err);
  }
}
