import { describe, expect, it, vi } from "vitest";
import type { BudgetedProcessOptions, BudgetedProcessResult } from "@/lib/shared/run-process-with-budget";
import { createConversionLimiter } from "@/lib/documents/conversion/convert";
import { renderFlatDocument } from "./render-flat";
import { writeTar } from "./tar";

const IMAGE = `ghcr.io/o/dpf-doctools@sha256:${"d".repeat(64)}`;
const XML = '<office:document office:mimetype="application/vnd.oasis.opendocument.spreadsheet"/>';

function result(partial: Partial<BudgetedProcessResult>): BudgetedProcessResult {
  const stdoutBytes = partial.stdoutBytes ?? Buffer.alloc(0);
  return { exitCode: 0, stdout: "", stderr: "", stdoutBytes, outputLimitExceeded: false, ...partial };
}

function harness(response: BudgetedProcessResult) {
  const calls: Array<{ command: string; args: string[]; opts: BudgetedProcessOptions }> = [];
  const run = vi.fn(async (command: string, args: string[], opts: BudgetedProcessOptions) => {
    calls.push({ command, args, opts });
    return response;
  });
  const deps = {
    run,
    resolveImage: async () => ({ status: "pinned" as const, image: IMAGE }),
    limiter: createConversionLimiter(2),
    newId: () => "feedfacefeedface",
  };
  return { run, calls, deps };
}

describe("renderFlatDocument", () => {
  it("sends the flat ODF to dpf-render's document mode under the renderer's containment and unpacks the files", async () => {
    const tar = writeTar([
      { name: "document.xlsx", data: Buffer.from("PK xlsx") },
      { name: "manifest.json", data: Buffer.from('{"mode":"document","formats":["xlsx"],"charts":1}') },
    ]);
    const { calls, deps } = harness(result({ stdoutBytes: tar }));
    const out = await renderFlatDocument({ ext: "fods", xml: XML, formats: ["xlsx"] }, deps);
    expect(out).toEqual({
      ok: true,
      data: [{ format: "xlsx", bytes: Buffer.from("PK xlsx"), mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }],
    });

    const { command, args, opts } = calls[0]!;
    expect(command).toBe("docker");
    for (const flag of ["--network", "none", "--read-only", "--cap-drop", "ALL", "no-new-privileges"]) expect(args).toContain(flag);
    expect(args.slice(-3)).toEqual(["--entrypoint", "/usr/local/bin/dpf-render", IMAGE]);
    const wire = JSON.parse(opts.stdin!.toString("utf8"));
    expect(wire).toEqual({ document: { ext: "fods", data: Buffer.from(XML, "utf8").toString("base64") }, formats: ["xlsx"] });
    expect(wire).not.toHaveProperty("content");
  });

  it("refuses a format the family cannot make before any container runs", async () => {
    const { run, deps } = harness(result({}));
    const out = await renderFlatDocument({ ext: "fods", xml: XML, formats: ["docx" as never] }, deps);
    expect(out).toMatchObject({ ok: false, reason: "invalid-spec" });
    expect(run).not.toHaveBeenCalled();
  });

  it("maps the engine's exits to typed failures", async () => {
    const refused = await renderFlatDocument({ ext: "fods", xml: XML, formats: ["ods"] }, harness(result({ exitCode: 2, stderr: "dpf-render: an embedded object is not a chart" })).deps);
    expect(refused).toMatchObject({ ok: false, reason: "render-failed" });
    if (!refused.ok) expect(refused.error).toContain("an embedded object is not a chart");
    const slow = await renderFlatDocument({ ext: "fods", xml: XML, formats: ["ods"] }, harness(result({ exitCode: 124 })).deps);
    expect(slow).toMatchObject({ ok: false, reason: "timeout" });
    const missing = await renderFlatDocument({ ext: "fods", xml: XML, formats: ["ods"] }, harness(result({ stdoutBytes: writeTar([]) })).deps);
    expect(missing).toMatchObject({ ok: false, reason: "render-failed" });
  });

  it("reports converter-unavailable without spawning when no image is configured", async () => {
    const { run, deps } = harness(result({}));
    const out = await renderFlatDocument(
      { ext: "fods", xml: XML, formats: ["xlsx"] },
      { ...deps, resolveImage: async () => ({ status: "not-configured" as const }) },
    );
    expect(out).toMatchObject({ ok: false, reason: "converter-unavailable" });
    expect(run).not.toHaveBeenCalled();
  });
});
