import { describe, expect, it, vi } from "vitest";
import type { BudgetedProcessOptions, BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { renderDocument, type RenderDeps, type RenderDocumentRequest } from "./render";
import { writeTar } from "./tar";

const IMAGE = `ghcr.io/o/dpf-doctools@sha256:${"c".repeat(64)}`;

function result(partial: Partial<BudgetedProcessResult>): BudgetedProcessResult {
  const stdoutBytes = partial.stdoutBytes ?? Buffer.alloc(0);
  return { exitCode: 0, stdout: "", stderr: "", stdoutBytes, outputLimitExceeded: false, ...partial };
}

function engineOutput(names: string[], manifest: Record<string, unknown> = {}): Buffer {
  return writeTar([
    ...names.map((name) => ({ name, data: Buffer.from(`bytes of ${name}`) })),
    { name: "text.txt", data: Buffer.from("Spring adoption drive\nWhere we are\n") },
    {
      name: "manifest.json",
      data: Buffer.from(JSON.stringify({ family: "deck", pageCount: 2, previews: [], warnings: [], ...manifest })),
    },
  ]);
}

function deck(overrides: Partial<RenderDocumentRequest> = {}): RenderDocumentRequest {
  return {
    content: {
      family: "deck",
      title: "Spring adoption drive",
      slides: [
        { layout: "title", title: "Spring adoption drive" },
        { layout: "bullets", title: "Where we are", bullets: ["42 adoptions"] },
      ],
    },
    formats: ["pptx", "pdf"],
    ...overrides,
  };
}

type Call = { command: string; args: string[]; opts: BudgetedProcessOptions };

function harness(response: BudgetedProcessResult, overrides: Partial<RenderDeps> = {}) {
  const calls: Call[] = [];
  const run = vi.fn(async (command: string, args: string[], opts: BudgetedProcessOptions) => {
    calls.push({ command, args, opts });
    return response;
  });
  const deps: RenderDeps = {
    run,
    resolveImage: async () => ({ status: "pinned", image: IMAGE }),
    limiter: createConversionLimiter(2),
    newId: () => "0123456789abcdef",
    now: () => new Date("2026-09-25T12:00:00Z"),
    ...overrides,
  };
  return { run, calls, deps };
}

describe("renderDocument", () => {
  it("rejects an invalid spec with field paths before any container runs", async () => {
    const { run, deps } = harness(result({}));
    const out = await renderDocument(deck({ formats: ["xlsx"] }), deps);
    expect(out).toMatchObject({ ok: false, reason: "invalid-spec" });
    if (out.ok) return;
    expect(out.issues).toEqual([expect.objectContaining({ path: "formats.0" })]);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs dpf-render one-shot with every containment flag and unpacks the outputs", async () => {
    const tar = engineOutput(["document.pptx", "document.pdf", "preview-001.png", "preview-002.png"], {
      previews: ["preview-001.png", "preview-002.png"],
    });
    const { calls, deps } = harness(result({ stdoutBytes: tar }));
    const out = await renderDocument(deck(), deps);
    if (!out.ok) throw new Error(`${out.reason}: ${out.error}`);

    expect(calls).toHaveLength(1);
    const { command, args, opts } = calls[0];
    expect(command).toBe("docker");
    for (const flag of ["--network", "none", "--read-only", "--cap-drop", "ALL", "no-new-privileges", "--pids-limit"]) {
      expect(args).toContain(flag);
    }
    expect(args.slice(args.indexOf("--entrypoint"), args.indexOf("--entrypoint") + 2)).toEqual([
      "--entrypoint",
      "/usr/local/bin/dpf-render",
    ]);
    expect(args.at(-1)).toBe(IMAGE);
    expect(args).toContain("DPF_RENDER_TIMEOUT_SECONDS=204");
    expect(opts).toMatchObject({ timeoutMs: 240_000, containerName: "dpf-doctools-0123456789abcdef" });

    const sent = JSON.parse(opts.stdin!.toString("utf8"));
    expect(sent).toMatchObject({
      template: null,
      formats: ["pptx", "pdf"],
      previews: { maxPages: 20, dpi: 48 },
      issuedAt: "2026-09-25T12:00:00.000Z",
      content: { family: "deck", title: "Spring adoption drive" },
    });

    expect(out.data.files.map((file) => [file.format, file.mime])).toEqual([
      ["pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
      ["pdf", "application/pdf"],
    ]);
    expect(out.data.previews).toHaveLength(2);
    expect(out.data.previews[0].toString()).toBe("bytes of preview-001.png");
    expect(out.data.pageCount).toBe(2);
    expect(out.data.text).toContain("Where we are");
  });

  it("sends a resolved template and its brand theme to the engine", async () => {
    const tar = engineOutput(["document.pptx", "document.pdf"]);
    const resolveTemplate = vi.fn(async () => ({
      ext: "fodp" as const,
      xml: "<office:document/>",
      theme: { chartColours: ["#2a6f97"], shapeFill: "#2a6f97", shapeStroke: "#61788a", shapeText: "#ffffff" },
    }));
    const { calls, deps } = harness(result({ stdoutBytes: tar }), { resolveTemplate });
    const out = await renderDocument(deck({ templateRef: { kind: "brand-master", organizationId: "org-1" } }), deps);
    expect(out.ok).toBe(true);
    expect(resolveTemplate).toHaveBeenCalledWith({ kind: "brand-master", organizationId: "org-1" }, "deck");
    const sent = JSON.parse(calls[0].opts.stdin!.toString("utf8"));
    expect(sent.template).toEqual({ ext: "fodp", data: Buffer.from("<office:document/>").toString("base64") });
    expect(sent.theme.chartColours).toEqual(["#2a6f97"]);
  });

  it.each([
    [4, "input-too-large"],
    [124, "timeout"],
    [125, "converter-unavailable"],
    [3, "render-failed"],
    [2, "render-failed"],
  ])("maps dpf-render exit %i to %s", async (exitCode, reason) => {
    const { deps } = harness(result({ exitCode, stderr: "dpf-render: something" }));
    expect(await renderDocument(deck(), deps)).toMatchObject({ ok: false, reason });
  });

  it("reports an unconfigured engine as unavailable without spawning", async () => {
    const { run, deps } = harness(result({}), { resolveImage: async () => ({ status: "not-configured" }) });
    expect(await renderDocument(deck(), deps)).toMatchObject({ ok: false, reason: "converter-unavailable" });
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses a request larger than the engine accepts before spawning", async () => {
    const { run, deps } = harness(result({}), { maxRequestBytes: 64 });
    expect(await renderDocument(deck(), deps)).toMatchObject({ ok: false, reason: "input-too-large" });
    expect(run).not.toHaveBeenCalled();
  });

  it("fails when the engine's archive lacks a requested format", async () => {
    const { deps } = harness(result({ stdoutBytes: engineOutput(["document.pdf"]) }));
    expect(await renderDocument(deck(), deps)).toMatchObject({
      ok: false,
      reason: "render-failed",
      error: expect.stringContaining("document.pptx"),
    });
  });

  it("fails honestly when stdout is not an archive", async () => {
    const { deps } = harness(result({ stdoutBytes: Buffer.from("garbage") }));
    expect(await renderDocument(deck(), deps)).toMatchObject({ ok: false, reason: "render-failed" });
  });

  it("queues behind the shared doctools limiter", async () => {
    const limiter = createConversionLimiter(1);
    const spy = vi.spyOn(limiter, "run");
    const { deps } = harness(result({ stdoutBytes: engineOutput(["document.pptx", "document.pdf"]) }), { limiter });
    await renderDocument(deck(), deps);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(limiter.active()).toBe(0);
  });
});
