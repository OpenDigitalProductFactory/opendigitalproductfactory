// The GPP shape-document schema (PR-3a-1, BI-6DA17863). The Zod schema is the
// one definition; the committed JSON Schema 2020-12 is generated from it. No
// JSON Schema validator is a dependency, so these tests hold the in-process
// validator and the published contract equal by construction and by walking
// both.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { OUTCOME_DISPOSITIONS } from "@/lib/shared/outcome-disposition";
import { WORKROOM_SHAPE_KEYS } from "@/lib/work-management/room-shapes";
import { WORK_SHAPE_EVIDENCE_KINDS } from "@/lib/work-management/work-shape-evidence-kinds";
import { WORK_SHAPE_TRIGGER_CLASSES } from "@/lib/work-management/work-shapes";

import { serializeStableJson } from "../../../scripts/registry-generator-support";
import { GPP_SHAPE_SCHEMA_REL, runGppShapesGenerator } from "../../../scripts/build-gpp-shapes";
import {
  GPP_SHAPE_SCHEMA_ID,
  gppShapeDocumentSchema,
  gppShapeJsonSchema,
  gppShapeSchemaRegistry,
  isUniqueArraySchema,
} from "./gpp-shape-schema";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const COMMITTED_SCHEMA_PATH = join(__dirname, "gpp-shape.schema.json");
const WORKED_EXAMPLE_PATH = join(__dirname, "__fixtures__", "inquiry-response-watch.worked-example.gpp.json");

function workedExample(): JsonObject {
  return JSON.parse(readFileSync(WORKED_EXAMPLE_PATH, "utf8")) as JsonObject;
}

/** A document that carries every optional construct, so every object in §4.2 is present once. */
function maximalDocument(): JsonObject {
  const doc = workedExample();
  const stages = doc.stages as JsonObject[];
  stages[0].binding = {
    id: "draft-reach",
    version: 1,
    enforcement: "environment",
    subjectScope: "customer-inquiries",
    validity: { until: "stage-exit", maxDuration: "PT4H" },
    egress: ["list_customer_accounts"],
  };
  stages[0].deadline = { afterDays: 2, description: "Drafts are due within two days." };
  stages[0].subShape = "adopter-health-watch@1.0.0";
  const gate = (stages[1].advance as JsonObject).gate as JsonObject;
  gate.gateKey = "outbound-customer-communication";
  gate.resolver = { module: "@/lib/gpp/example-resolver", exportName: "resolve" };
  gate.advisory = [{ authority: "wwmd", gateKey: "brand-voice", blocking: false }];
  gate.checkpoint = { role: "role:customer-owner", exactAction: true };
  gate.onRefuse = "draft";
  doc.flow = {
    nodes: [
      { id: "fan-out", type: "parallel-split", pairs: "fan-in" },
      { id: "fan-in", type: "parallel-join", pairs: "fan-out" },
    ],
    edges: [{ from: "send", to: "draft", rework: { maxIterations: 2 } }],
  };
  return doc;
}

