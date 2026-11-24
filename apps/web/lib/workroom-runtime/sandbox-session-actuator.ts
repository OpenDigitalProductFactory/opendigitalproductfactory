import { spawn } from "node:child_process";
import { prisma } from "@dpf/db";
import { resolveWorkroomSessionToken } from "@/lib/auth/workroom-session-token";
import { CODEX_SESSION_SCRIPT } from "@/lib/executor-drivers/codex/session";
import { CLAUDE_SESSION_SCRIPT } from "@/lib/executor-drivers/claude/session";
import { isRecord } from "@/lib/shared/coerce";
import type { RuntimeProcess } from "./sandbox-launcher";

export type WorkroomSessionOwner = { provider: "codex"; capsuleId: string; token: string; cwd: string }
  | { provider: "claude"; capsuleId: string; token: string; cwd: string; flags: string;
      credential: { name: "CLAUDE_CODE_OAUTH_TOKEN" | "ANTHROPIC_API_KEY"; value: string } };
type SandboxIdentity = { containerId: string; running: boolean };

const refuse = () => new Error("workroom_runtime_admission_unproven");
const sessionFlags = /^--(?:resume|session-id) [0-9a-f-]{8,64}(?: --model [A-Za-z0-9._:-]{1,80})?$/;
const mcpUrl = "http://portal:3000/api/mcp/v1";

export function readWorkroomSessionOwner(value: unknown): WorkroomSessionOwner {
  if (!isRecord(value) || typeof value.capsuleId !== "string" || !/^WC-[A-Za-z0-9-]{1,100}$/.test(value.capsuleId)
    || typeof value.token !== "string" || !/^dpfroom_[A-Za-z0-9_-]{32}$/.test(value.token)
    || typeof value.cwd !== "string" || value.cwd.length > 1024
    || !/^\/workspace(?:\/[A-Za-z0-9_.-]+)*$/.test(value.cwd)
    || value.cwd.split("/").some(part => part === "." || part === "..")) throw refuse();
  const base = { capsuleId: value.capsuleId, token: value.token, cwd: value.cwd };
  if (value.provider === "codex" && Object.keys(value).length === 4) return { provider: "codex", ...base };
  if (value.provider !== "claude" || Object.keys(value).length !== 6 || typeof value.flags !== "string"
    || !sessionFlags.test(value.flags) || !isRecord(value.credential) || Object.keys(value.credential).length !== 2
    || (value.credential.name !== "CLAUDE_CODE_OAUTH_TOKEN" && value.credential.name !== "ANTHROPIC_API_KEY")
    || typeof value.credential.value !== "string" || !/^[\x21-\x7e]{1,16384}$/.test(value.credential.value)) throw refuse();
  return { provider: "claude", ...base, flags: value.flags,
    credential: { name: value.credential.name, value: value.credential.value } };
}

export function createSandboxSessionActuator() {
  const live = new Set<string>();
  return async (value: unknown, observeSandbox: () => Promise<SandboxIdentity>): Promise<RuntimeProcess> => {
    const owner = readWorkroomSessionOwner(value);
    const credential = await resolveWorkroomSessionToken(owner.token);
    if (!credential || credential.workroomRef !== owner.capsuleId || live.has(credential.tokenId)) throw refuse();
    const tokenId = credential.tokenId;
    live.add(tokenId);
    try {
      const sandbox = await observeSandbox();
      if (!sandbox.running || !/^[a-f0-9]{64}$/.test(sandbox.containerId)) throw refuse();
      const active = () => prisma.mcpApiToken.findFirst({ where: { id: tokenId, kind: "workroom_session",
        workroomRef: owner.capsuleId, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true } });
      if (!await active()) throw refuse();
      const dir = `${owner.cwd}/.dpf-runtime/${owner.capsuleId}`;
      const env: Record<string, string> = owner.provider === "codex"
        ? { DPF_MCP_URL: mcpUrl, DPF_MCP_TOKEN: owner.token, CODEX_HOME: `${dir}/codex-home` }
        : { DPF_RUNTIME_DIR: dir, DPF_SESSION_FLAGS: owner.flags, [owner.credential.name]: owner.credential.value,
          DPF_MCP_CONFIG: JSON.stringify({ mcpServers: { dpf: { type: "http", url: mcpUrl, headers: { Authorization: `Bearer ${owner.token}` } } } }) };
      const script = owner.provider === "codex" ? CODEX_SESSION_SCRIPT : CLAUDE_SESSION_SCRIPT;
      const child = spawn("/usr/bin/docker", ["--host", "unix:///var/run/docker.sock", "exec", "-i", "-w", owner.cwd,
        ...Object.keys(env).flatMap(name => ["-e", name]), sandbox.containerId, "timeout", "-k", "3", "24h", "sh", "-c", script],
      { stdio: ["pipe", "pipe", "pipe"], env: { PATH: "/usr/local/bin:/usr/bin:/bin", NODE_ENV: "production", ...env } });
      const limit = setInterval(() => {
        const disconnect = () => { child.stdin.end(); child.kill("SIGTERM"); };
        void active().then(row => { if (!row) disconnect(); }, disconnect);
      }, 30_000);
      child.stdin.on("error", () => child.kill("SIGTERM"));
      child.once("close", () => { clearInterval(limit); live.delete(tokenId); });
      return {
        write: (line: string | Buffer) => {
          if (child.stdin.writableLength + Buffer.byteLength(line) > 1024 * 1024) child.kill("SIGTERM");
          else child.stdin.write(line);
        },
        onData: listener => { child.stdout.on("data", listener); },
        onStderr: listener => { child.stderr.on("data", listener); },
        onClose: listener => { child.once("close", listener); child.once("error", () => listener(null)); },
        end: () => { child.stdin.end(); },
        kill: () => { child.stdin.end(); child.kill("SIGTERM"); },
      };
    } catch (error) {
      live.delete(tokenId);
      throw error;
    }
  };
}
