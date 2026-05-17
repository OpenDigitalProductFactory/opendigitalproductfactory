import fs from "fs";
import path from "path";

/**
 * Writes .mcp.json and .vscode/mcp.json to the host-mounted install directory.
 * Called at token issuance time — the only moment the plaintext is available.
 * No-ops silently when the bind mount does not exist (dev / CI environments).
 */
export function writeMcpJsonToHost(plaintext: string, baseUrl: string): void {
  const mountPath = "/host-dpf";
  if (!fs.existsSync(mountPath)) return;

  const url = `${baseUrl}/api/mcp/v1`;
  const httpEntry = {
    type: "http",
    url,
    headers: { Authorization: `Bearer ${plaintext}` },
  };

  const mcpJson = JSON.stringify({ mcpServers: { dpf: httpEntry } }, null, 2);
  const vscodeMcpJson = JSON.stringify({ servers: { dpf: httpEntry } }, null, 2);

  try {
    fs.writeFileSync(path.join(mountPath, ".mcp.json"), mcpJson, "utf-8");
    const vsDir = path.join(mountPath, ".vscode");
    if (!fs.existsSync(vsDir)) fs.mkdirSync(vsDir, { recursive: true });
    fs.writeFileSync(path.join(vsDir, "mcp.json"), vscodeMcpJson, "utf-8");
  } catch (err) {
    console.error("[mcp-host-writer] Failed to write .mcp.json to host:", err);
  }
}
