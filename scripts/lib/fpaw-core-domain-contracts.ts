import {
  duplicates,
  hasSemanticContent,
  parseMarkdownTable,
  section,
  withoutHtmlComments,
} from "./fpaw-standard-conformance";

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

const EXPECTED_CSDM_CANDIDATES = [
  "CSDM-CAND-STRATEGY-001",
  "CSDM-CAND-PRODUCT-001",
  "CSDM-CAND-RELEASE-001",
  "CSDM-CAND-ASSET-001",
  "CSDM-CAND-PACKAGE-001",
  "CSDM-CAND-RUNTIME-001",
  "CSDM-CAND-CONSUME-001",
  "CSDM-CAND-IDENTITY-001",
  "CSDM-CAND-BINDING-001",
  "CSDM-CAND-WORK-001",
  "CSDM-CAND-EVIDENCE-001",
  "CSDM-CAND-FEDERATION-001",
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
    "Each binding references exactly one DigitalProductRelease, one operating-profile fingerprint, and one AgentSubjectReference, plus zero or one deployed instance:",
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

function validateCsdmCandidates(core: string, errors: string[]): void {
  const candidateSection = section(core, "### 13.4 CSDM/AICT technical bridge candidate", "### 13.5");
  const candidateTable = parseMarkdownTable(
    candidateSection,
    "Candidate ID",
    5,
    "core: CSDM Candidate table",
    errors,
    [
      "Candidate ID",
      "CSDM/AICT implementation level to validate",
      "FPAW target level",
      "DPF lifecycle phases in review scope (not binding keys)",
      "Known loss and required verification",
    ],
  );
  const ids = candidateTable.rows.flatMap((cells) => {
    const id = cells[0]?.match(/^`(CSDM-CAND-[A-Z]+-\d{3})`$/)?.[1];
    if (!id || cells.slice(1).some((cell) => !hasSemanticContent(cell))) {
      errors.push(`core: malformed CSDM Candidate row ${cells.join(" | ")}`);
      return [];
    }
    return [id];
  });
  const duplicateIds = duplicates(ids);
  if (duplicateIds.length > 0) {
    errors.push(`core: duplicate CSDM Candidate IDs [${duplicateIds.join(", ")}]`);
  }
  if (!sameOrdered(ids, EXPECTED_CSDM_CANDIDATES)) {
    errors.push(
      `core: CSDM Candidate IDs must be exactly ordered [${EXPECTED_CSDM_CANDIDATES}], found [${ids}]`,
    );
  }
  const candidateProse = compact(candidateSection);
  const absentClauses = [
    "`undetermined` SourceUseDecision cannot substantiate a mapping.",
    "The independently authored technical hypotheses below are therefore a validation backlog, not Section 13.1 mapping records or Section 13.3 bindings.",
    "Every row has BindingState `absent`: no CSDM correspondence is asserted.",
    "The lifecycle column identifies DPF phases in the review scope, not the single local lifecycle key required by a future binding.",
    "A complete mapping envelope and permitted source review are required before a row may become `present-unverified`.",
  ];
  if (absentClauses.some((clause) => !candidateProse.includes(clause))) {
    errors.push("core: CSDM Candidate absent non-binding contract is incomplete");
  }
}

export function validateCoreDomainContracts(core: string, errors: string[]): void {
  validateAnchorContract(core, errors);
  validateExecutionMedia(core, errors);
  validateAiBindingContract(core, errors);
  validateGapReopening(core, errors);
  validateCsdmCandidates(core, errors);
}
