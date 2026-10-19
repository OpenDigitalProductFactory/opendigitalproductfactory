import { checkSoundness, gppLayoutSchema, gppShapeJsonSchema, parseShapeDocument, parseStrictJson, resolveShapeDocument, runDesignRules } from "../kernel/gpp/browser.js";
import { assert, equal, policy, routineDocument, sources } from "./fixtures.js";

/** Browser platform types include URL for Zod; no ambient Node or application types. */
export async function runBrowserSmoke(): Promise<string[]> {
  const passed: string[] = [];
  const document = routineDocument();
  const parsed = parseShapeDocument(JSON.stringify(document));
  assert(parsed.accepted, "strict synthetic document parses");
  equal(parsed.document, document, "schema preserves the authored document");
  passed.push("strict schema and document parse");
  for (const text of ['{"key":1,"\\u006bey":2}', '{"key":}', '\uFEFF{}', '{}\r\n', '{} {}', "[".repeat(66) + "0" + "]".repeat(66)]) {
    assert(!parseStrictJson(text).accepted, "malformed/duplicate/encoding/depth input must refuse");
  }
  const extra = parseShapeDocument(JSON.stringify({ ...document, unrecognized: true }));
  assert(!extra.accepted && extra.diagnostics.some((finding) => finding.rule === "SCHEMA"), "unknown fields refuse");
  passed.push("decoded duplicate keys, syntax, BOM, CRLF, trailing input, depth and unknown fields refuse");
  const schema = gppShapeJsonSchema();
  assert(schema.$id === "urn:dpf:gpp-shape:0.1", "published schema identity");
  assert(gppLayoutSchema.safeParse({ format: "gpp-layout/0.1", shape: "synthetic-read@1.2.3", nodes: {}, edges: {}, viewport: { x: 0, y: 0, zoom: 1 } }).success, "layout schema");
  passed.push("JSON Schema and layout contracts");
  const malformed = routineDocument();
  malformed.flow = { nodes: [], edges: [{ from: "read", to: "missing-stage" }] };
  assert(checkSoundness(malformed).some((finding) => finding.rule === "S-3"), "unresolved graph target is unsound");
  const noExits = routineDocument(); noExits.stopConditions = noExits.stopConditions.filter((stop) => stop.kind === "success");
  assert(checkSoundness(noExits).filter((finding) => finding.rule === "S-6").length === 2, "failure and budget exits are independently required");
  passed.push("malformed graphs and absent failure/budget exits refuse");
  const findings = runDesignRules(document, await resolveShapeDocument(document, sources()), { policy, ratification: {}, directSites: new Map() });
  assert(!findings.some((finding) => finding.severity === "error"), "supplied routine policy facts pass the implemented checks");
  assert(findings.some((finding) => finding.rule === "C-5" && finding.severity === "not-evaluated"), "whole actor/session capability aggregation remains unassessed");
  assert(findings.some((finding) => finding.code === "C-7/SANDBOX-CONTAINMENT" && finding.severity === "not-evaluated"), "containment remains unassessed");
  assert(findings.some((finding) => finding.rule === "C-8" && finding.severity === "not-evaluated"), "absent host mediation declaration remains unassessed");
  const declared = runDesignRules(document, await resolveShapeDocument(document, sources()), {
    policy: { ...policy, singleTransitionPath: "synthetic observation host" }, ratification: {}, directSites: new Map(),
  });
  assert(declared.some((finding) => finding.rule === "C-8" && finding.severity === "info" && finding.message.includes("not verified by this compiler")),
    "a host declaration does not become verified runtime mediation");
  passed.push("injected facts remain distinct from unevaluated capability/containment and declared-only mediation checks");
  return passed;
}