/** Every object node of the maximal document, by a getter, named for the failure message. */
const OBJECT_LOCATIONS: ReadonlyArray<readonly [string, (doc: JsonObject) => JsonObject]> = [
  ["document", (d) => d],
  ["stage", (d) => (d.stages as JsonObject[])[0]],
  ["advance (status-change)", (d) => (d.stages as JsonObject[])[0].advance as JsonObject],
  ["advance (governed-decision)", (d) => (d.stages as JsonObject[])[1].advance as JsonObject],
  ["gate", (d) => ((d.stages as JsonObject[])[1].advance as JsonObject).gate as JsonObject],
  ["gate.resolver", (d) => (((d.stages as JsonObject[])[1].advance as JsonObject).gate as JsonObject).resolver as JsonObject],
  ["gate.advisory[]", (d) => ((((d.stages as JsonObject[])[1].advance as JsonObject).gate as JsonObject).advisory as JsonObject[])[0]],
  ["checkpoint", (d) => (((d.stages as JsonObject[])[1].advance as JsonObject).gate as JsonObject).checkpoint as JsonObject],
  ["escalation", (d) => (((d.stages as JsonObject[])[1].advance as JsonObject).gate as JsonObject).escalation as JsonObject],
  ["binding", (d) => (d.stages as JsonObject[])[0].binding as JsonObject],
  ["binding.validity", (d) => ((d.stages as JsonObject[])[0].binding as JsonObject).validity as JsonObject],
  ["timer (stage.deadline)", (d) => (d.stages as JsonObject[])[0].deadline as JsonObject],
  ["stop", (d) => (d.stopConditions as JsonObject[])[0]],
  ["measure", (d) => (d.measures as JsonObject[])[0]],
  ["budget", (d) => (d.budgets as JsonObject[])[0]],
  ["reviewPoint", (d) => d.reviewPoint as JsonObject],
  ["flow", (d) => d.flow as JsonObject],
  ["flow.nodes[]", (d) => ((d.flow as JsonObject).nodes as JsonObject[])[0]],
  ["flow.edges[]", (d) => ((d.flow as JsonObject).edges as JsonObject[])[0]],
  ["flow.edges[].rework", (d) => ((d.flow as JsonObject).edges as JsonObject[])[0].rework as JsonObject],
];

/** JSON-pointer paths of every node satisfying `match`, walked over the whole published schema. */
function pointersWhere(node: Json, match: (n: JsonObject) => boolean, path = ""): string[] {
  if (Array.isArray(node)) return node.flatMap((child, i) => pointersWhere(child, match, `${path}/${i}`));
  if (node === null || typeof node !== "object") return [];
  const here = match(node) ? [path] : [];
  return here.concat(Object.entries(node).flatMap(([k, child]) => pointersWhere(child, match, `${path}/${k}`)));
}

type ZodNode = { _zod: { def: Record<string, unknown> } };

/**
 * Walk the Zod schema and return, in the published schema's pointer scheme, the
 * location of every array carrying the uniqueness refine. A schema registered
 * with an id is published under /$defs/<id>, so the walk restarts there.
 */
function zodUniquePointers(schema: ZodNode, path: string, seen: Set<string>): string[] {
  const meta = gppShapeSchemaRegistry.get(schema as never) as { id?: string } | undefined;
  if (meta?.id && path !== "") {
    const defPath = `/$defs/${meta.id}`;
    if (seen.has(defPath)) return [];
    seen.add(defPath);
    path = defPath;
  }
  const def = schema._zod.def;
  const here = isUniqueArraySchema(schema) ? [path] : [];
  switch (def.type) {
    case "object":
      return here.concat(
        Object.entries(def.shape as Record<string, ZodNode>).flatMap(([k, child]) =>
          zodUniquePointers(child, `${path}/properties/${k}`, seen),
        ),
      );
    case "array":
      return here.concat(zodUniquePointers(def.element as ZodNode, `${path}/items`, seen));
    case "optional":
      return here.concat(zodUniquePointers(def.innerType as ZodNode, path, seen));
    case "nullable":
      return here.concat(zodUniquePointers(def.innerType as ZodNode, `${path}/anyOf/0`, seen));
    case "union":
      return here.concat(
        (def.options as ZodNode[]).flatMap((option, i) => zodUniquePointers(option, `${path}/oneOf/${i}`, seen)),
      );
    case "record":
      return here.concat(zodUniquePointers(def.valueType as ZodNode, `${path}/additionalProperties`, seen));
    default:
      return here;
  }
}

