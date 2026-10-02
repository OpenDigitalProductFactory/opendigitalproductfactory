// Resolve with injected sources (PR-3b-1, BI-6DA17863). Design:
// docs/superpowers/specs/2026-10-02-gpp-shape-notation-and-compiler-design.md
// §7.1 step 3; plan: docs/superpowers/plans/
// 2026-10-02-gpp-shape-notation-compiler-phase-3.md (PR-3b-1, risk R6).
// Failing before: resolve.ts did not exist.
//
// resolve.ts must never reach a database: `@dpf/db` and the tool registry
// (whose module graph constructs a Prisma client) are made UNIMPORTABLE here.
// If resolve.ts, or anything it imports, ever loaded either, this whole file
// would fail to import. The seed-backed default sources are tested, with a
// connection spy, in resolve-sources.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => {
  throw new Error("resolve.ts must not import @dpf/db (plan risk R6)");
});
vi.mock("@dpf/db/workforce-seed", () => {
  throw new Error("resolve.ts must not import the workforce seed; sources are injected");
});
vi.mock("@/lib/mcp-tools", () => {
  throw new Error("resolve.ts must not import the tool registry; sources are injected");
});

import type { ConsequentialToolClassification } from "@/lib/tak/consequential-tool-policy";

import { gppShapeDocumentSchema, type GppShapeDocument } from "./gpp-shape-schema";
import { resolveShapeDocument, type GppResolveSources } from "./resolve";

const WORKED_EXAMPLE = gppShapeDocumentSchema.parse(
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", "inquiry-response-watch.worked-example.gpp.json"), "utf8")),
);

const READ: ConsequentialToolClassification = {
  class: "routine-read",
  consequential: false,
  alignmentRequired: false,
  preconditionRequired: false,
  collaborationShape: null,
  reason: "read-only",
};
const OUTWARD: ConsequentialToolClassification = {
  class: "consequential-mutation",
  consequential: true,
  alignmentRequired: true,
  preconditionRequired: false,
  collaborationShape: "outward-review",
  reason: "declared-outward",
};

