import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderOwnedCliRunner } from "./cli-owned-runner";

async function runFixture(secret: string, timeoutMs: number, delayMs: number, missingAuth = false) {
  const home = await mkdtemp(join(tmpdir(), "dpf-cli-auth-"));
  const prompt = join(home, "prompt");
  const key = join(home, "key");
  await writeFile(prompt, "fixture");
  await writeFile(key, secret, { mode: 0o600 });
  const script = renderOwnedCliRunner({ command: process.execPath,
    args: ["-e", `process.stdout.write(process.env.OPENAI_API_KEY); setTimeout(() => process.stdout.write('settled'), ${delayMs});`],
    home, cwd: home, promptFile: prompt, timeoutMs, env: { CODEX_HOME: home },
    secretFile: { path: missingAuth ? join(home, "missing") : key, variable: "OPENAI_API_KEY" } });
  const result = await new Promise<{ code: number | null; output: string; error: string }>((resolve, reject) => {
    const proc = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "", error = "";
    proc.stdout.on("data", data => { output += data.toString(); });
    proc.stderr.on("data", data => { error += data.toString(); });
    proc.on("error", reject);
    proc.on("close", code => resolve({ code, output, error }));
  });
  const retained = await readFile(key).then(() => true, () => false);
  await rm(home, { recursive: true, force: true });
  return { ...result, retained, home, script };
}

describe("owned CLI lifetime", () => {
  it("removes staged credentials when preparation fails before starting a child", async () => {
    const result = await runFixture("fake-preparation", 5000, 1, true);
    expect(result.code).toBe(1);
    expect(result.output).toBe("");
    expect(result.retained).toBe(false);
  });
  it("runs concurrent credentials in private homes and removes each only after settlement", async () => {
    const [a, b] = await Promise.all([runFixture("fake-a", 5000, 40), runFixture("fake-b", 5000, 40)]);
    expect(a.home).not.toBe(b.home);
    expect(a.output).toBe("fake-asettled");
    expect(b.output).toBe("fake-bsettled");
    expect(a.code).toBe(0);
    expect(b.code).toBe(0);
    expect(a.retained || b.retained).toBe(false);
    expect(a.script).not.toContain("fake-a");
  });
  it("settles a timed-out owned child before removing its credentials", async () => {
    const result = await runFixture("fake-timeout", 50, 2000);
    expect(result.code).toBe(124);
    expect(result.output).not.toContain("settled");
    expect(result.error).toContain("DPF_CLI_TIMEOUT");
    expect(result.retained).toBe(false);
  });
});