describe("GPP shape document schema", () => {
  it("the committed JSON Schema equals the generated one", () => {
    const committed = readFileSync(COMMITTED_SCHEMA_PATH, "utf8");
    expect(committed).toBe(serializeStableJson(gppShapeJsonSchema()));
  });

  it("JSON Schema generation is deterministic and round-trips through JSON unchanged", () => {
    const first = serializeStableJson(gppShapeJsonSchema());
    const second = serializeStableJson(gppShapeJsonSchema());
    expect(second).toBe(first);
    expect(JSON.parse(first)).toEqual(gppShapeJsonSchema());
    expect(first).not.toMatch(/\r/);
  });

  it("the published schema is draft 2020-12, carries $id urn:dpf:gpp-shape:0.1, and every object schema is closed", () => {
    const schema = gppShapeJsonSchema() as unknown as JsonObject;
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.$id).toBe(GPP_SHAPE_SCHEMA_ID);
    expect(GPP_SHAPE_SCHEMA_ID).toBe("urn:dpf:gpp-shape:0.1");
    expect(schema.title).toBe("GPP shape document");

    const objectSchemas = pointersWhere(schema, (n) => n.type === "object");
    // Every object in §4.2: document, stage, two advance variants, gate, resolver,
    // advisory item, checkpoint, escalation, two binding variants (each with its
    // validity), timer, stop, measure, budget, reviewPoint, flow, flow node, flow
    // edge and rework.
    expect(objectSchemas.length).toBeGreaterThanOrEqual(OBJECT_LOCATIONS.length);
    const open = objectSchemas.filter((pointer) => {
      const node = pointer.split("/").slice(1).reduce<Json>((n, k) => (n as JsonObject)[k], schema) as JsonObject;
      return node.additionalProperties !== false;
    });
    expect(open).toEqual([]);
  });

  it("the §4.5 worked example document validates", () => {
    const parsed = gppShapeDocumentSchema.safeParse(workedExample());
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it("a document carrying every optional construct validates", () => {
    const parsed = gppShapeDocumentSchema.safeParse(maximalDocument());
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
  });

  it.each(OBJECT_LOCATIONS)("an unknown field on %s is rejected", (_name, locate) => {
    const doc = maximalDocument();
    locate(doc).unexpectedField = "not in the contract";
    const parsed = gppShapeDocumentSchema.safeParse(doc);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.code === "unrecognized_keys")).toBe(true);
    }
  });

  it("`tools` absent and `tools: []` both validate and stay distinct after parse", () => {
    const absent = workedExample();
    const empty = workedExample();
    delete (absent.stages as JsonObject[])[0].tools;
    (empty.stages as JsonObject[])[0].tools = [];

    const parsedAbsent = gppShapeDocumentSchema.parse(absent);
    const parsedEmpty = gppShapeDocumentSchema.parse(empty);
    expect("tools" in parsedAbsent.stages[0]).toBe(false);
    expect(parsedEmpty.stages[0].tools).toEqual([]);
  });

  it("an `environment` binding without `egress` is rejected; with it, it validates", () => {
    const withEgress = maximalDocument();
    expect(gppShapeDocumentSchema.safeParse(withEgress).success).toBe(true);

    const withoutEgress = maximalDocument();
    delete ((withoutEgress.stages as JsonObject[])[0].binding as JsonObject).egress;
    expect(gppShapeDocumentSchema.safeParse(withoutEgress).success).toBe(false);

    // Every other enforcement leaves egress optional.
    for (const enforcement of ["absent", "shadow", "enforced"]) {
      const doc = maximalDocument();
      const binding = (doc.stages as JsonObject[])[0].binding as JsonObject;
      binding.enforcement = enforcement;
      delete binding.egress;
      expect(gppShapeDocumentSchema.safeParse(doc).success, enforcement).toBe(true);
    }
  });

  it("every enum equals its owning vocabulary", () => {
    const schema = gppShapeJsonSchema() as unknown as JsonObject;
    const props = schema.properties as Record<string, JsonObject>;
    const defs = schema.$defs as Record<string, JsonObject>;

    expect((props.triggers.items as JsonObject).enum).toEqual([...WORK_SHAPE_TRIGGER_CLASSES]);
    expect(defs.evidenceKind.enum).toEqual([...WORK_SHAPE_EVIDENCE_KINDS]);
    expect(((props.collaborationShape.anyOf as JsonObject[])[0]).enum).toEqual([...WORKROOM_SHAPE_KEYS]);
    expect(((props.collaborationShape.anyOf as JsonObject[])[1]).type).toBe("null");
    expect(((defs.stop.properties as Record<string, JsonObject>).disposition).enum).toEqual([...OUTCOME_DISPOSITIONS]);
  });

  it("required sets, patterns and closed literals follow §4.2", () => {
    const schema = gppShapeJsonSchema() as unknown as JsonObject;
    const defs = schema.$defs as Record<string, JsonObject>;
    expect(schema.required).toEqual([
      "format", "key", "version", "title", "description", "triggers", "stages",
      "stopConditions", "grants", "measures", "budgets", "reviewPoint", "collaborationShape",
    ]);
    expect(defs.stage.required).toEqual(["key", "title", "accountablePrincipalRef", "advance", "evidence"]);
    expect(defs.gate.required).toEqual(["authority", "mode", "blocking", "resolution"]);
    expect(defs.stop.required).toEqual(["kind", "condition", "disposition"]);
    expect(defs.slug.pattern).toBe("^[a-z0-9][a-z0-9-]*$");
    expect(defs.semver.pattern).toBe("^\\d+\\.\\d+\\.\\d+$");
    expect(defs.principalRef.pattern).toBe("^(agent|role|person):.+$");
    expect(defs.toolName.pattern).toBe("^[a-z][a-z0-9_]*$");
    expect(defs.authority.enum).toEqual(["wwmd", "wwwd", "wsid"]);
    expect(((schema.properties as Record<string, JsonObject>).format).const).toBe("gpp-shape/0.1");
  });

  it("each set-typed array rejects a duplicate in-process", () => {
    const cases: ReadonlyArray<readonly [string, (doc: JsonObject) => void]> = [
      ["triggers", (d) => { d.triggers = ["cadence", "cadence"]; }],
      ["stage.evidence", (d) => { (d.stages as JsonObject[])[0].evidence = ["draft-artifact", "draft-artifact"]; }],
      ["stage.tools", (d) => { (d.stages as JsonObject[])[0].tools = ["list_customer_accounts", "list_customer_accounts"]; }],
    ];
    for (const [name, mutate] of cases) {
      const doc = workedExample();
      mutate(doc);
      expect(gppShapeDocumentSchema.safeParse(doc).success, name).toBe(false);
    }
  });

  it("every `uniqueItems` path in the JSON Schema has a matching Zod uniqueness refine, and the reverse", () => {
    const published = pointersWhere(gppShapeJsonSchema() as unknown as Json, (n) => n.uniqueItems === true).sort();
    const inProcess = zodUniquePointers(gppShapeDocumentSchema as unknown as ZodNode, "", new Set()).sort();
    expect(published).toEqual(["/$defs/stage/properties/evidence", "/$defs/stage/properties/mandatedTools", "/$defs/stage/properties/tools", "/properties/triggers"]);
    expect(inProcess).toEqual(published);
  });
});

