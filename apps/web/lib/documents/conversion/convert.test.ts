import { describe, expect, it, vi } from "vitest";
import type { BudgetedProcessOptions, BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import { convertDocument, createConversionLimiter, type ConvertDeps } from "./convert";

const IMAGE = `ghcr.io/o/dpf-doctools@sha256:${"b".repeat(64)}`;
const PDF = Buffer.from("%PDF-1.7\n\xff\xfe binary", "latin1");

type RunCall = { command: string; args: string[]; opts: BudgetedProcessOptions };

function result(partial: Partial<BudgetedProcessResult>): BudgetedProcessResult {
  const stdoutBytes = partial.stdoutBytes ?? Buffer.alloc(0);
  return {
    exitCode: 0,
    stdout: stdoutBytes.toString("utf8"),
    stderr: "",
    stdoutBytes,
    outputLimitExceeded: false,
    ...partial,
  };
}

function deps(run: ConvertDeps["run"], overrides: Partial<ConvertDeps> = {}): ConvertDeps {
  return {
    run,
    resolveImage: async () => ({ status: "pinned", image: IMAGE }),
    limiter: createConversionLimiter(2),
    newId: () => "0123456789abcdef",
    ...overrides,
  };
}

function recordingRunner(response: BudgetedProcessResult) {
  const calls: RunCall[] = [];
  const run = vi.fn(async (command: string, args: string[], opts: BudgetedProcessOptions) => {
    calls.push({ command, args, opts });
    return response;
  });
  return { run, calls };
}

describe("convertDocument (BI-52E565DA)", () => {
  it("returns the converted bytes and MIME type on success, streaming the input over stdin", async () => {
    const { run, calls } = recordingRunner(result({ stdoutBytes: PDF }));
    const input = Buffer.from("legacy word document");
    const out = await convertDocument({ input, from: "doc", to: "pdf" }, deps(run));

    expect(out.ok && out.data).toEqual({ bytes: PDF, mime: "application/pdf" });
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("docker");
    expect(calls[0].args).toContain(IMAGE);
    expect(calls[0].args.slice(-4)).toEqual(["--to", "pdf", "--from", "doc"]);
    expect(calls[0].opts.stdin).toBe(input);
    expect(calls[0].opts.containerName).toBe("dpf-doctools-0123456789abcdef");
    expect(calls[0].args[calls[0].args.indexOf("--name") + 1]).toBe(calls[0].opts.containerName);
  });

  it("rejects an oversized input before spawning anything", async () => {
    const { run } = recordingRunner(result({}));
    const resolveImage = vi.fn(async () => ({ status: "pinned" as const, image: IMAGE }));
    const out = await convertDocument(
      { input: Buffer.alloc(11), from: "doc", to: "pdf" },
      deps(run, { maxInputBytes: 10, resolveImage }),
    );
    expect(out).toMatchObject({ ok: false, reason: "input-too-large" });
    expect(run).not.toHaveBeenCalled();
    expect(resolveImage).not.toHaveBeenCalled();
  });

  it("defaults the input cap to 50 MB and hands the same cap to dpf-convert", async () => {
    const { run, calls } = recordingRunner(result({ stdoutBytes: PDF }));
    await convertDocument({ input: Buffer.from("x"), from: "doc", to: "pdf" }, deps(run));
    expect(calls[0].args).toContain(`DPF_CONVERT_MAX_BYTES=${50 * 1024 * 1024}`);
  });

  it("maps a budget timeout to `timeout`, naming the container the runner removes", async () => {
    const { run, calls } = recordingRunner(
      result({ exitCode: 124, stderr: "[converter-timeout] process did not finish" }),
    );
    const out = await convertDocument(
      { input: Buffer.from("x"), from: "doc", to: "pdf" },
      deps(run, { timeoutMs: 30_000 }),
    );
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
    expect(calls[0].opts.timeoutMs).toBe(30_000);
    expect(calls[0].opts.containerName).toMatch(/^dpf-doctools-[a-z0-9]+$/);
    expect(calls[0].opts.timeoutLabel).toBe("converter-timeout");
    // The engine's own timeout fires first, inside the portal's budget.
    const inner = Number(calls[0].args.find((a) => a.startsWith("DPF_CONVERT_TIMEOUT_SECONDS="))!.split("=")[1]);
    expect(inner * 1000).toBeLessThan(30_000);
  });

  it("maps dpf-convert's exit 4 to input-too-large and exits 2/3 to conversion-failed", async () => {
    for (const [exitCode, reason] of [[4, "input-too-large"], [2, "conversion-failed"], [3, "conversion-failed"], [137, "conversion-failed"]] as const) {
      const { run } = recordingRunner(result({ exitCode, stderr: `dpf-convert: exit ${exitCode}` }));
      const out = await convertDocument({ input: Buffer.from("x"), from: "doc", to: "pdf" }, deps(run));
      expect(out).toMatchObject({ ok: false, reason });
      if (!out.ok) expect(out.error).toContain(`exit ${exitCode}`);
    }
  });

  it("treats empty output as a failed conversion, never an empty success", async () => {
    const { run } = recordingRunner(result({ exitCode: 0 }));
    const out = await convertDocument({ input: Buffer.from("x"), from: "doc", to: "pdf" }, deps(run));
    expect(out).toMatchObject({ ok: false, reason: "conversion-failed" });
  });

  it("maps an output overrun to conversion-failed", async () => {
    const { run, calls } = recordingRunner(result({ exitCode: 1, outputLimitExceeded: true }));
    const out = await convertDocument(
      { input: Buffer.from("x"), from: "doc", to: "pdf" },
      deps(run, { maxOutputBytes: 1000 }),
    );
    expect(out).toMatchObject({ ok: false, reason: "conversion-failed" });
    expect(calls[0].opts.maxStdoutBytes).toBe(1000);
  });

  it("reports converter-unavailable when docker cannot be spawned, the daemon refuses, or no pinned image is configured", async () => {
    const spawnFails = vi.fn(async () => {
      throw Object.assign(new Error("spawn docker ENOENT"), { code: "ENOENT" });
    });
    expect(await convertDocument({ input: Buffer.from("x"), to: "pdf" }, deps(spawnFails))).toMatchObject({
      ok: false,
      reason: "converter-unavailable",
    });

    for (const exitCode of [125, 126, 127]) {
      const { run } = recordingRunner(result({ exitCode, stderr: "docker: Cannot connect to the Docker daemon" }));
      expect(await convertDocument({ input: Buffer.from("x"), to: "pdf" }, deps(run))).toMatchObject({
        ok: false,
        reason: "converter-unavailable",
      });
    }

    const { run } = recordingRunner(result({}));
    for (const resolution of [{ status: "not-configured" as const }, { status: "unpinned" as const, image: "dpf-doctools:latest" }]) {
      const out = await convertDocument(
        { input: Buffer.from("x"), to: "pdf" },
        deps(run, { resolveImage: async () => resolution }),
      );
      expect(out).toMatchObject({ ok: false, reason: "converter-unavailable" });
    }
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses an unsupported format without spawning", async () => {
    const { run } = recordingRunner(result({}));
    expect(await convertDocument({ input: Buffer.from("x"), from: "exe", to: "pdf" }, deps(run))).toMatchObject({
      ok: false,
      reason: "conversion-failed",
    });
    expect(await convertDocument({ input: Buffer.from("x"), to: "bogus" as never }, deps(run))).toMatchObject({
      ok: false,
      reason: "conversion-failed",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses an empty input without spawning", async () => {
    const { run } = recordingRunner(result({}));
    expect(await convertDocument({ input: Buffer.alloc(0), to: "pdf" }, deps(run))).toMatchObject({
      ok: false,
      reason: "conversion-failed",
    });
    expect(run).not.toHaveBeenCalled();
  });

  it("runs at most two conversions at once; the third waits for a slot", async () => {
    const releases: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const run = vi.fn(
      () =>
        new Promise<BudgetedProcessResult>((resolve) => {
          running += 1;
          peak = Math.max(peak, running);
          releases.push(() => {
            running -= 1;
            resolve(result({ stdoutBytes: PDF }));
          });
        }),
    );
    const shared = deps(run, { limiter: createConversionLimiter(2) });
    const pending = [1, 2, 3].map(() => convertDocument({ input: Buffer.from("x"), to: "pdf" }, shared));

    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(run).toHaveBeenCalledTimes(2);

    releases[0]();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    releases[1]();
    releases[2]();
    const outcomes = await Promise.all(pending);
    expect(outcomes.every((o) => o.ok)).toBe(true);
    expect(peak).toBe(2);
  });

  it("frees the slot after a timeout, so a hung job never wedges the queue", async () => {
    const limiter = createConversionLimiter(1);
    const hung = recordingRunner(result({ exitCode: 124, stderr: "[converter-timeout]" }));
    expect(await convertDocument({ input: Buffer.from("x"), to: "pdf" }, deps(hung.run, { limiter }))).toMatchObject({
      reason: "timeout",
    });
    expect(limiter.active()).toBe(0);

    const ok = recordingRunner(result({ stdoutBytes: PDF }));
    expect((await convertDocument({ input: Buffer.from("x"), to: "pdf" }, deps(ok.run, { limiter }))).ok).toBe(true);
  });

  it("frees the slot when the runner throws", async () => {
    const limiter = createConversionLimiter(1);
    const boom = vi.fn(async () => {
      throw new Error("spawn EACCES");
    });
    await convertDocument({ input: Buffer.from("x"), to: "pdf" }, deps(boom, { limiter }));
    expect(limiter.active()).toBe(0);
  });

  it("gives every conversion its own container name", async () => {
    const { run, calls } = recordingRunner(result({ stdoutBytes: PDF }));
    const unique = deps(run);
    delete unique.newId;
    await convertDocument({ input: Buffer.from("x"), to: "pdf" }, unique);
    await convertDocument({ input: Buffer.from("x"), to: "pdf" }, unique);
    expect(calls[0].opts.containerName).not.toBe(calls[1].opts.containerName);
  });
});

describe("createConversionLimiter", () => {
  it("rejects a non-positive cap", () => {
    expect(() => createConversionLimiter(0)).toThrow();
  });
});
