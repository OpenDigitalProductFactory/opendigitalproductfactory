// Binding-record drafts (PR-3b-4, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §6.4; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-4). Fixture-tested
// only: nothing writes a draft or reads one at runtime in Phase 3b.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { GPP_BINDINGS } from "../bindings";
import { emitBindingRecords } from "./bindings-emit";
import { gppShapeDocumentSchema, type GppShapeDocument } from "./gpp-shape-schema";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";
import { defaultResolveSources } from "./resolve-sources";

const READ_TOOL = "list_customer_accounts";
const IRREVERSIBLE_TOOL = "merge_backlog_items";

const BASE = gppShapeDocumentSchema.parse(
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "drc", "pass-gated-irreversible-stage.gpp.json"), "utf8")),
);

let sources: GppResolveSources;
beforeAll(() => {
  sources = defaultResolveSources();
}, 120_000);

/** The passing fixture with its gated `decide` stage given tools and, optionally, a binding. */
function documentWith(patch: { tools?: string[]; binding?: boolean; gateKey?: string; resolver?: boolean }): GppShapeDocument {
  const document = structuredClone(BASE);
  const decide = document.stages[1];
  if (!decide || decide.advance.kind !== "governed-decision" || !decide.advance.gate) throw new Error("fixture changed");
  if (patch.tools) decide.tools = patch.tools;
  if (patch.binding) decide.binding = { id: "decide-binding", version: 2, enforcement: "shadow" };
  if (patch.gateKey) decide.advance.gate.gateKey = patch.gateKey;
  if (patch.resolver) decide.advance.gate.resolver = { module: "lib/gpp/binding-enforcement", exportName: "bindingEnforcementEntry" };
  return document;
}

async function drafts(document: GppShapeDocument) {
  return emitBindingRecords([{ document, resolution: await resolveShapeDocument(document, sources) }]);
}

describe("emitBindingRecords", () => {
  it("the fixture's tools classify as the test assumes", () => {
    expect(sources.classify(READ_TOOL)?.consequential).toBe(false);
    expect(sources.classify(IRREVERSIBLE_TOOL)?.consequential).toBe(true);
  });

  it("a bound stage with O/A/I tools yields one draft listing only its O/A/I tools", async () => {
    expect(await drafts(documentWith({ tools: [READ_TOOL, IRREVERSIBLE_TOOL], binding: true }))).toEqual([
      {
        bindingId: "decide-binding",
        version: 2,
        gateKey: "drc-exact-checkpoint-scope",
        authority: "wwmd",
        admission: "stage-gate-admit",
        attach: { shapeRef: "drc-pass-gated-irreversible-stage@1.0.0", stageKey: "decide" },
        tools: [IRREVERSIBLE_TOOL],
        reason: "oai",
      },
    ]);
  });

  it("carries the gate's own key and resolver when it names them", async () => {
    const [draft] = await drafts(documentWith({ tools: [IRREVERSIBLE_TOOL], binding: true, gateKey: "explicit-gate", resolver: true }));
    expect(draft?.gateKey).toBe("explicit-gate");
    expect(draft?.resolver).toEqual({ module: "lib/gpp/binding-enforcement", exportName: "bindingEnforcementEntry" });
  });

  it("a stage without a binding yields none", async () => {
    expect(await drafts(documentWith({ tools: [READ_TOOL, IRREVERSIBLE_TOOL] }))).toEqual([]);
    expect(await drafts(BASE)).toEqual([]);
  });

  it("a bound stage that reaches only reads yields none", async () => {
    expect(await drafts(documentWith({ tools: [READ_TOOL], binding: true }))).toEqual([]);
  });

  it("a binding on a stage with no typed gate yields none (it has no owning scope: DRC C-3)", async () => {
    const document = structuredClone(BASE);
    const act = document.stages[2];
    if (!act) throw new Error("fixture changed");
    act.binding = { id: "act-binding", version: 1, enforcement: "shadow" };
    expect(await drafts(document)).toEqual([]);
  });

  it("is pure: the input documents are not mutated and the hand-declared bindings are untouched", async () => {
    const document = documentWith({ tools: [READ_TOOL, IRREVERSIBLE_TOOL], binding: true });
    const before = JSON.stringify(document);
    const count = GPP_BINDINGS.length;
    await drafts(document);
    expect(JSON.stringify(document)).toBe(before);
    expect(GPP_BINDINGS.length).toBe(count);
  });
});
