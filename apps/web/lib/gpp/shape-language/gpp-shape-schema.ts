// apps/web/lib/gpp/shape-language/gpp-shape-schema.ts
//
// The GPP shape document — one definition, in Zod, of the JSON-Schema superset
// of WorkShapeDefinition that DI-035897A0F1D6 (WWMD) makes the source of truth
// for a work shape. Design: docs/superpowers/specs/
// 2026-10-02-gpp-shape-notation-and-compiler-design.md §4.2; plan:
// docs/superpowers/plans/2026-10-02-gpp-shape-notation-compiler-phase-3.md
// (PR-3a-1, BI-6DA17863).
//
// The published contract, gpp-shape.schema.json beside this file, is GENERATED
// from this module (`pnpm --filter web build:gpp-shapes`) and committed; a test
// and `check:gpp-shapes` fail when it differs from a fresh generation. Edit
// this file, never the JSON. The generated file is the contract; §4.2 is its
// semantic description, and the structural differences Zod's emitter makes
// (a discriminated `oneOf` in place of §4.2's `if`/`then` for the environment
// → egress rule, `anyOf [enum, null]` for collaborationShape, an explicit
// integer `maximum`) are accepted on purpose (plan risk R1).
//
// Rules this schema keeps:
// - Closed at every level (`z.strictObject`): an unknown field is an error,
//   which is what keeps decompile/recompile honest.
// - Vocabularies with one owner are derived, never restated: triggers,
//   evidence kinds, collaboration shapes, stop dispositions.
// - Set-typed arrays carry a uniqueness refine; JSON Schema generation adds
//   `uniqueItems: true` at exactly those paths through the `override` callback.
//   No JSON Schema validator is a dependency, so the test suite holds the two
//   equal (plan risk R2).
// - `tools` absent and `tools: []` differ: absent is "undeclared", as today.
// - Consequence class is never authored; element ids are derived, not stored.
//
// OFFLINE TOOLING in Phase 3a: nothing in the running app imports this module.

import { z } from "zod";

import { OUTCOME_DISPOSITIONS } from "@/lib/shared/outcome-disposition";
import { WORKROOM_SHAPE_KEYS } from "@/lib/work-management/room-shapes";
import { WORK_SHAPE_EVIDENCE_KINDS } from "@/lib/work-management/work-shape-evidence-kinds";
import {
  WORK_SHAPE_TRIGGER_CLASSES,
  type WorkShapeBudget,
  type WorkShapeDefinition,
  type WorkShapeStopCondition,
} from "@/lib/work-management/work-shapes";

export const GPP_SHAPE_FORMAT = "gpp-shape/0.1";
export const GPP_SHAPE_SCHEMA_ID = "urn:dpf:gpp-shape:0.1";
/** `<key>@<version>` — a sub-shape reference, and the layout sidecar's `shape`. */
export const GPP_SHAPE_REF_PATTERN = /^[a-z0-9][a-z0-9-]*@\d+\.\d+\.\d+$/;

type GppSchemaMeta = { id?: string; title?: string; description?: string };

/**
 * Metadata for JSON Schema generation. A local registry, not Zod's global one,
 * so the `$defs` names below cannot collide with any other schema in the app.
 */
export const gppShapeSchemaRegistry = z.registry<GppSchemaMeta>();

function named<T extends z.ZodType>(id: string, schema: T, description?: string): T {
  gppShapeSchemaRegistry.add(schema, description ? { id, description } : { id });
  return schema;
}

/** A description in the published schema. Never `.describe()`, which writes Zod's global registry. */
function described<T extends z.ZodType>(schema: T, description: string): T {
  gppShapeSchemaRegistry.add(schema, { description });
  return schema;
}

const UNIQUE_ARRAYS = new WeakSet<object>();

/** An array whose items form a set. The refine is the in-process rule; the marker drives `uniqueItems`. */
function uniqueArray<T extends z.ZodType>(item: T, options: { minItems?: number } = {}) {
  const base = options.minItems === undefined ? z.array(item) : z.array(item).min(options.minItems);
  const schema = base.refine((values) => new Set(values).size === values.length, {
    message: "Items must be unique.",
  });
  UNIQUE_ARRAYS.add(schema);
  return schema;
}

