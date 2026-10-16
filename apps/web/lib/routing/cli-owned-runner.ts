import { basename, isAbsolute } from "node:path";

type OwnedCliRunnerInput = {
  command: string; args: string[]; home: string; cwd: string; promptFile: string;
  timeoutMs: number; env: Record<string, string>;
  systemPromptFile?: string;
  secretFile?: { path: string; variable: "OPENAI_API_KEY" | "ANTHROPIC_API_KEY" | "CLAUDE_CODE_OAUTH_TOKEN" };
};

/** Native tool effects may have committed before a lost/timeout response. */
export class NativeCliExecutionUncertainError extends Error {
  constructor(public readonly providerId: string) {
    super(`Native CLI execution on ${providerId} did not return a settled result. Review the existing execution before retrying.`);
    this.name = "NativeCliExecutionUncertainError";
  }
}

/** Runs inside the container: the supervisor owns the child, timeout and cleanup. */
export function renderOwnedCliRunner(input: OwnedCliRunnerInput): string {
  if (!isAbsolute(input.home) || !/^dpf-(?:codex|claude|cli)-auth-[a-zA-Z0-9-]+$/.test(basename(input.home))
    || !Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new Error("Invalid private CLI lifetime configuration");
  return String.raw`
const fs = require('node:fs');
const cp = require('node:child_process');
const config = ${JSON.stringify(input)};
function run() {
const env = { ...process.env, ...config.env };
delete env.OPENAI_API_KEY; delete env.CODEX_API_KEY;
delete env.ANTHROPIC_API_KEY; delete env.CLAUDE_CODE_OAUTH_TOKEN;
delete env.ANTHROPIC_AUTH_TOKEN;
const args = [...config.args];
let child;
try {
  if (config.secretFile) env[config.secretFile.variable] = fs.readFileSync(config.secretFile.path, 'utf8');
  if (config.systemPromptFile) args.push('--system-prompt', fs.readFileSync(config.systemPromptFile, 'utf8'));
  child = cp.spawn(config.command, args, { cwd: config.cwd, env, stdio: ['pipe', 'inherit', 'inherit'] });
} catch {
  fs.rmSync(config.home, { recursive: true, force: true });
  process.stderr.write('DPF_CLI_PREPARATION_FAILED\n'); process.exitCode = 1; return;
}
let hardStop, timedOut = false, settled = false;
const stop = () => {
  if (settled) return;
  child.kill('SIGTERM');
  hardStop ??= setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5000);
};
const watchdog = setTimeout(() => { timedOut = true; process.stderr.write('DPF_CLI_TIMEOUT\n'); stop(); }, config.timeoutMs);
process.on('SIGTERM', stop); process.on('SIGINT', stop);
child.stdin.on('error', () => stop());
const prompt = fs.createReadStream(config.promptFile);
prompt.on('error', () => stop());
prompt.pipe(child.stdin);
const cleanup = (code) => {
  if (settled) return;
  settled = true;
  clearTimeout(watchdog); clearTimeout(hardStop); prompt.destroy();
  fs.rmSync(config.home, { recursive: true, force: true });
  process.exitCode = timedOut ? 124 : code;
};
child.on('error', () => cleanup(1));
child.on('close', code => cleanup(code ?? 1));
}
run();
`;
}
