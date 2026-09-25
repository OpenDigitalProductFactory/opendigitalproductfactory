// Docker-gated end-to-end test of the converter runtime (BI-52E565DA, AC-ODC-004).
//
// Runs only when DPF_DOCTOOLS_TEST_IMAGE names a pinned dpf-doctools image
// (`name@sha256:…`, or the local image id `sha256:…` of a fresh
// `docker build -f Dockerfile.doctools`) AND docker answers. Otherwise every
// case is reported SKIPPED, never passed.
//
// The legacy .doc fixture is produced at test time from the committed flat-ODF
// source by the image itself, the way tools/doctools/smoke.sh does, so the
// repository carries no opaque office binary.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isPinnedImageReference } from "./command";
import { convertDocument, createConversionLimiter, type ConvertDeps } from "./convert";

const IMAGE = process.env.DPF_DOCTOOLS_TEST_IMAGE?.trim() ?? "";
const FIXTURE = resolve(__dirname, "../../../../../tools/doctools/fixtures/sample.fodt");

function dockerHasImage(image: string): boolean {
  if (!isPinnedImageReference(image)) return false;
  try {
    return spawnSync("docker", ["image", "inspect", image], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

const ready = dockerHasImage(IMAGE);
const deps = (overrides: Partial<ConvertDeps> = {}): ConvertDeps => ({
  resolveImage: async () => ({ status: "pinned", image: IMAGE }),
  limiter: createConversionLimiter(2),
  ...overrides,
});

describe.skipIf(!ready)("convertDocument against the real dpf-doctools image", () => {
  it("converts a legacy .doc to PDF and to text end to end", async () => {
    const doc = await convertDocument({ input: readFileSync(FIXTURE), from: "fodt", to: "doc" }, deps());
    expect(doc).toMatchObject({ ok: true, mime: "application/msword" });
    if (!doc.ok) return;
    // OLE compound file magic: a real legacy .doc, not a renamed text file.
    expect(doc.bytes.subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");

    const pdf = await convertDocument({ input: doc.bytes, from: "doc", to: "pdf" }, deps());
    expect(pdf).toMatchObject({ ok: true, mime: "application/pdf" });
    if (pdf.ok) expect(pdf.bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const text = await convertDocument({ input: doc.bytes, from: "doc", to: "txt" }, deps());
    expect(text.ok && text.bytes.toString("utf8")).toContain("DPFSENTINELWRITER");
  }, 240_000);

  it("kills a conversion that outruns its budget, removes the container, and frees the slot", async () => {
    const source = readFileSync(FIXTURE, "utf8");
    const paragraphs = Array.from({ length: 20_000 }, (_, i) => `<text:p>Paragraph ${i} of a long document.</text:p>`).join("");
    const long = Buffer.from(source.replace("<office:text>", `<office:text>${paragraphs}`));
    const limiter = createConversionLimiter(1);

    const names: string[] = [];
    const out = await convertDocument(
      { input: long, from: "fodt", to: "pdf" },
      deps({
        limiter,
        timeoutMs: 1_500,
        newId: () => {
          const id = `killtest${Date.now().toString(36)}`;
          names.push(`dpf-doctools-${id}`);
          return id;
        },
      }),
    );
    expect(out).toMatchObject({ ok: false, reason: "timeout" });
    expect(limiter.active()).toBe(0);

    const listed = spawnSync("docker", ["ps", "-a", "--filter", `name=${names[0]}`, "--format", "{{.Names}}"], {
      encoding: "utf8",
    });
    expect(listed.status).toBe(0);
    expect(listed.stdout.trim()).toBe("");
  }, 120_000);
});