function fakeSources(overrides: Partial<GppResolveSources> = {}) {
  const calls = { importResolver: [] as Array<[string, string]>, shapeVersionExists: [] as string[] };
  const sources: GppResolveSources = {
    platformTools: new Set(["list_storefront_activity", "list_customer_accounts", "send_customer_email"]),
    grantsFor: (agentId) => (agentId === "customer-advisor" ? ["storefront_read", "customer_read"] : []),
    knownAgents: new Set(["customer-advisor"]),
    classify: (toolName) => (toolName === "send_customer_email" ? OUTWARD : READ),
    grantRequirement: (toolName) => (toolName === "list_customer_accounts" ? ["customer_read"] : toolName === "nope" ? null : ["storefront_read"]),
    importResolver: async (module, exportName) => {
      calls.importResolver.push([module, exportName]);
      return module === "lib/tak/alignment-tool-gate" && exportName === "runTakAlignmentGate";
    },
    shapeVersionExists: (ref) => {
      calls.shapeVersionExists.push(ref);
      return ref === "inquiry-response-watch@1.0.0";
    },
    ...overrides,
  };
  return { sources, calls };
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("resolveShapeDocument returns facts from its injected sources", () => {
  it("the worked example: tools, principals and the gate, in document order", async () => {
    const { sources, calls } = fakeSources();
    const resolution = await resolveShapeDocument(WORKED_EXAMPLE, sources);
    expect(resolution).toEqual({
      shapeElementId: "shape:inquiry-response-watch@1.0.0",
      stages: [
        {
          elementId: "stage:draft",
          stageKey: "draft",
          principal: { kind: "agent", ref: "agent:customer-advisor", agentId: "customer-advisor", known: true, grants: ["storefront_read", "customer_read"] },
          tools: [
            {
              elementId: "tool:draft:list_storefront_activity",
              stageKey: "draft",
              toolName: "list_storefront_activity",
              registered: true,
              consequenceClass: "routine-read",
              consequential: false,
              alignmentRequired: false,
              grantRequirement: ["storefront_read"],
            },
            {
              elementId: "tool:draft:list_customer_accounts",
              stageKey: "draft",
              toolName: "list_customer_accounts",
              registered: true,
              consequenceClass: "routine-read",
              consequential: false,
              alignmentRequired: false,
              grantRequirement: ["customer_read"],
            },
          ],
        },
        {
          elementId: "stage:send",
          stageKey: "send",
          principal: { kind: "role", ref: "role:customer-owner" },
          gate: { elementId: "gate:send" },
        },
      ],
    });
    // No resolver and no sub-shape in the document, so neither source was asked.
    expect(calls).toEqual({ importResolver: [], shapeVersionExists: [] });
  });

  it("an unregistered tool and an unknown agent are facts, not errors", async () => {
    const document: GppShapeDocument = clone(WORKED_EXAMPLE);
    document.stages[0].accountablePrincipalRef = "agent:ghost";
    document.stages[0].tools = ["nope"];
    const { sources } = fakeSources();
    const [draft] = (await resolveShapeDocument(document, sources)).stages;
    expect(draft.principal).toEqual({ kind: "agent", ref: "agent:ghost", agentId: "ghost", known: false, grants: [] });
    expect(draft.tools).toEqual([
      {
        elementId: "tool:draft:nope",
        stageKey: "draft",
        toolName: "nope",
        registered: false,
        consequenceClass: null,
        consequential: null,
        alignmentRequired: null,
        grantRequirement: null,
      },
    ]);
  });

  it("the O/A/I fact comes from classify", async () => {
    const document: GppShapeDocument = clone(WORKED_EXAMPLE);
    document.stages[1].tools = ["send_customer_email"];
    const [, send] = (await resolveShapeDocument(document, fakeSources().sources)).stages;
    expect(send.tools?.[0]).toMatchObject({ consequential: true, consequenceClass: "consequential-mutation", alignmentRequired: true });
  });

  it("gate resolvers, sub-shape references and binding egress are each looked up", async () => {
    const document: GppShapeDocument = clone(WORKED_EXAMPLE);
    const advance = document.stages[1].advance;
    if (advance.kind !== "governed-decision" || !advance.gate) throw new Error("fixture changed");
    advance.gate.resolver = { module: "lib/tak/alignment-tool-gate", exportName: "runTakAlignmentGate" };
    document.stages[0].subShape = "missing-shape@2.0.0";
    document.stages[1].subShape = "inquiry-response-watch@1.0.0";
    document.stages[1].binding = { id: "send-out", version: 1, enforcement: "environment", egress: ["send_customer_email", "fax_it"] };
    const { sources, calls } = fakeSources();
    const [draft, send] = (await resolveShapeDocument(document, sources)).stages;
    expect(draft.subShape).toEqual({ ref: "missing-shape@2.0.0", exists: false });
    expect(send.subShape).toEqual({ ref: "inquiry-response-watch@1.0.0", exists: true });
    expect(send.gate).toEqual({
      elementId: "gate:send",
      resolver: { module: "lib/tak/alignment-tool-gate", exportName: "runTakAlignmentGate", exists: true },
    });
    expect(send.binding).toEqual({
      elementId: "binding:send-out@1",
      egress: [
        { toolName: "send_customer_email", registered: true },
        { toolName: "fax_it", registered: false },
      ],
    });
    expect(calls.importResolver).toEqual([["lib/tak/alignment-tool-gate", "runTakAlignmentGate"]]);
  });

  it("returns no verdict: nothing in a resolution is a pass, fail or severity", async () => {
    const text = JSON.stringify(await resolveShapeDocument(WORKED_EXAMPLE, fakeSources().sources));
    expect(text).not.toMatch(/"(severity|verdict|pass|ok|rule)"/);
  });

  it("does not mutate the document or share arrays with its sources", async () => {
    const before = JSON.stringify(WORKED_EXAMPLE);
    const grants = ["storefront_read"];
    const resolution = await resolveShapeDocument(WORKED_EXAMPLE, fakeSources({ grantsFor: () => grants }).sources);
    expect(JSON.stringify(WORKED_EXAMPLE)).toBe(before);
    const principal = resolution.stages[0].principal;
    expect(principal.kind === "agent" && principal.grants).not.toBe(grants);
  });
});
