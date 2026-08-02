import {
  duplicates,
  hasSemanticContent,
  parseMarkdownRow,
  parseMarkdownTable,
  section,
  withoutHtmlComments,
} from "./fpaw-standard-conformance";
import {
  EXPECTED_CSDM_MAP_ROWS,
  EXPECTED_CSDM_RELATION_ROWS,
  EXPECTED_IT4IT_BACKBONE_ROWS,
  EXPECTED_IT4IT_CARDINALITY_ROWS,
  EXPECTED_IT4IT_COMPONENT_ROWS,
  EXPECTED_IT4IT_SUPPORTING_ROWS,
} from "./fpaw-external-bridge-contracts";

const EXPECTED_ANCHOR_PROFILES = [
  "FPAW-Core-Semantic",
  "FPAW-Four-Portfolio",
  "FPAW-Business-Offering-Value",
  "FPAW-Operational-Work",
  "FPAW-Workforce-AI",
  "FPAW-AI-Coworker-DigitalProduct-Lifecycle",
  "FPAW-Industry-Archetype",
  "FPAW-Assurance-Evidence",
  "FPAW-Publication-Governance",
] as const;

const EXPECTED_EXECUTION_MEDIA = [
  "software-executed",
  "human-cognitive",
  "physical-actuation",
] as const;

const EXPECTED_PHYSICAL_FIELD_GROUPS = [
  "PHY-SITE",
  "PHY-ASSET",
  "PHY-CUSTODY",
  "PHY-SAFETY",
  "PHY-CONDITION",
  "PHY-OBSERVATION",
  "PHY-INCIDENT",
] as const;

const EXPECTED_BINDING_STATES = [
  "candidate",
  "approved",
  "active",
  "suspended",
  "retired",
] as const;

const EXPECTED_BINDING_COMPATIBILITY = [
  "compatible",
  "segregated",
  "incompatible",
  "undetermined",
] as const;

const EXPECTED_GAP_STATES = [
  "open",
  "verification-pending",
  "closed",
  "superseded",
] as const;

const EXPECTED_IT4IT_STAGE_ROWS = [
  ["IT4IT-VS-EVALUATE", "Gather Influencers → Identify Gaps → Propose Investments → Define Backlog Mandates → Ensure Governance"],
  ["IT4IT-VS-EXPLORE", "Prioritize Backlog Items → Define Digital Product Architecture → Refine Product Backlog → Finalize Roadmap & Scope Agreement"],
  ["IT4IT-VS-INTEGRATE", "Plan Product Release → Design & Develop → Build, Integrate, & Test → Accept & Publish Release"],
  ["IT4IT-VS-DEPLOY", "Plan & Approve Deployment → Fulfill Deployment → Validate Deployment → Observe Deployment"],
  ["IT4IT-VS-RELEASE", "Define Service Offer → Implement Service Offer → Publish Service Offer"],
  ["IT4IT-VS-CONSUME", "Select an Offer → Agree to Service Offer → Subscribe to Service Offer → Provide Service Support → Publish Service Status"],
  ["IT4IT-VS-OPERATE", "Detect Issue → Diagnose Issue → Resolve Issue"],
] as const;

const EXPECTED_IT4IT_VALUE_STREAM_MAPS = [
  "IT4IT-MAP-VS-EVALUATE-001",
  "IT4IT-MAP-VS-EXPLORE-001",
  "IT4IT-MAP-VS-INTEGRATE-001",
  "IT4IT-MAP-VS-DEPLOY-001",
  "IT4IT-MAP-VS-RELEASE-001",
  "IT4IT-MAP-VS-CONSUME-001",
  "IT4IT-MAP-VS-OPERATE-001",
] as const;