describe("build-gpp-shapes --check", () => {
  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "gpp-shapes-"));
    mkdirSync(dirname(join(root, GPP_SHAPE_SCHEMA_REL)), { recursive: true });
    return root;
  }

  it("passes on the committed tree", async () => {
    const repoRoot = join(__dirname, "../../../../..");
    await expect(runGppShapesGenerator({ root: repoRoot, check: true })).resolves.toBeDefined();
  }, 120_000);

  it("fails when the committed file is stale, and passes once regenerated", async () => {
    const root = tempRoot();
    try {
      const stale = JSON.parse(readFileSync(COMMITTED_SCHEMA_PATH, "utf8")) as JsonObject;
      stale.title = "hand-edited";
      writeFileSync(join(root, GPP_SHAPE_SCHEMA_REL), serializeStableJson(stale), "utf8");
      await expect(runGppShapesGenerator({ root, check: true })).rejects.toThrow(/STALE - apps\/web\/lib\/gpp\/shape-language\/gpp-shape.schema.json/);

      await runGppShapesGenerator({ root, check: false });
      await expect(runGppShapesGenerator({ root, check: true })).resolves.toBeDefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("fails when the committed file is missing", async () => {
    const root = tempRoot();
    try {
      await expect(runGppShapesGenerator({ root, check: true })).rejects.toThrow(/STALE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
