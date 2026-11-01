import { compileShapeDocument, shapeDocumentDigest, type CompileShapeOptions, type CompileShapeResult } from "../kernel/gpp/compiler.js";
import { decompile, emitBindingRecords, legacyProjection, type GppDesignRulePolicy, type GppGate, type GppResolveSources, type GppShapeDocument } from "../kernel/gpp/browser.js";
import { startDriveMarking, stepDriveMarking } from "../kernel/workroom/index.js";
import { assert, equal, governedDocument, policy, ratification, routineDocument, sources } from "./fixtures.js";
import { mapGeneratedStage, syntheticReceiptFor, type SyntheticStageFacts } from "./stage-mapping.js";

const options: CompileShapeOptions = {
  sourcePath: "synthetic-read.gpp.json", typeImport: "../kernel/gpp/work-shape-contracts.js",
  policy, ratification: {}, directSites: new Map(),
};
const text = (document: GppShapeDocument) => JSON.stringify(document);
function rejected(result: CompileShapeResult, message: string): void {
  assert(!result.accepted && !("module" in result), message);
}
function reorder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reorder);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reorder(item)]));
  return value;
}
export async function runNodeSmoke() {
  const passed: string[] = [];
  const compile = (document = routineDocument(), overrides: Partial<CompileShapeOptions> = {}) => compileShapeDocument(text(document), sources(), { ...options, ...overrides });
  const compiled = await compile();
  assert(compiled.accepted, "supplied synthetic routine facts compile");
  const again = await compileShapeDocument(JSON.stringify(reorder(routineDocument()), null, 2), sources(), options);
  assert(again.accepted, "reordered source compiles");
  equal([compiled.digest, compiled.module, compiled.diagnostics], [again.digest, again.module, again.diagnostics], "source key order/whitespace do not change hashes, bytes or diagnostics");
  equal(shapeDocumentDigest(compiled.document), compiled.digest, "digest uses the extracted canonical compiler");
  equal(legacyProjection(decompile(compiled.definition, { ratification: {} }).document), legacyProjection(compiled.document), "legacy/decompile compatibility");
  assert(compiled.module.includes('from "../kernel/gpp/work-shape-contracts.js"'), "consumer supplies emitted type destination");
  passed.push("deterministic compile/digest/diagnostics/emitted bytes and legacy round trip");

  rejected(await compile(routineDocument(), { policy: undefined }), "missing host policy cannot emit");
  rejected(await compileShapeDocument(text(routineDocument()), { ...sources(), platformTools: new Set() }, options), "unregistered tools cannot emit");
  rejected(await compileShapeDocument(text(routineDocument()), { ...sources(), grantRequirement: () => null }, options), "absent grant mapping cannot emit");
  rejected(await compileShapeDocument(text(routineDocument()), { ...sources(), classify: () => null }, options), "registered tool without classification cannot emit");
  passed.push("missing policy, tool registration, grant mapping and classification refuse without output");
  const childDocument = routineDocument(); childDocument.stages[0]!.subShape = "synthetic-child@1.0.0";
  const childSources = { ...sources(), shapeVersionExists: (ref: string) => ["synthetic-child@1.0.0", "synthetic-grandchild@1.0.0"].includes(ref) };
  rejected(await compileShapeDocument(text(childDocument), childSources, options), "unread registered child cannot emit");
  rejected(await compileShapeDocument(text(childDocument), { ...childSources, shapeDefinition: (ref: string) => ref === "synthetic-child@1.0.0"
    ? { grants: ["synthetic:read"], stages: [{ key: "nested", tools: [], subShape: "synthetic-grandchild@1.0.0" }] } : null }, options), "unread transitive registered descendant cannot emit");
  passed.push("missing direct/transitive sub-shape facts refuse without output");

  const now = new Date("2026-10-18T12:00:00.000Z"), runKey = "synthetic:run:1";
  const marking = startDriveMarking(compiled.definition, runKey, now);
  for (const receipts of [[], [{ stageKey: "read", iteration: 0, runKey, kind: "blocked" }], [{ stageKey: "read", iteration: 0, runKey: "old-run", kind: "source-verified" }]])
    equal(stepDriveMarking(compiled.definition, marking, { receipts }, now).fired, null, "missing, blocked or another run's observation cannot advance");
  const step = stepDriveMarking(compiled.definition, marking, { receipts: [{ stageKey: "read", iteration: 0, runKey, kind: "source-verified" }] }, now);
  equal(step.fired, "read", "generated routine shape advances on the supplied host observation");
  equal(step.stopped, { stopId: "stop:success:1", kind: "success", disposition: "proceed" }, "generated model reaches its declared success stop");
  equal(marking.tokens.length, 1, "input marking remains immutable");
  passed.push("generated shape feeds the extracted Workroom marking step with run-bound host observations");

  const governed = await compile(governedDocument(), { ratification });
  assert(governed.accepted, "synthetic ratified governed shape compiles");
  rejected(await compile(governedDocument(), { ratification: {} }), "absent ratification cannot emit the typed gate");
  const drafts = emitBindingRecords([governed]);
  equal(drafts.map((draft) => ({ id: draft.bindingId, version: draft.version, attach: draft.attach, tools: draft.tools, authority: draft.authority })),
    [{ id: "synthetic-report-binding", version: 7, attach: { shapeRef: "synthetic-report@1.2.3", stageKey: "report" }, tools: ["write_synthetic_report"], authority: "wwwd" }], "draft binding preserves exact declaration identity and tool facts");
  assert(!("actorId" in drafts[0]!) && !("output" in drafts[0]!), "binding draft alone is neither assigned actor nor accepted output artifact");
  const facts: SyntheticStageFacts = { actorRef: "agent:synthetic-writer", actions: ["write_synthetic_report"],
    output: { kind: "synthetic-report-artifact", revision: 4, content: "Exact synthetic report bytes" },
    profile: { id: "synthetic-writer-profile", version: 3 }, binding: { id: "synthetic-report-binding", version: 7 },
    boundaryRef: "synthetic-data@2", effectBound: "synthetic-memory-only", costCeiling: 0, qualificationRef: "synthetic-test-facts@1" };
  const mapped = mapGeneratedStage(governed.definition, "report", facts);
  assert(mapped.mapped, "exact host-supplied actor/action/output/runtime facts map");
  equal([mapped.stage.actorRef, mapped.stage.actions, mapped.stage.output, mapped.stage.binding, mapped.stage.profile],
    [facts.actorRef, facts.actions, facts.output, facts.binding, facts.profile], "every actor/action/output/profile/binding field is preserved");
  equal(mapped.stage.owningScope, "wwwd", "owning gate authority remains separate from assigned actor");
  equal(mapped.stage.bindingEntry, { stageKey: "approve", decisionScope: "synthetic-report", authority: "wwwd", mode: "enforced" },
    "binding owner is the gate entering report, independently of its completion checkpoint");
  const distinctEntry = governedDocument();
  const entryAdvance = distinctEntry.stages[0]!.advance;
  assert(entryAdvance.kind === "governed-decision" && entryAdvance.gate, "entry gate fixture");
  entryAdvance.gate = { ...entryAdvance.gate, authority: "wsid", mode: "shadow" };
  const distinctMapping = mapGeneratedStage(distinctEntry, "report", facts);
  assert(distinctMapping.mapped && distinctMapping.stage.owningScope === "wsid"
    && distinctMapping.stage.bindingEntry?.mode === "shadow" && distinctMapping.stage.humanRef === "person:synthetic-owner",
    "entry binding scope/mode and exit human checkpoint remain separate facts");
  delete entryAdvance.gate;
  assert(!mapGeneratedStage(distinctEntry, "report", facts).mapped, "an exit gate cannot substitute for a missing binding entry gate");
  equal(mapped.stage.humanRef, "person:synthetic-owner", "exact checkpoint human remains separate from assigned executor");
  assert(mapped.stage.humanRequired && mapped.stage.qualification === "synthetic-only" && mapped.stage.unsupported.includes("whole-actor/session-envelope-qualification"), "typed gate/compile result never claims whole actor/session qualification");
  assert(!mapGeneratedStage(governed.definition, "report").mapped, "missing actor/envelope facts refuse");
  assert(!mapGeneratedStage(governed.definition, "report", { ...facts, binding: { id: facts.binding!.id, version: 8 } }).mapped, "binding version drift refuses");
  assert(!mapGeneratedStage(governed.definition, "report", { ...facts, output: { ...facts.output, kind: "" } }).mapped, "evidence vocabulary cannot invent output kind");
  const undeclared = governedDocument(); delete undeclared.stages[1]!.tools;
  assert(!mapGeneratedStage(undeclared, "report", facts).mapped, "absent tools do not become empty or inferred actions");
  const graph = governedDocument(); graph.flow = { nodes: [], edges: [] };
  assert(!mapGeneratedStage(graph, "report", facts).mapped, "unsupported graph exchange is not flattened");
  const observation = facts.output.content;
  equal(syntheticReceiptFor(mapped.stage, runKey, observation), null, "missing actual synthetic human decision holds");
  const exactPayload = JSON.stringify({ stage: mapped.stage, runKey, observation });
  equal(syntheticReceiptFor(mapped.stage, runKey, "changed output", { actorId: "person:synthetic-owner", exactPayload }), null, "changed admitted content holds");
  equal(syntheticReceiptFor(mapped.stage, runKey, observation, { actorId: "agent:synthetic-reviewer", exactPayload }), null, "reviewer cannot replace synthetic human fact");
  assert(syntheticReceiptFor(mapped.stage, runKey, observation, { actorId: "person:synthetic-owner", exactPayload }), "separate exact-content synthetic owner fact supplies an observation");
  const changedCheckpoint = JSON.parse(JSON.stringify(governedDocument())) as GppShapeDocument;
  const changedAdvance = changedCheckpoint.stages[1]!.advance;
  assert(changedAdvance.kind === "governed-decision" && changedAdvance.gate?.checkpoint, "typed checkpoint fixture");
  changedAdvance.gate.checkpoint.role = "person:replacement-owner";
  const changedMapping = mapGeneratedStage(changedCheckpoint, "report", facts);
  assert(changedMapping.mapped && changedMapping.stage.humanRef === "person:replacement-owner", "changed checkpoint maps its exact new human");
  const changedPayload = JSON.stringify({ stage: changedMapping.stage, runKey, observation });
  equal(syntheticReceiptFor(changedMapping.stage, runKey, observation, { actorId: "person:synthetic-owner", exactPayload: changedPayload }), null,
    "old human cannot approve the changed checkpoint even with newly matched payload bytes");
  assert(syntheticReceiptFor(changedMapping.stage, runKey, observation, { actorId: "person:replacement-owner", exactPayload: changedPayload }), "new exact checkpoint human supplies the observation");
  changedAdvance.gate.checkpoint.role = "role:unresolved-owner";
  assert(!mapGeneratedStage(changedCheckpoint, "report", facts).mapped, "unresolved human role cannot become an attributable person");
  const approval = mapGeneratedStage(governed.definition, "approve", { ...facts, actorRef: "person:synthetic-owner", actions: [],
    output: { kind: "synthetic-human-observation", revision: 1, content: "Exact synthetic human review bytes" }, binding: undefined });
  assert(approval.mapped && approval.stage.toolsDeclaration === "declared-empty", "explicit empty actions remain distinct from undeclared");
  const humanMarking = startDriveMarking(governed.definition, runKey, now);
  const absentHuman = syntheticReceiptFor(approval.stage, runKey, approval.stage.output.content);
  equal(stepDriveMarking(governed.definition, humanMarking, { receipts: absentHuman ? [absentHuman] : [] }, now).fired, null,
    "the synthetic host withholds the completing observation until its exact human decision");
  const ownerReceipt = syntheticReceiptFor(approval.stage, runKey, approval.stage.output.content, { actorId: "person:synthetic-owner",
    exactPayload: JSON.stringify({ stage: approval.stage, runKey, observation: approval.stage.output.content }) });
  assert(ownerReceipt, "exact synthetic owner decision supplies the receipt");
  equal(stepDriveMarking(governed.definition, humanMarking, { receipts: [ownerReceipt] }, now).fired, "approve",
    "the same generated model then consumes the host's admitted observation");
  passed.push("draft binding and strict serial host mapping preserve versions; missing/changed/human/unsupported facts hold");

  // Known negative fixture only: these tags are host facts, not fields supported by the source schema.
  const actorRef = "agent:synthetic-combination", sessionRef = "synthetic-session:combination:1";
  const capabilityFacts = [
    { stageKey: "ingest", tool: "read_untrusted_synthetic", grant: "synthetic:untrusted", capability: "untrusted-input" },
    { stageKey: "inspect", tool: "read_sensitive_synthetic", grant: "synthetic:sensitive", capability: "sensitive-read" },
    { stageKey: "change", tool: "change_synthetic_state", grant: "synthetic:change", capability: "state-change" },
  ].map((fact) => ({ ...fact, actorRef, sessionRef }));
  const combinationGate: GppGate = { authority: "wwwd", mode: "shadow", blocking: true, resolution: "doctrine-then-human",
    checkpoint: { role: "person:synthetic-owner", exactAction: true } };
  const combination: GppShapeDocument = { ...routineDocument(), key: "synthetic-combination",
    grants: capabilityFacts.map((fact) => fact.grant),
    stages: [{ key: "review-entry", title: "Declare the synthetic entry checkpoint", accountablePrincipalRef: "person:synthetic-owner",
      advance: { kind: "governed-decision", condition: "A label is not an actual human admission.", decisionScope: "synthetic-combination", gate: combinationGate },
      evidence: ["decision-record"], tools: [] }, ...capabilityFacts.map<GppShapeDocument["stages"][number]>((fact, index) => ({ key: fact.stageKey, title: `Synthetic ${fact.capability}`, accountablePrincipalRef: actorRef,
      advance: { kind: "governed-decision", condition: "An attributable decision would still be required for real admission.",
        decisionScope: "synthetic-combination", gate: combinationGate }, evidence: ["decision-record"], tools: [fact.tool],
      binding: { id: `synthetic-combination-${fact.stageKey}`, version: index + 1, enforcement: "shadow",
        subjectScope: "synthetic-combination-data", validity: { until: "stage-exit" } } }))] };
  const combinationSources: GppResolveSources = { ...sources(),
    knownAgents: new Set(["synthetic-combination"]), platformTools: new Set(capabilityFacts.map((fact) => fact.tool)),
    grantsFor: (id) => id === "synthetic-combination" ? capabilityFacts.map((fact) => fact.grant) : [],
    classify: (tool) => capabilityFacts.some((fact) => fact.tool === tool)
      ? { class: tool === "change_synthetic_state" ? "ordinary-mutation" : "routine-read", consequential: false, alignmentRequired: false } : null,
    consequence: () => null,
    grantRequirement: (tool) => { const fact = capabilityFacts.find((candidate) => candidate.tool === tool); return fact ? [fact.grant] : null; } };
  const combinationPolicy: GppDesignRulePolicy = { ...policy,
    isToolAllowedByGrants: (tool, grants) => capabilityFacts.some((fact) => fact.tool === tool && grants.includes(fact.grant)) };
  const combinationOptions: CompileShapeOptions = { ...options, policy: combinationPolicy,
    ratification: { "synthetic-combination": { status: "ratified", proposed: combinationGate,
      basis: "Synthetic gate vocabulary fact only; no actual class-admission decision.", decisionId: "DI-000000000001", ratifiedAt: "2026-10-18" } } };
  const capabilityStages = combination.stages.slice(1);
  for (const stage of capabilityStages) {
    const individual = await compileShapeDocument(text({ ...combination, stages: [combination.stages[0]!, stage] }), combinationSources, combinationOptions);
    assert(individual.accepted, `complete synthetic facts compile the individual ${stage.key} stage`);
    assert(individual.diagnostics.some((finding) => finding.rule === "C-5" && finding.severity === "not-evaluated"),
      "individual compilation cannot assess the actor/session combination");
  }
  const combined = await compileShapeDocument(text(combination), combinationSources, combinationOptions);
  assert(combined.accepted && combined.definition.stages.length === 4 && combined.definition.flow === undefined,
    "three capability stages and their entry checkpoint compile as one structural serial model");
  equal(combined.definition.stages.slice(1).map((stage) => stage.accountablePrincipalRef), [actorRef, actorRef, actorRef], "one actor owns all three capability stages");
  equal(capabilityFacts.map(({ actorRef: actor, sessionRef: session, capability }) => ({ actor, session, capability })),
    ["untrusted-input", "sensitive-read", "state-change"].map((capability) => ({ actor: actorRef, session: sessionRef, capability })),
    "the known full capability combination is spread across three stages in one explicit actor/session");
  assert(combined.diagnostics.some((finding) => finding.rule === "C-5" && finding.severity === "not-evaluated"),
    "structural compile acceptance still does not evaluate the full capability combination");
  type FavorableFixtureClaims = { individualStageChecksFavorable: true; structuralModelAccepted: true;
    validatorResult?: "favorable"; gateResolutionLabel?: "doctrine-then-human" };
  // No admit branch: this sample host cannot qualify or admit this known unsupported session.
  const refuseUnsupportedFixtureAdmission = (claims: FavorableFixtureClaims) => ({ admitted: false, disposition: "hold",
    qualification: "unsupported/unqualified whole-actor/session assessment", actorRef, sessionRef, claims,
    actualHumanDecision: null,
    requiredAccountableHumanDecision: { accountablePrincipalRef: "person:synthetic-owner", admitting: "the distinct combined capability class",
      bindings: capabilityStages.map((stage) => ({ id: stage.binding!.id, version: stage.binding!.version,
        subjectScope: stage.binding!.subjectScope, validity: stage.binding!.validity })) } });
  const favorableClaims: FavorableFixtureClaims[] = [
    { individualStageChecksFavorable: true, structuralModelAccepted: true },
    { individualStageChecksFavorable: true, structuralModelAccepted: true, validatorResult: "favorable" },
    { individualStageChecksFavorable: true, structuralModelAccepted: true, validatorResult: "favorable", gateResolutionLabel: "doctrine-then-human" },
  ];
  for (const claims of favorableClaims) {
    const admission = refuseUnsupportedFixtureAdmission(claims);
    assert(!admission.admitted && admission.disposition === "hold" && admission.actualHumanDecision === null,
      "favorable individual/validator facts or a doctrine-then-human label cannot admit the unsupported session");
    equal(admission.requiredAccountableHumanDecision, { accountablePrincipalRef: "person:synthetic-owner", admitting: "the distinct combined capability class",
      bindings: capabilityFacts.map((fact, index) => ({ id: `synthetic-combination-${fact.stageKey}`, version: index + 1,
        subjectScope: "synthetic-combination-data", validity: { until: "stage-exit" } })) },
      "GPP section 8 still requires an actual attributable human class decision covering binding versions, subject scope and validity");
  }
  passed.push("three-stage same-actor/session capability combination remains C-5 unassessed and explicitly held despite favorable checks or gate labels");
  return { passed, generatedModule: compiled.module,
    qualification: "Synthetic compiler and marking mechanics only. No authentication, tool execution, qualified enforcement, GPP 0.19 actor/session aggregation or production admission." };
}
