import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managedInferenceProviderDigest } from "../remote-action/managed-inference-admission";
import { getOllamaApiRoot, getOllamaBaseUrl, resolveOpencodeProviderBaseUrl } from "./ollama-url";

const selection = vi.hoisted(() => ({ endpoint: null as string | null }));
vi.mock("./managed-runtime-selection", () => ({ readManagedInferenceEndpoint: () => selection.endpoint }));
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const native = "http://host.docker.internal:12436/v1";
let composeAvailable = false;
// ambient-host-guard: allow readonly Compose CLI probe to self-gate this integration suite; it never contacts a daemon.
try { execFileSync("docker", ["compose", "version", "--short"], { stdio: "ignore", timeout: 10_000 }); composeAvailable = true; } catch { /* Explicitly unrun without the Compose CLI. No daemon is required. */ }

function renderedEndpoints(overlays: string[], legacy?: string): Record<string, string> {
  const fixture = mkdtempSync(join(tmpdir(), "dpf-endpoint-contract-"));
  const envFile = join(fixture, "empty.env");
  writeFileSync(envFile, "");
  try {
    // No real .env or shell credentials. `config` renders; it creates no
    // container, volume, lease or listener, including for the local-CI overlay.
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "test",
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      AUTH_SECRET: "source-check-placeholder", CREDENTIAL_ENCRYPTION_KEY: "source-check-placeholder",
      INNGEST_EVENT_KEY: "source-check-placeholder", INNGEST_SIGNING_KEY: "source-check-placeholder",
      DPF_STATE_DIR: join(fixture, "state"), DPF_LOCAL_CI_PORT: "48123",
      DPF_LOCAL_CI_SOURCE_VOLUME: "dpf-endpoint-contract-placeholder",
      DPF_LOCAL_CI_TEST_DATABASE_URL: "postgresql://fixture:fixture@localhost:5432/fixture",
      DPF_LOCAL_CI_URL: "http://127.0.0.1:48123",
      ...(legacy === undefined ? {} : { OLLAMA_INTERNAL_URL: legacy }),
    };
    const args = ["compose", "--project-directory", repo, "--project-name", "dpf-endpoint-contract", "--env-file", envFile];
    for (const file of ["docker-compose.yml", ...overlays]) args.push("-f", join(repo, file));
    // ambient-host-guard: allow self-gated readonly Compose rendering with an empty env file and declared fixtures; no resources are created.
    const config = JSON.parse(execFileSync("docker", [...args, "config", "--format", "json"], {
      cwd: fixture, env, encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
    }));
    const values = config.services.portal.environment;
    return { LLM_BASE_URL: values.LLM_BASE_URL, OLLAMA_INTERNAL_URL: values.OLLAMA_INTERNAL_URL ?? "" };
  } finally { rmSync(fixture, { recursive: true, force: true }); }
}
afterEach(() => { selection.endpoint = null; vi.unstubAllEnvs(); });
function useEnvironment(env: Record<string, string>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

describe.skipIf(!composeAvailable)("real Compose defaults and production local endpoint contracts (BI-CA88DAA7)", () => {
  it.each([{ name: "Desktop", overlays: [] }, { name: "local CI", overlays: ["docker-compose.local-ci.yml"] }])("admits and serves native with standard $name defaults", ({ overlays }) => {
    const env = renderedEndpoints(overlays);
    expect(() => managedInferenceProviderDigest({}, env)).not.toThrow();
    useEnvironment(env);
    selection.endpoint = native;
    expect(getOllamaBaseUrl()).toBe(native);
    expect(getOllamaApiRoot()).toBe("http://host.docker.internal:12436");
    selection.endpoint = null;
    expect(getOllamaBaseUrl()).toBe("http://model-runner.docker.internal/v1");
  });

  it("retains explicit legacy vetoes and independent provider ownership", () => {
    const env = renderedEndpoints([], "http://custom-ollama:11434");
    expect(env.OLLAMA_INTERNAL_URL).toBe("http://custom-ollama:11434");
    expect(() => managedInferenceProviderDigest({}, env)).toThrow();
    useEnvironment(env);
    selection.endpoint = native;
    expect(() => getOllamaBaseUrl()).toThrow(/conflict/);
    expect(resolveOpencodeProviderBaseUrl({ providerId: "ollama", baseUrl: "http://independent:11434", endpoint: null }))
      .toBe("http://independent:11434");
  });

  it("retains the Linux Ollama default and refuses an incompatible managed transition", () => {
    const env = renderedEndpoints(["docker-compose.linux.yml"]);
    useEnvironment(env);
    expect(getOllamaBaseUrl()).toBe("http://ollama:11434/v1");
    expect(getOllamaApiRoot()).toBe("http://ollama:11434");
    expect(() => managedInferenceProviderDigest({}, env)).toThrow();
    selection.endpoint = native;
    expect(() => getOllamaBaseUrl()).toThrow(/conflict/);
  });
});