const EXPECTED_IT4IT_FUNCTIONAL_GROUPS = [
  [
    "IT4IT-MAP-FG-S2P-001",
    "Strategy: Policy, Strategy, Enterprise Architecture. Portfolio: Portfolio Backlog, Proposal, Product Portfolio.",
  ],
  [
    "IT4IT-MAP-FG-R2D-001",
    "Develop: Product Backlog, Requirement, Product Design, Source Control, Pipeline, Build Package, Release Composition. Test: Test, Defect.",
  ],
  [
    "IT4IT-MAP-FG-R2F-001",
    "Consume: Consumption Experience, Identity, Offer, Order, Chargeback. Fulfill: Change, Fulfillment Orchestration, Resource, Fulfillment, Usage.",
  ],
  [
    "IT4IT-MAP-FG-D2C-001",
    "Support: Service Level, Incident, Problem, Knowledge. Assure: Configuration, Monitoring, Event, Diagnostics & Remediation.",
  ],
] as const;

function compact(body: string): string {
  return withoutHtmlComments(body).replace(/\s+/g, " ").trim();
}

function sameOrdered(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function pipeValues(value: string | undefined): string[] {
  return value?.split("|").map((part) => part.trim()).filter(Boolean) ?? [];
}

function validateAnchorContract(core: string, errors: string[]): void {
  const anchorSection = section(
    core,
    "Profile scope is non-vacuous.",
    "Two conditional closures are additive",
  );
  const anchorTable = parseMarkdownTable(
    anchorSection,
    "Profile",
    2,
    "core: mandatory-anchor table",
    errors,
    ["Profile", "Mandatory non-empty characteristic anchors"],
  );
  const profiles = anchorTable.rows.flatMap((cells) => {
    const profile = cells[0]?.match(/^`(FPAW-[A-Za-z-]+)`$/)?.[1];
    if (!profile || !hasSemanticContent(cells[1] ?? "")) {
      errors.push(`core: malformed mandatory-anchor row ${cells.join(" | ")}`);
      return [];
    }
    return [profile];
  });
  if (!sameOrdered(profiles, EXPECTED_ANCHOR_PROFILES)) {
    errors.push(
      `core: mandatory-anchor profile set must be exactly ordered [${EXPECTED_ANCHOR_PROFILES}], found [${profiles}]`,
    );
  }

  const prose = compact(anchorSection);
  const noSubstitution =
    "A Gap may document that a mandatory anchor is missing during a readiness assessment, but it is not the anchor and cannot make the scope non-empty.";
  const blocksConformance =
    "Any Gap against a mandatory characteristic anchor blocks conformance to that profile until the required object exists and the Gap is verified closed.";
  if (!prose.includes(noSubstitution) || !prose.includes(blocksConformance)) {
    errors.push("core: Gap cannot substitute for mandatory profile anchors");
  }
}

function validateExecutionMedia(core: string, errors: string[]): void {
  const workUnitSection = section(core, "### 9.2 Work-unit definition", "### 9.3 Physical");
  const compactWorkUnit = compact(workUnitSection);
  if (!compactWorkUnit.includes("It also **MUST** declare a non-empty `executionMedia` set drawn from:")) {
    errors.push("core: executionMedia must be declared as a non-empty set");
  }
  const mediaRegister = section(workUnitSection, "It also **MUST** declare", "`hybrid` is a derived label");
  const media = [...mediaRegister.matchAll(/^- `([^`]+)` —/gm)].map((match) => match[1]);
  if (!sameOrdered(media, EXPECTED_EXECUTION_MEDIA)) {
    errors.push(`core: executionMedia values must be exactly [${EXPECTED_EXECUTION_MEDIA}], found [${media}]`);
  }
  if (!compactWorkUnit.includes(
    "`hybrid` is a derived label only when the set contains more than one value; it is not a fourth value",
  )) {
    errors.push("core: executionMedia hybrid must remain a derived label");
  }

  const physicalSection = section(core, "### 9.3 Physical and non-digital work", "## 10.");
  const physicalTable = parseMarkdownTable(
    physicalSection,
    "Field-group key",
    2,
    "core: physical field-group table",
    errors,
    ["Field-group key", "Required concern set"],
  );
  const keys = physicalTable.rows.flatMap((cells) => {
    const key = cells[0]?.match(/^`(PHY-[A-Z-]+)`$/)?.[1];
    if (!key || !hasSemanticContent(cells[1] ?? "")) {
      errors.push(`core: malformed physical field-group row ${cells.join(" | ")}`);
      return [];
    }
    return [key];
  });
  if (!sameOrdered(keys, EXPECTED_PHYSICAL_FIELD_GROUPS)) {
    errors.push(
      `core: physical field-group keys must be exactly ordered [${EXPECTED_PHYSICAL_FIELD_GROUPS}], found [${keys}]`,
    );
  }
}

function validateAiBindingContract(core: string, errors: string[]): void {
  const bindingSection = section(core, "### 11.3 Product-to-runtime chain", "### 11.4");
  const prose = compact(bindingSection);
  const states = pipeValues(bindingSection.match(/`bindingState` uses exactly `([^`]+)`/)?.[1]);
  if (!sameOrdered(states, EXPECTED_BINDING_STATES)) {
    errors.push(`core: AI binding states must be exactly [${EXPECTED_BINDING_STATES}], found [${states}]`);
  }
  const compatibility = pipeValues(
    bindingSection.match(/AIProductBindingCompatibility\.disposition uses exactly `([^`]+)`/)?.[1],
  );
  if (!sameOrdered(compatibility, EXPECTED_BINDING_COMPATIBILITY)) {
    errors.push(
      `core: AI binding compatibility states must be exactly [${EXPECTED_BINDING_COMPATIBILITY}], found [${compatibility}]`,
    );
  }
  const compatibilityClauses = [
    "It is a pairwise relation, not one scalar field on a binding.",
    "For every pair of bindings with the same subject/role whose effective periods overlap in `active`, exactly one current compatibility relation exists, keyed by the lexically ordered pair of binding IDs plus the evaluated overlap period.",
    "One binding can therefore have different evidenced dispositions against different peers.",
  ];
  if (compatibilityClauses.some((clause) => !prose.includes(clause))) {
    errors.push("core: pairwise AI binding compatibility contract is incomplete");
  }

  const lifecycleClauses = [
    "Each binding references exactly one DigitalProductRelease, one operating-profile fingerprint, and one AgentSubjectReference, plus zero or one DigitalProductInstance:",
    "`active` additionally requires exactly one deployed instance and current runtime policy evidence.",
    "`retired` is terminal.",
  ];
  if (lifecycleClauses.some((clause) => !prose.includes(clause))) {
    errors.push("core: AI binding lifecycle contract is incomplete");
  }
  const assignmentClause =
    "Every AI-Performer WorkAssignment references exactly one active AIProductOperatingBinding and its current TAK-JSI qualification; a non-AI assignment references none.";
  if (!prose.includes(assignmentClause)) {
    errors.push("core: AI binding assignment contract is incomplete");
  }
  const evidenceClause =
    "Every Evidence record that supports an AI WorkAssignment or an `operated` implementation-state claim references exactly one binding that was `active` at `observedAt`, its one deployed instance, and the qualification/policy versions effective at that time.";
  if (!prose.includes(evidenceClause)) {
    errors.push("core: AI binding evidence contract is incomplete");
  }
}

function validateGapReopening(core: string, errors: string[]): void {
  const gapSection = section(core, "### 15.3 Assessment scales", "### 15.4 Gap record");
  const states = pipeValues(gapSection.match(/- verification state: `([^`]+)`/)?.[1]);
  if (!sameOrdered(states, EXPECTED_GAP_STATES)) {
    errors.push(`core: Gap verification states must be exactly [${EXPECTED_GAP_STATES}], found [${states}]`);
  }
  const gapProse = compact(gapSection);
  const reopeningClauses = [
    "A `closed` Gap returns to `open` when its closure evidence expires or is invalidated while the target/requirement version and scope identity are unchanged; the prior closure event, verifier, evidence, and reopening reason remain in append-only state history.",
    "When a target, requirement, Profile, or scope identity/version changes, the existing Gap is not retargeted: if the newly applicable comparison exposes a delta, create a new `open` successor Gap and mark the prior Gap `superseded` with that replacement reference.",
    "Backlog completion alone never closes a Gap.",
  ];
  if (reopeningClauses.some((clause) => !gapProse.includes(clause))) {
    errors.push("core: closed-Gap reopening contract is incomplete");
  }
}

function validateMappingStateAxes(core: string, errors: string[]): void {
  const conformance = compact(section(core, "### 14.2 Implementation statement", "### 14.3"));
  const clauses = [
    "`StandardMapState` uses exactly `absent | present-unverified | present-verified`.",
    "`BindingState` uses exactly `absent | present-unverified | present-verified` independently for a concrete edition/object/relation/system-of-record binding in one implementation.",
    "The identical tokens do not make the axes interchangeable",
    "Both are distinct from `AIProductOperatingBinding.bindingState`",
  ];
  if (clauses.some((clause) => !conformance.includes(clause))) {
    errors.push("core: StandardMapState, implementation BindingState, and AI operating-binding state are not independently defined");
  }
}

function validateMapTable(
  body: string,
  header: string,
  columns: number,
  label: string,
  expectedHeaders: readonly string[],
  idPattern: RegExp,
  expectedIds: readonly string[],
  errors: string[],
): string[][] {
  const table = parseMarkdownTable(body, header, columns, `core: ${label}`, errors, expectedHeaders);
  const ids = table.rows.flatMap((cells) => {
    const id = cells[0]?.match(idPattern)?.[1];
    if (!id || cells.slice(1).some((cell) => !hasSemanticContent(cell))) {
      errors.push(`core: malformed ${label} row ${cells.join(" | ")}`);
      return [];
    }
    return [id];
  });
  const duplicateIds = duplicates(ids);
  if (duplicateIds.length > 0) {
    errors.push(`core: duplicate ${label} IDs [${duplicateIds.join(", ")}]`);
  }
  if (!sameOrdered(ids, expectedIds)) {
    errors.push(`core: ${label} IDs must be exactly ordered [${expectedIds}], found [${ids}]`);
  }
  return table.rows;
}

function intendedUseStatus(record: string): string | undefined {
  for (const line of record.split(/\r?\n/)) {
    const cells = parseMarkdownRow(line);
    if (cells[0] !== "Intended use / status" || cells.length !== 2) continue;
    return cells[1].match(/;\s*`(permitted-[a-z-]+)`\s*$/)?.[1];
  }
  return undefined;
}

const EXPECTED_MAPPING_ENVELOPE_FIELDS = [
  "standards owner / title / edition",
  "canonical URI / access date",
  "cross-standard relationship",
  "semantic direction / default",
  "rationale / known loss",
  "confidence",
  "SourceUseDecision / permitted-use scope",
  "ContributorAttestation",
  "reviewer / review date",
  "review cadence / trigger",
] as const;

function validateMappingEnvelope(
  body: string,
  valueHeader: string,
  label: string,
  requiredFieldTokens: Readonly<Record<string, readonly string[]>>,
  errors: string[],
): void {
  const table = parseMarkdownTable(
    body,
    "Common mapping field",
    2,
    `core: ${label} common mapping envelope`,
    errors,
    ["Common mapping field", valueHeader],
  );
  const fields = table.rows.map((row) => row[0]);
  if (!sameOrdered(fields, EXPECTED_MAPPING_ENVELOPE_FIELDS)) {
    errors.push(`core: ${label} common mapping envelope fields are incomplete or out of order`);
  }
  if (table.rows.some((row) => row.length !== 2 || !hasSemanticContent(row[1] ?? ""))) {
    errors.push(`core: ${label} common mapping envelope has an empty value`);
  }
  const values = new Map(table.rows.map((row) => [row[0], compact(row[1] ?? "")]));
  for (const [field, requiredTokens] of Object.entries(requiredFieldTokens)) {
    const value = values.get(field) ?? "";
    if (requiredTokens.some((token) => !value.includes(token))) {
      errors.push(`core: ${label} common mapping envelope field ${field} is incomplete`);
    }
  }
}

function validateIt4itBridge(core: string, errors: string[]): void {
  const lifecycleSection = section(
    core,
    "### 11.5 Source-validated IT4IT 3.0.1 lifecycle bridge",
    "### 11.6",
  );
  const lifecycleRows = validateMapTable(
    lifecycleSection,
    "IT4IT value-stream key",
    4,
    "IT4IT lifecycle",
    [
      "IT4IT value-stream key",
      "Source stage sequence",
      "FPAW AI-coworker lifecycle concern",
      "Minimum FPAW evidence",
    ],
    /^`(IT4IT-VS-[A-Z]+)`$/,
    EXPECTED_IT4IT_STAGE_ROWS.map(([id]) => id),
    errors,
  );
  let stageCount = 0;
  for (let index = 0; index < EXPECTED_IT4IT_STAGE_ROWS.length; index += 1) {
    const expected = EXPECTED_IT4IT_STAGE_ROWS[index];
    const row = lifecycleRows[index];
    if (row?.[1] !== expected[1]) {
      errors.push(`core: IT4IT lifecycle stage sequence for ${expected[0]} is not source-exact`);
    }
    stageCount += row?.[1]?.split("→").length ?? 0;
  }
  if (stageCount !== 28) {
    errors.push(`core: IT4IT lifecycle must preserve exactly 28 stages, found ${stageCount}`);
  }

  const it4itBridge = section(
    core,
    "### 13.3 Source-validated IT4IT Reference Architecture 3.0.1 bridge",
    "### 13.4 Source-validated CSDM 5 and AICT bridge",
  );
  validateMappingEnvelope(
    it4itBridge,
    "Section 13.3 value",
    "IT4IT",
    {
      "standards owner / title / edition": ["The Open Group", "Version 3.0.1", "C24A"],
      "canonical URI / access date": ["https://publications.opengroup.org/c24a", "2026-08-01"],
      "cross-standard relationship": ["`maps-to`", "`augments`"],
      "semantic direction / default": ["IT4IT source concept → FPAW target", "`related`"],
      "rationale / known loss": ["cardinality", "participation", "ownership", "source-conflict"],
      confidence: ["`high`", "`medium`"],
      "SourceUseDecision / permitted-use scope": ["`SUD-C24A-COMPILED-2026-08-01`", "`permitted-operator`"],
      ContributorAttestation: ["`CA-MB-2026-08-01-IT4IT-PROVENANCE`"],
      "reviewer / review date": ["DPF candidate technical review", "2026-08-01"],
      "review cadence / trigger": ["at least annually", "IT4IT edition"],
    },
    errors,
  );

  const streamsAndFunctions = section(
    core,
    "#### 13.3.1 Value streams and functional groups",
    "#### 13.3.2 Digital Product and Service Offer backbones",
  );
  const valueStreamRows = validateMapTable(
    streamsAndFunctions,
    "Map ID",
    6,
    "IT4IT value-stream map",
    ["Map ID", "IT4IT 3.0.1 source identifier", "FPAW target/touchpoint", "Relation", "Boundary and known loss", "StandardMapState"],
    /^`(IT4IT-MAP-VS-[A-Z]+-\d{3})`$/,
    EXPECTED_IT4IT_VALUE_STREAM_MAPS,
    errors,
  );
  if (valueStreamRows.some((row) => row[5] !== "`present-verified`")) {
    errors.push("core: IT4IT value-stream maps must remain source-reviewed present-verified records");
  }

  const functionalGroupRows = validateMapTable(
    streamsAndFunctions,
    "Functional-group map ID",
    4,
    "IT4IT functional-group map",
    ["Functional-group map ID", "Current IT4IT functional group", "Source functional components", "FPAW bridge boundary"],
    /^`(IT4IT-MAP-FG-[A-Z0-9]+-\d{3})`$/,
    EXPECTED_IT4IT_FUNCTIONAL_GROUPS.map(([id]) => id),
    errors,
  );
  if (functionalGroupRows.some((row, index) => row[2] !== EXPECTED_IT4IT_FUNCTIONAL_GROUPS[index]?.[1])) {
    errors.push("core: IT4IT functional component set is incomplete");
  }

  const componentRows = validateMapTable(
    streamsAndFunctions,
    "Component map ID",
    5,
    "IT4IT functional-component ownership map",
    [
      "Component map ID",
      "IT4IT functional group / function",
      "Functional component",
      "Controlled key data object(s)",
      "FPAW system-of-record boundary",
    ],
    /^`(IT4IT-MAP-FC-[A-Z-]+-\d{3})`$/,
    EXPECTED_IT4IT_COMPONENT_ROWS.map(([id]) => id),
    errors,
  );
  const invalidComponentTuple = componentRows.some((row, index) => {
    const expected = EXPECTED_IT4IT_COMPONENT_ROWS[index];
    return row[1] !== expected?.[1] || row[2] !== expected?.[2] || row[3] !== expected?.[3];
  });
  if (invalidComponentTuple) {
    errors.push("core: IT4IT functional-component/KDO ownership registry is not source-exact");
  }

  const supportingRows = validateMapTable(
    streamsAndFunctions,
    "Supporting-function map ID",
    3,
    "IT4IT supporting-function map",
    ["Supporting-function map ID", "IT4IT supporting function", "FPAW bridge boundary"],
    /^`(IT4IT-MAP-SF-[A-Z]+-\d{3})`$/,
    EXPECTED_IT4IT_SUPPORTING_ROWS.map(([id]) => id),
    errors,
  );
  if (supportingRows.some((row, index) => row[1] !== EXPECTED_IT4IT_SUPPORTING_ROWS[index]?.[1])) {
    errors.push("core: IT4IT supporting-function source names are not source-exact");
  }

  const backbones = section(
    core,
    "#### 13.3.2 Digital Product and Service Offer backbones",
    "### 13.4 Source-validated CSDM 5 and AICT bridge",
  );
  const backboneRows = validateMapTable(
    backbones,
    "Map ID",
    7,
    "IT4IT backbone map",
    [
      "Map ID",
      "IT4IT 3.0.1 key data object",
      "Controlling functional component",
      "FPAW projection",
      "Semantic relation",
      "Preserved boundary / known loss",
      "StandardMapState",
    ],
    /^`(IT4IT-MAP-KDO-[A-Z-]+-\d{3})`$/,
    EXPECTED_IT4IT_BACKBONE_ROWS.map(([id]) => id),
    errors,
  );
  if (backboneRows.some((row) => row[6] !== "`present-verified`")) {
    errors.push("core: IT4IT backbone maps must remain source-reviewed present-verified records");
  }
  if (backboneRows.some((row, index) => {
    const expected = EXPECTED_IT4IT_BACKBONE_ROWS[index];
    return row[1] !== expected?.[1] || row[2] !== expected?.[2];
  })) {
    errors.push("core: IT4IT backbone KDO ownership tuples are not source-exact");
  }
  const digitalProductProjection = backboneRows[0]?.[3] ?? "";
  const compositeTokens = [
    "exactly one BusinessProduct",
    "`1..*` essential DigitalProduct",
    "`1..*` Offerings",
    "economics",
    "`0..*` contingent ConsumptionAgreements",
    "`0..*` Desired/Actual instance lineage",
  ];
  if (compositeTokens.some((token) => !digitalProductProjection.includes(token))) {
    errors.push("core: IT4IT composite Digital Product mapping is incomplete");
  }

  const cardinalityRows = validateMapTable(
    backbones,
    "Cardinality map ID",
    4,
    "IT4IT cardinality map",
    ["Cardinality map ID", "Source relation and notation", "Normalized bounds retained by an adapter", "FPAW relation"],
    /^`(IT4IT-MAP-CARD-[A-Z-]+-\d{3})`$/,
    EXPECTED_IT4IT_CARDINALITY_ROWS.map(([id]) => id),
    errors,
  );
  if (cardinalityRows.some((row, index) => {
    const expected = EXPECTED_IT4IT_CARDINALITY_ROWS[index];
    return row[1] !== expected?.[1] || row[2] !== expected?.[2];
  })) {
    errors.push("core: IT4IT source relation/cardinality tuples are not source-exact");
  }

  const prose = compact(`${streamsAndFunctions}\n${backbones}`);
  if (!prose.includes("IT4IT Release is the Service Offer lifecycle; it is not DigitalProductRelease authorization")) {
    errors.push("core: IT4IT Release/Product Release separation is incomplete");
  }
  if (!prose.includes("The Product Release-to-Service Offer seam is an explicit Release Blueprint relation.")) {
    errors.push("core: IT4IT Product Release Blueprint seam is incomplete");
  }
  const cardinalityClauses = [
    "`participationSpecified=false`",
    "it **MUST NOT** convert that prose into an IT4IT minimum or silently strengthen `0..1` to exactly one",
    "Data-flow arrows are integration triggers, not process-flow or guaranteed one-way information semantics.",
    "`EaReferenceModel` and `EaReferenceModelElement` are reference/assessment definitions, never operational object stores.",
  ];
  if (cardinalityClauses.some((clause) => !prose.includes(clause))) {
    errors.push("core: IT4IT cardinality preservation contract is incomplete");
  }
  if (!prose.includes("The FPAW `R0`–`R5` resolution depths and IT4IT Levels 1–5 are orthogonal.")) {
    errors.push("core: FPAW and IT4IT level separation is incomplete");
  }
  const it4itDecision = section(
    core,
    "#### 20.2.4 `SUD-C24A-COMPILED-2026-08-01`",
    "#### 20.2.5",
  );
  if (intendedUseStatus(it4itDecision) !== "permitted-operator") {
    errors.push("core: IT4IT bridge SourceUseDecision is incomplete");
  }
}

function validateCsdmBridge(core: string, errors: string[]): void {
  const csdmSection = section(core, "### 13.4 Source-validated CSDM 5 and AICT bridge", "### 13.5");
  validateMappingEnvelope(
    csdmSection,
    "Section 13.4 value",
    "CSDM/AICT",
    {
      "standards owner / title / edition": ["ServiceNow", "CSDM 5 White Paper", "AI Control Tower with CSDM v1"],
      "canonical URI / access date": ["SCIT-SNOW-CSDM-RESOURCES", "SCIT-SNOW-AICT-GUIDANCE", "2026-08-01"],
      "cross-standard relationship": ["`maps-to`", "`augments`"],
      "semantic direction / default": ["CSDM 5 or AICT source concept → FPAW target", "`related`"],
      "rationale / known loss": ["anti-collapse", "fingerprint", "direction", "cardinality"],
      confidence: ["`high`", "`medium`"],
      "SourceUseDecision / permitted-use scope": ["`SUD-CSDM-LOCAL-2026-08-01`", "`permitted-operator`"],
      ContributorAttestation: ["`CA-MB-2026-08-01-CSDM-PROVENANCE`"],
      "reviewer / review date": ["DPF candidate technical review", "2026-08-01"],
      "review cadence / trigger": ["at least annually", "CSDM/AICT publication"],
    },
    errors,
  );
  const mapRows = validateMapTable(
    csdmSection,
    "Map ID",
    6,
    "CSDM map",
    ["Map ID", "CSDM 5 / AICT source concept/class", "FPAW target", "Semantic relation", "StandardMapState", "Adapter boundary / known loss"],
    /^`((?:CSDM|AICT)-MAP-[A-Z-]+-\d{3})`$/,
    EXPECTED_CSDM_MAP_ROWS.map(([id]) => id),
    errors,
  );
  const invalidMapState = mapRows.some((row, index) => {
    const expected = EXPECTED_CSDM_MAP_ROWS[index];
    const relation = row[3]?.replaceAll("`", "");
    const state = row[4]?.replaceAll("`", "");
    return row[1] !== expected?.[1] || relation !== expected?.[2] || state !== expected?.[3] ||
      ((relation === "none") !== (state === "absent"));
  });
  if (invalidMapState) {
    errors.push("core: CSDM map state/relation contract is incomplete");
  }
  const runtimeRow = mapRows.find((row) => row[0] === "`CSDM-MAP-RUNTIME-001`");
  if (!runtimeRow?.[2]?.includes("DigitalProductInstance/ServiceInstance") ||
      !runtimeRow?.[5]?.includes("not Product, Release, Deployment, or AgentSubject")) {
    errors.push("core: CSDM runtime projection contract is incomplete");
  }
  const discoveryRow = mapRows.find((row) => row[0] === "`CSDM-MAP-DISCOVERY-001`");
  const discoveryBoundary =
    "discovery may refresh observed runtime topology only; it must not synthesize Product, Release, package, GAID AgentSubject, work, agreement, or conformance truth";
  if (!discoveryRow?.[5]?.includes(discoveryBoundary)) {
    errors.push("core: CSDM discovery boundary is incomplete");
  }
  const productModelRow = mapRows.find((row) => row[0] === "`CSDM-MAP-PRODUCT-MODEL-001`");
  if (!productModelRow?.[1]?.includes("`cmdb_model`") ||
      !productModelRow?.[5]?.includes("preserve Product Model, Product, and Design identities") ||
      !productModelRow?.[5]?.includes("CI/runtime truth")) {
    errors.push("core: CSDM Product Model level contract is incomplete");
  }
  const identityGapRow = mapRows.find((row) => row[0] === "`CSDM-MAP-IDENTITY-GAP-001`");
  if (!identityGapRow?.[5]?.includes("GAID AgentSubjectReference remains authoritative")) {
    errors.push("core: CSDM identity-gap boundary is incomplete");
  }
  const bindingGapRow = mapRows.find((row) => row[0] === "`CSDM-MAP-BINDING-GAP-001`");
  if (!bindingGapRow?.[5]?.includes(
    "no release/profile/AgentSubject/deployment temporal uniqueness, compatibility, or TAK-JSI qualification contract",
  )) {
    errors.push("core: CSDM operating-binding gap is incomplete");
  }

  const relationRows = validateMapTable(
    csdmSection,
    "Relation map ID",
    3,
    "CSDM relation map",
    ["Relation map ID", "CSDM 5 / AICT relation", "FPAW preservation rule"],
    /^`((?:CSDM|AICT)-MAP-REL-[A-Z-]+-\d{3})`$/,
    EXPECTED_CSDM_RELATION_ROWS.map(([id]) => id),
    errors,
  );
  if (relationRows.some((row, index) => row[1] !== EXPECTED_CSDM_RELATION_ROWS[index]?.[1])) {
    errors.push("core: CSDM/AICT source relation and cardinality tuples are not source-exact");
  }

  const prose = compact(csdmSection);
  const sentinelClause =
    "The table uses `none` only as a sentinel when StandardMapState is `absent`; it is not an asserted Section 13.1 semantic relation.";
  if (!prose.includes(sentinelClause)) {
    errors.push("core: CSDM absent-map sentinel contract is incomplete");
  }
  const antiCollapseClause =
    "AgentSubject, AIProductOperatingBinding, WorkAssignment, and Evidence **MUST** retain distinct identities and typed relations.";
  if (!prose.includes(antiCollapseClause)) {
    errors.push("core: CSDM anti-collapse contract is incomplete");
  }
  const csdmDecision = section(
    core,
    "#### 20.2.11 `SUD-CSDM-LOCAL-2026-08-01`",
    "#### 20.2.12",
  );
  if (intendedUseStatus(csdmDecision) !== "permitted-operator") {
    errors.push("core: CSDM bridge SourceUseDecision is incomplete");
  }
}

export function validateCoreDomainContracts(core: string, errors: string[]): void {
  validateAnchorContract(core, errors);
  validateExecutionMedia(core, errors);
  validateAiBindingContract(core, errors);
  validateGapReopening(core, errors);
  validateMappingStateAxes(core, errors);
  validateIt4itBridge(core, errors);
  validateCsdmBridge(core, errors);
}