/** True for the Zod schema of a set-typed array. Exported for the refine ↔ `uniqueItems` parity test. */
export function isUniqueArraySchema(schema: unknown): boolean {
  return typeof schema === "object" && schema !== null && UNIQUE_ARRAYS.has(schema);
}

// Closed axes owned by a TypeScript union rather than a runtime list. Each is
// checked against its owner at compile time below, both directions.
const STOP_KINDS = ["success", "failure", "budget"] as const satisfies readonly WorkShapeStopCondition["kind"][];
const BUDGET_KINDS = ["findings-per-run", "cycles-per-window", "spend"] as const satisfies readonly WorkShapeBudget["kind"][];

const nonEmptyString = () => z.string().min(1);

const slug = named("slug", z.string().regex(/^[a-z0-9][a-z0-9-]*$/));
const semver = named("semver", z.string().regex(/^\d+\.\d+\.\d+$/));
const principalRef = named("principalRef", z.string().regex(/^(agent|role|person):.+$/));
const toolName = named("toolName", z.string().regex(/^[a-z][a-z0-9_]*$/));
const authority = named("authority", z.enum(["wwmd", "wwwd", "wsid"]));
const evidenceKind = named(
  "evidenceKind",
  z.enum(WORK_SHAPE_EVIDENCE_KINDS),
  "Generated from WORK_SHAPE_EVIDENCE_KINDS (work-shape-evidence-kinds.ts).",
);

const checkpoint = named(
  "checkpoint",
  z.strictObject({ role: principalRef, exactAction: z.boolean() }),
  "(new) Human checkpoint. exactAction binds approval to the call's paramHash.",
);

const escalation = named(
  "escalation",
  z.strictObject({ role: principalRef, whileWaiting: z.literal("hold") }),
  "(new) GPP §7 element 9.",
);

const gate = named(
  "gate",
  z.strictObject({
    authority,
    gateKey: nonEmptyString().optional(),
    mode: z.enum(["shadow", "enforced"]),
    blocking: z.boolean(),
    resolution: z.enum(["doctrine", "accountable-human", "doctrine-then-human"]),
    resolver: z.strictObject({ module: z.string(), exportName: z.string() }).optional(),
    advisory: z
      .array(
        z.strictObject({
          authority,
          gateKey: z.string().optional(),
          blocking: z.literal(false).optional(),
        }),
      )
      .optional(),
    checkpoint: checkpoint.optional(),
    escalation: escalation.optional(),
    onRefuse: described(
      nonEmptyString(),
      "Where a refuse verdict sends the token: a stop id or an earlier stage key.",
    ).optional(),
  }),
  "(new) Typed gate fields. GPP §7 elements 3, 4, 9, 11.",
);

const advance = named(
  "advance",
  z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("status-change"), condition: nonEmptyString() }),
    z.strictObject({
      kind: z.literal("governed-decision"),
      condition: nonEmptyString(),
      decisionScope: nonEmptyString(),
      gate: gate.optional(),
    }),
  ]),
);

const bindingValidity = z.strictObject({
  until: z.literal("stage-exit"),
  maxDuration: z.string().regex(/^P(\d+D)?(T(\d+H)?(\d+M)?)?$/).optional(),
});

// §4.2 states "egress is required when enforcement is environment" as an
// `if`/`then`. A discriminated union on `enforcement` is the same rule in a
// form Zod can both enforce and emit.
const binding = named(
  "binding",
  z.discriminatedUnion("enforcement", [
    z.strictObject({
      id: slug,
      version: z.int().min(1),
      enforcement: z.enum(["absent", "shadow", "enforced"]),
      subjectScope: z.string().optional(),
      validity: bindingValidity.optional(),
      egress: z.array(toolName).optional(),
    }),
    z.strictObject({
      id: slug,
      version: z.int().min(1),
      enforcement: z.literal("environment"),
      subjectScope: z.string().optional(),
      validity: bindingValidity.optional(),
      egress: described(z.array(toolName), "Declared ports out of an environment boundary."),
    }),
  ]),
  "(new) The stage's Gated Permission binding. Version is separate from the shape version (GPP §2.1.1).",
);

const timer = named(
  "timer",
  z.strictObject({ afterDays: z.number().positive(), description: z.string() }),
  "(new) Stage deadline. Raises a deadline event; never moves the token.",
);

const stage = named(
  "stage",
  z.strictObject({
    key: slug,
    title: nonEmptyString(),
    accountablePrincipalRef: principalRef,
    advance,
    evidence: uniqueArray(evidenceKind),
    tools: described(uniqueArray(toolName), "Capability set. Absent means undeclared, exactly as today.").optional(),
    binding: binding.optional(),
    deadline: timer.optional(),
    subShape: z.string().regex(GPP_SHAPE_REF_PATTERN).optional(),
  }),
);

const stop = named(
  "stop",
  z.strictObject({
    kind: z.enum(STOP_KINDS),
    condition: nonEmptyString(),
    disposition: z.enum(OUTCOME_DISPOSITIONS),
  }),
);

const flow = named(
  "flow",
  z.strictObject({
    nodes: z.array(
      z.strictObject({
        id: slug,
        type: z.enum(["parallel-split", "parallel-join"]),
        pairs: slug.optional(),
      }),
    ),
    edges: z.array(
      z.strictObject({
        from: nonEmptyString(),
        to: nonEmptyString(),
        rework: z.strictObject({ maxIterations: z.int().min(1) }).optional(),
      }),
    ),
  }),
  "(new) Explicit graph. Absent means the sequential flow every current shape has.",
);

export const gppShapeDocumentSchema = z.strictObject({
  format: z.literal(GPP_SHAPE_FORMAT),
  key: slug,
  version: semver,
  title: nonEmptyString(),
  description: nonEmptyString(),
  triggers: uniqueArray(z.enum(WORK_SHAPE_TRIGGER_CLASSES), { minItems: 1 }),
  stages: z.array(stage).min(1),
  flow: flow.optional(),
  stopConditions: z.array(stop).min(1),
  grants: z.array(nonEmptyString()),
  measures: z.array(z.strictObject({ key: slug, description: z.string() })),
  budgets: z.array(z.strictObject({ kind: z.enum(BUDGET_KINDS), limit: z.number(), unit: z.string() })),
  reviewPoint: z.strictObject({ everyDays: z.number().positive(), description: z.string() }),
  collaborationShape: z.enum(WORKROOM_SHAPE_KEYS).nullable(),
});
gppShapeSchemaRegistry.add(gppShapeDocumentSchema, { title: "GPP shape document" });

export type GppShapeDocument = z.infer<typeof gppShapeDocumentSchema>;
export type GppGate = z.infer<typeof gate>;
export type GppBinding = z.infer<typeof binding>;

// Compile-time contracts (no runtime cost). A failure here is a build error.
type AssertTrue<T extends true> = T;
type Equivalent<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type GppShapeSchemaContracts = [
  AssertTrue<Equivalent<(typeof STOP_KINDS)[number], WorkShapeStopCondition["kind"]>>,
  AssertTrue<Equivalent<(typeof BUDGET_KINDS)[number], WorkShapeBudget["kind"]>>,
  // A document minus `format` is a WorkShapeDefinition: every field it adds is optional.
  AssertTrue<Omit<GppShapeDocument, "format"> extends WorkShapeDefinition ? true : false>,
];

/** The published JSON Schema 2020-12 for the shape document. Same shape as `trustedArtifactJsonSchema`. */
export function gppShapeJsonSchema() {
  return {
    ...z.toJSONSchema(gppShapeDocumentSchema, {
      target: "draft-2020-12",
      metadata: gppShapeSchemaRegistry,
      override: ({ zodSchema, jsonSchema }) => {
        if (UNIQUE_ARRAYS.has(zodSchema)) jsonSchema.uniqueItems = true;
      },
    }),
    $id: GPP_SHAPE_SCHEMA_ID,
  };
}
