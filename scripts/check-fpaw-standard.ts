#!/usr/bin/env tsx

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ALL_ARCHETYPES } from "../packages/storefront-templates/src/archetypes/index";
import { validateCoreDomainContracts } from "./lib/fpaw-core-domain-contracts";
import {
  difference,
  duplicates,
  EXPECTED_DEVIATIONS,
  hasBalancedHtmlComments,
  hasSemanticContent,
  numericRequirementRows,
  parseMarkdownTable,
  requirementRecords,
  sameSet,
  section,
  validateProfileGraph,
  validateRequirementSequence,
  validateRequirementTableSyntax,
  validateSourceRecords,
  visibleMarkdown,
  withoutHtmlComments,
} from "./lib/fpaw-standard-conformance";

const CORE_PATH = "docs/architecture/four-portfolio-archetype-ai-workforce-operating-standard.md";
const CATALOG_PATH = "docs/architecture/four-portfolio-archetype-standard-profile-catalog.md";

const EXPECTED_CORE_REQUIREMENTS = 180;
const EXPECTED_CATALOG_REQUIREMENTS = 18;
const EXPECTED_WORKED_SPECIMENS = 7;

const ACTIVITY_STATE_ORDER = [
  "required",
  "recommended",
  "not-applicable",
  "specialized-profile-required",
] as const;
const ACTIVITY_STATES = new Set<string>(ACTIVITY_STATE_ORDER);

const AI_REALIZATION_STATES = [
  "profile-bound",
  "human-only-no-ai-needed",
  "not-yet-assessed",
  "implementation-gap",
];

const EXPECTED_STAGE_CONTRACT = [
  ["attract", "Attract & Discover"],
  ["capture", "Capture Demand"],
  ["qualify", "Qualify & Schedule"],
  ["deliver", "Deliver the Value"],
  ["settle", "Settle & Account"],
  ["retain", "Retain & Grow"],
] as const;

const EXPECTED_PORTFOLIO_ROOTS = [
  "products_and_services_sold",
  "for_employees",
  "manufacturing_and_delivery",
  "foundational",
] as const;

const EXPECTED_PORTFOLIO_ADAPTER = [
  ["productsAndServicesSold", "products_and_services_sold"],
  ["forEmployees", "for_employees"],
  ["manufactureAndDeliver", "manufacturing_and_delivery"],
  ["foundational", "foundational"],
] as const;

export type Inventory = {
  categories: string[];
  leaves: string[];
  itemTemplates: number;
  leafCategories: Record<string, string>;
  categoryLeafCounts: Record<string, number>;
};

type CheckResult = {
  errors: string[];
  metrics: {
    categories: number;
    leaves: number;
    itemTemplates: number;
    matrixFamilies: number;
    matrixCells: number;
    deviations: number;
    coreRequirements: number;
    catalogRequirements: number;
    totalRequirements: number;
    profiles: number;
    workedSpecimens: number;
    sourceUseDecisions: number;
    sourceCitations: number;
    contributorAttestations: number;
  };
};

export function currentInventory(): Inventory {
  const categories = [...new Set(ALL_ARCHETYPES.map((entry) => entry.category))].sort();
  const categoryLeafCounts = Object.fromEntries(
    categories.map((category) => [
      category,
      ALL_ARCHETYPES.filter((entry) => entry.category === category).length,
    ]),
  );

  return {
    categories,
    leaves: ALL_ARCHETYPES.map((entry) => entry.archetypeId).sort(),
    itemTemplates: ALL_ARCHETYPES.reduce(
      (sum, entry) => sum + entry.itemTemplates.length,
      0,
    ),
    leafCategories: Object.fromEntries(
      ALL_ARCHETYPES.map((entry) => [entry.archetypeId, entry.category]),
    ),
    categoryLeafCounts,
  };
}

function sameOrdered(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function analyzeFPAW(
  core: string,
  catalog: string,
  inventory: Inventory = currentInventory(),
): CheckResult {
  const errors: string[] = [];
  if (core.includes("<!--")) errors.push("core: HTML comments are not permitted in canonical standard Markdown");
  else if (!hasBalancedHtmlComments(core)) errors.push("core: unbalanced HTML comment delimiter");
  if (catalog.includes("<!--")) errors.push("catalog: HTML comments are not permitted in canonical standard Markdown");
  else if (!hasBalancedHtmlComments(catalog)) errors.push("catalog: unbalanced HTML comment delimiter");
  core = visibleMarkdown(core);
  catalog = visibleMarkdown(catalog);
  validateCoreDomainContracts(core, errors);
  const categorySet = new Set(inventory.categories);
  const leafSet = new Set(inventory.leaves);

  const duplicateInventoryLeaves = duplicates(inventory.leaves);
  if (duplicateInventoryLeaves.length > 0) {
    errors.push(`inventory: duplicate leaves [${duplicateInventoryLeaves.join(", ")}]`);
  }
  for (const leaf of inventory.leaves) {
    const category = inventory.leafCategories[leaf];
    if (!categorySet.has(category)) {
      errors.push(`inventory: ${leaf} maps to unknown category ${category ?? "<missing>"}`);
    }
  }
  for (const category of inventory.categories) {
    const derivedCount = inventory.leaves.filter(
      (leaf) => inventory.leafCategories[leaf] === category,
    ).length;
    if (inventory.categoryLeafCounts[category] !== derivedCount) {
      errors.push(
        `inventory: ${category} declared count ${inventory.categoryLeafCounts[category] ?? "missing"} != derived ${derivedCount}`,
      );
    }
  }

  const snapshot = catalog.match(
    /\*\*Inventory snapshot:\*\*[^\n]*— (\d+) categories, (\d+) unique implemented leaves/,
  );
  if (!snapshot) {
    errors.push("catalog: inventory snapshot is missing or malformed");
  } else if (
    Number(snapshot[1]) !== inventory.categories.length ||
    Number(snapshot[2]) !== inventory.leaves.length
  ) {
    errors.push(
      `catalog: snapshot ${snapshot[1]}/${snapshot[2]} does not match source ${inventory.categories.length}/${inventory.leaves.length}`,
    );
  }

  const coreCoverage = core.match(
    /authoritative source contains (\d+) categories and (\d+) unique leaf archetypes with (\d+) item/,
  );
  if (!coreCoverage) {
    errors.push("core: Section 18.1 source inventory is missing or malformed");
  } else if (
    Number(coreCoverage[1]) !== inventory.categories.length ||
    Number(coreCoverage[2]) !== inventory.leaves.length ||
    Number(coreCoverage[3]) !== inventory.itemTemplates
  ) {
    errors.push(
      `core: source inventory ${coreCoverage.slice(1).join("/")} does not match ${inventory.categories.length}/${inventory.leaves.length}/${inventory.itemTemplates}`,
    );
  }

  const baseline = section(catalog, "## 4. Category baselines", "## 5. Leaf-delta register");
  const baselineRows = [...baseline.matchAll(/^\| `([^`]+)` \((\d+)\) \|/gm)];
  const baselineCategories = baselineRows.map((match) => match[1]);
  const duplicateBaseline = duplicates(baselineCategories);
  if (duplicateBaseline.length > 0) {
    errors.push(`catalog: duplicate category baselines [${duplicateBaseline.join(", ")}]`);
  }
  const baselineSet = new Set(baselineCategories);
  const missingCategories = difference(categorySet, baselineSet);
  const extraCategories = difference(baselineSet, categorySet);
  if (missingCategories.length || extraCategories.length) {
    errors.push(
      `catalog: category baseline mismatch; missing=[${missingCategories}], extra=[${extraCategories}]`,
    );
  }
  for (const match of baselineRows) {
    const actual = inventory.categoryLeafCounts[match[1]];
    if (actual === undefined || Number(match[2]) !== actual) {
      errors.push(`catalog: ${match[1]} baseline count ${match[2]} != ${actual ?? "missing"}`);
    }
  }

  const leafSection = section(catalog, "## 5. Leaf-delta register", "## 6. Shared and specialized");
  const leafHeadings = [...leafSection.matchAll(
    /^### 5\.(\d+) ([^\r\n]+?) \((\d+)\)\r?$/gm,
  )];
  if (leafHeadings.length !== baselineRows.length) {
    errors.push(
      `catalog: Section 5 has ${leafHeadings.length} category headings, expected ${baselineRows.length}`,
    );
  }
  const catalogLeaves: string[] = [];
  for (let index = 0; index < leafHeadings.length; index += 1) {
    const heading = leafHeadings[index];
    const expectedCategory = baselineCategories[index];
    if (Number(heading[1]) !== index + 1) {
      errors.push(`catalog: Section 5 heading sequence expected ${index + 1}, found ${heading[1]}`);
    }
    const start = (heading.index ?? 0) + heading[0].length;
    const end = leafHeadings[index + 1]?.index ?? leafSection.length;
    const blockLeaves = [...leafSection.slice(start, end).matchAll(/^- `([^`]+)`/gm)].map(
      (match) => match[1],
    );
    catalogLeaves.push(...blockLeaves);
    const declaredCount = Number(heading[3]);
    const canonicalCount = inventory.categoryLeafCounts[expectedCategory];
    if (declaredCount !== blockLeaves.length || declaredCount !== canonicalCount) {
      errors.push(
        `catalog: Section 5.${heading[1]} ${expectedCategory} declares ${declaredCount}, ` +
          `contains ${blockLeaves.length}, canonical ${canonicalCount ?? "missing"}`,
      );
    }
    for (const leaf of blockLeaves) {
      if (inventory.leafCategories[leaf] !== expectedCategory) {
        errors.push(
          `catalog: ${leaf} appears under ${expectedCategory}, canonical category is ${inventory.leafCategories[leaf] ?? "unknown"}`,
        );
      }
    }
  }
  const duplicateCatalogLeaves = duplicates(catalogLeaves);
  if (duplicateCatalogLeaves.length > 0) {
    errors.push(`catalog: duplicate leaf entries [${duplicateCatalogLeaves.join(", ")}]`);
  }
  const catalogLeafSet = new Set(catalogLeaves);
  const missingLeaves = difference(leafSet, catalogLeafSet);
  const extraLeaves = difference(catalogLeafSet, leafSet);
  if (missingLeaves.length || extraLeaves.length) {
    errors.push(`catalog: leaf mismatch; missing=[${missingLeaves}], extra=[${extraLeaves}]`);
  }

  const familyRegistry = section(catalog, "| Shared family |", "Candidate specialized families include:");
  const familyTable = parseMarkdownTable(
    familyRegistry,
    "Shared family",
    4,
    "catalog: shared-family registry",
    errors,
    ["Shared family", "Reusable activity core", "Common profile facets", "Specialize or split when"],
  );
  const registeredFamilies = familyTable.rows.flatMap((cells) => {
    const id = cells[0]?.match(/^`(CW-[A-Z-]+)`$/)?.[1];
    if (cells.length !== 4 || cells.some((cell) => !hasSemanticContent(cell)) || !id) {
      errors.push(`catalog: malformed shared-family row ${cells.join(" | ")}`);
      return [];
    }
    return [id];
  });
  const duplicateRegisteredFamilies = duplicates(registeredFamilies);
  if (duplicateRegisteredFamilies.length > 0) {
    errors.push(`catalog: duplicate shared-family definitions [${duplicateRegisteredFamilies.join(", ")}]`);
  }

  const activityDefinitions = section(
    catalog,
    "The category matrix uses exactly four activity-applicability states",
    "Every non-`not-applicable` cell",
  );
  const activityTable = parseMarkdownTable(
    activityDefinitions,
    "State",
    2,
    "catalog: activity-applicability state table",
    errors,
    ["State", "Deterministic meaning"],
  );
  const definedActivityStates = activityTable.rows.flatMap((cells) => {
    const state = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (!state) return [];
    if (!hasSemanticContent(cells[1] ?? "")) {
      errors.push(`catalog: ${state} has an empty activity-applicability definition`);
    }
    return [state];
  });
  if (!sameOrdered(definedActivityStates, ACTIVITY_STATE_ORDER)) {
    errors.push(
      `catalog: activity-applicability state set must be exactly [${ACTIVITY_STATE_ORDER}], found [${definedActivityStates}]`,
    );
  }

  const realization = section(catalog, "Every non-`not-applicable` cell", "### 6.2");
  const realizationTable = parseMarkdownTable(
    realization,
    "AI-realization state",
    2,
    "catalog: AI-realization state table",
    errors,
    ["AI-realization state", "Deterministic meaning"],
  );
  const realizationStates = realizationTable.rows.flatMap((cells) => {
    const state = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (!state) return [];
    if (!hasSemanticContent(cells[1] ?? "")) {
      errors.push(`catalog: ${state} has an empty AI-realization definition`);
    }
    return [state];
  });
  if (!sameOrdered(realizationStates, AI_REALIZATION_STATES)) {
    errors.push(
      `catalog: AI-realization state set must be exactly [${AI_REALIZATION_STATES}], found [${realizationStates}]`,
    );
  }

  const matrix = section(catalog, "### 6.2 Category applicability matrix", "### 6.3 Activity");
  const matrixTable = parseMarkdownTable(
    matrix,
    "Category",
    11,
    "catalog: category applicability matrix",
    errors,
  );
  const matrixHeaderCells = matrixTable.header;
  if (matrixHeaderCells.length !== 11 || matrixHeaderCells[0] !== "Category") {
    errors.push(`catalog: matrix header must contain Category plus 10 cells, found ${matrixHeaderCells.length}`);
  }
  const families = matrixHeaderCells.slice(1).flatMap((cell) => {
    const matches = [...cell.matchAll(/`(CW-[A-Z-]+)`/g)];
    if (matches.length !== 1) {
      errors.push(`catalog: matrix header cell must contain exactly one shared family: ${cell}`);
      return [];
    }
    return [matches[0][1]];
  });
  if (families.length !== 10 || new Set(families).size !== families.length) {
    errors.push(`catalog: matrix must define 10 unique families, found ${families.length}`);
  }
  if (!sameSet(families, registeredFamilies)) {
    errors.push(
      `catalog: matrix/shared-family mismatch; matrix-only=[${difference(families, new Set(registeredFamilies))}], ` +
        `registry-only=[${difference(registeredFamilies, new Set(families))}]`,
    );
  }

  const matrixRows = matrixTable.rows;
  const matrixCategories = matrixRows.flatMap((cells) => {
    const category = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    return category ? [category] : [];
  });
  const duplicateMatrixCategories = duplicates(matrixCategories);
  if (duplicateMatrixCategories.length > 0) {
    errors.push(`catalog: duplicate matrix categories [${duplicateMatrixCategories.join(", ")}]`);
  }
  const matrixSet = new Set(matrixCategories);
  if (difference(categorySet, matrixSet).length || difference(matrixSet, categorySet).length) {
    errors.push("catalog: matrix categories do not equal canonical categories");
  }
  const matrixStates = new Map<string, Map<string, string>>();
  let matrixCells = 0;
  for (const cells of matrixRows) {
    const category = cells[0]?.match(/^`([^`]+)`$/)?.[1] ?? `<malformed:${cells[0] ?? "missing"}>`;
    if (cells.length !== 11) {
      errors.push(`catalog: ${category} row has ${cells.length} Markdown cells, expected 11`);
    }
    const states = cells.slice(1).map(
      (cell) => cell.match(/^`([^`]+)`$/)?.[1] ?? `<malformed:${cell}>`,
    );
    matrixCells += states.length;
    if (states.length !== families.length) {
      errors.push(`catalog: ${category} has ${states.length} matrix cells, expected ${families.length}`);
    }
    const invalid = states.filter((state) => !ACTIVITY_STATES.has(state));
    if (invalid.length) errors.push(`catalog: ${category} has invalid states ${invalid.join(", ")}`);
    matrixStates.set(
      category,
      new Map(families.map((family, index) => [family, states[index]])),
    );
  }

  const rationaleSection = section(catalog, "### 6.3 Activity, authority", "### 6.4 Leaf deviations");
  const rationaleTable = parseMarkdownTable(
    rationaleSection,
    "Category",
    4,
    "catalog: activity-authority-evidence rationale",
    errors,
    ["Category", "Decisive activity", "Authority ceiling or specialization anchor", "Minimum category evidence"],
  );
  const rationaleCategories: string[] = [];
  for (const cells of rationaleTable.rows) {
    const category = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (cells.length !== 4 || cells.some((cell) => !hasSemanticContent(cell)) || !category) {
      errors.push(`catalog: malformed category rationale row ${cells.join(" | ")}`);
      continue;
    }
    rationaleCategories.push(category);
  }
  if (!sameSet(rationaleCategories, categorySet) || rationaleCategories.length !== categorySet.size) {
    errors.push(
      `catalog: category rationale coverage mismatch; missing=[${difference(categorySet, new Set(rationaleCategories))}], ` +
        `extra=[${difference(rationaleCategories, categorySet)}]`,
    );
  }

  const deviationSection = section(catalog, "### 6.4 Leaf deviations", "## 7. Profile manifest");
  const deviationMetadata = [
    "`profileVersion = 0.1.0`",
    "`reviewer = DPF-FPAW candidate editorial review`",
    "`reviewedAt = 2026-08-01`",
    "`sourceEvidence = the canonical ALL_ARCHETYPES record",
    "`derivationMethod = editorial semantic projection`",
    "`confidence = provisional`",
    "`EvidenceVerificationStatus = provisional`",
    "`no-execution-until-specialized-profile`",
    "`no-execution-until-complete-organization-profile`",
  ];
  if (deviationMetadata.some((field) => !deviationSection.includes(field))) {
    errors.push("catalog: shared deviation metadata contract is incomplete");
  }
  const deviationTable = parseMarkdownTable(
    deviationSection,
    "Leaf",
    5,
    "catalog: leaf-deviation register",
    errors,
    ["Leaf", "Family", "Category state", "Leaf state", "Semantic trigger and minimum evidence"],
  );
  const deviations = deviationTable.rows.flatMap((cells) => {
    const leaf = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    const family = cells[1]?.match(/^`(CW-[A-Z-]+)`$/)?.[1];
    const inheritedState = cells[2]?.match(/^`([^`]+)`$/)?.[1];
    const leafState = cells[3]?.match(/^`([^`]+)`$/)?.[1];
    if (cells.length !== 5 || !leaf || !family || !inheritedState || !leafState) {
      errors.push(`catalog: malformed leaf-deviation row ${cells.join(" | ")}`);
      return [];
    }
    return [{ leaf, family, inheritedState, leafState, evidence: cells[4] }];
  });
  if (deviations.length !== EXPECTED_DEVIATIONS.size) {
    errors.push(`catalog: expected ${EXPECTED_DEVIATIONS.size} leaf deviations, found ${deviations.length}`);
  }
  const deviationPairs = deviations.map(({ leaf, family }) => `${leaf}::${family}`);
  const duplicateDeviationPairs = duplicates(deviationPairs);
  if (duplicateDeviationPairs.length > 0) {
    errors.push(`catalog: duplicate leaf/family deviations [${duplicateDeviationPairs.join(", ")}]`);
  }
  const allowedTransitions: Record<string, Set<string>> = {
    recommended: new Set(["required", "specialized-profile-required"]),
    required: new Set(["specialized-profile-required"]),
    "not-applicable": new Set(["recommended", "required", "specialized-profile-required"]),
    "specialized-profile-required": new Set(),
  };
  if (!sameSet(deviationPairs, EXPECTED_DEVIATIONS.keys()) ||
      deviationPairs.length !== EXPECTED_DEVIATIONS.size) {
    errors.push(
      `catalog: Candidate 0.1.0 deviation identities must be exactly [${[...EXPECTED_DEVIATIONS.keys()]}]`,
    );
  }
  for (const { leaf, family, inheritedState, leafState, evidence } of deviations) {
    const pair = `${leaf}::${family}`;
    const expectedStates = EXPECTED_DEVIATIONS.get(pair);
    if (expectedStates &&
        (inheritedState !== expectedStates[0] || leafState !== expectedStates[1])) {
      errors.push(
        `catalog: ${pair} states must be ${expectedStates[0]} -> ${expectedStates[1]}, found ${inheritedState} -> ${leafState}`,
      );
    }
    if (!leafSet.has(leaf)) errors.push(`catalog: deviation has unknown leaf ${leaf}`);
    if (!families.includes(family)) errors.push(`catalog: deviation has unknown family ${family}`);
    if (!ACTIVITY_STATES.has(inheritedState) || !ACTIVITY_STATES.has(leafState)) {
      errors.push(`catalog: deviation ${leaf}::${family} has invalid state`);
      continue;
    }
    const category = inventory.leafCategories[leaf];
    const canonicalInherited = matrixStates.get(category)?.get(family);
    if (inheritedState !== canonicalInherited) {
      errors.push(
        `catalog: deviation ${leaf}::${family} inherits ${inheritedState}, matrix ${category} is ${canonicalInherited ?? "missing"}`,
      );
    }
    if (!allowedTransitions[inheritedState]?.has(leafState)) {
      errors.push(`catalog: deviation ${leaf}::${family} has prohibited transition ${inheritedState} -> ${leafState}`);
    }
    if (!hasSemanticContent(evidence)) errors.push(`catalog: deviation ${leaf}::${family} has empty evidence`);
  }

  const coreRows = numericRequirementRows(core);
  const catalogRows = numericRequirementRows(catalog);
  const coreRequirements = requirementRecords(core);
  const catalogRequirements = requirementRecords(catalog);
  validateRequirementTableSyntax(core, "core", errors);
  validateRequirementTableSyntax(catalog, "catalog", errors);
  if (coreRows.length !== coreRequirements.length) {
    errors.push(`core: ${coreRows.length - coreRequirements.length} requirement row(s) have malformed/missing depth`);
  }
  if (catalogRows.length !== catalogRequirements.length) {
    errors.push(`catalog: ${catalogRows.length - catalogRequirements.length} requirement row(s) have malformed/missing depth`);
  }
  validateRequirementSequence("core", coreRows, errors);
  validateRequirementSequence("catalog", catalogRows, errors);
  const allRequirements = [...coreRequirements, ...catalogRequirements];
  for (const requirement of allRequirements) {
    if (!hasSemanticContent(requirement.statement)) {
      errors.push(`standard: ${requirement.id} has an empty requirement statement`);
    }
  }
  const allRequirementIds = allRequirements.map((record) => record.id);
  const overlappingRequirementIds = duplicates(allRequirementIds);
  if (overlappingRequirementIds.length > 0) {
    errors.push(`standard: overlapping requirement IDs [${overlappingRequirementIds.join(", ")}]`);
  }
  if (coreRequirements.length !== EXPECTED_CORE_REQUIREMENTS) {
    errors.push(`core: expected ${EXPECTED_CORE_REQUIREMENTS} requirements, found ${coreRequirements.length}`);
  }
  if (catalogRequirements.length !== EXPECTED_CATALOG_REQUIREMENTS) {
    errors.push(`catalog: expected ${EXPECTED_CATALOG_REQUIREMENTS} requirements, found ${catalogRequirements.length}`);
  }
  const visibleStandard = withoutHtmlComments(`${core}\n${catalog}`);
  const requirementReferences = [...visibleStandard.matchAll(/\b(FPAW-[A-Z]+-\d{3})\b/g)].map(
    (match) => match[1],
  );
  const undefinedRequirements = difference(
    new Set(requirementReferences),
    new Set(allRequirementIds),
  );
  if (undefinedRequirements.length > 0) {
    errors.push(`standard: undefined requirement references [${undefinedRequirements.join(", ")}]`);
  }

  const requirementDepthByFamily = new Map<string, number>();
  for (const requirement of allRequirements) {
    requirementDepthByFamily.set(
      requirement.family,
      Math.max(requirementDepthByFamily.get(requirement.family) ?? 0, requirement.depth),
    );
  }
  const profileMembership = section(
    core,
    "Profile dependency and minimum claimable depth are normative:",
    "An implementation **MUST NOT** claim a profile",
  );
  const profileTable = parseMarkdownTable(
    profileMembership,
    "Profile",
    4,
    "core: conformance-profile dependency table",
    errors,
    ["Profile", "Required profiles", "Minimum claimable depth", "Requirement membership"],
  );
  const profileRows = profileTable.rows.flatMap((cells) => {
    const name = cells[0]?.match(/^`(FPAW-[A-Za-z-]+)`$/)?.[1];
    const depth = cells[2]?.match(/^`(R[0-5])`$/)?.[1];
    if (cells.length !== 4 || !name || !depth || !hasSemanticContent(cells[1]) ||
        !hasSemanticContent(cells[3])) {
      errors.push(`core: malformed conformance-profile row ${cells.join(" | ")}`);
      return [];
    }
    return [{ name, rawDependencies: cells[1], depth, membership: cells[3] }];
  });
  validateProfileGraph(profileRows, requirementDepthByFamily, errors);
  if (!core.includes("claim that records or references any Gap **MUST** add `FPAW-GAP-*`")) {
    errors.push("core: conditional GAP profile closure is missing");
  }
  if (!core.includes("claim that asserts any external mapping or candidate binding **MUST** add `FPAW-MAP-*`")) {
    errors.push("core: conditional MAP profile closure is missing");
  }

  const worked = section(
    catalog,
    "### 7.3 Worked profile-composition specimens (informative)",
    "## 8.",
  );
  const workedMetadata = [
    "**not complete Profiles**",
    "therefore `implementation-gap`",
    "For comparison, each specimen uses the same design metadata:",
    "Candidate 0.1.0 Core",
    "prospective owner `DPF Standards Steward`",
    "design date `2026-08-01`",
    "review-on-source-change",
    "external BindingState `absent`",
    "`ImplementationState = defined`",
    "`readiness = template-ready`",
    "`EvidenceVerificationStatus = provisional`",
    "informative design defaults, not normative",
  ];
  const compactWorked = worked.replace(/\s+/g, " ");
  if (workedMetadata.some((field) => !compactWorked.includes(field))) {
    errors.push("catalog: shared worked-specimen metadata contract is incomplete");
  }
  const workedSpecimens = [...worked.matchAll(
    /^#### `(FPAW-EX-([A-Z0-9-]+)@0\.1\.0)`[^\r\n]*\r?$/gm,
  )];
  const requiredWorkedFields = [
    "purpose / applicability",
    "inherited facets",
    "Product / Outcome",
    "four-portfolio bill",
    "ValueStream / work",
    "allocation / AI realization",
    "controls / evidence / measures",
    "composition result / gaps",
  ];
  if (workedSpecimens.length !== EXPECTED_WORKED_SPECIMENS) {
    errors.push(`catalog: expected ${EXPECTED_WORKED_SPECIMENS} worked specimens, found ${workedSpecimens.length}`);
  }
  const duplicateWorkedSpecimens = duplicates(workedSpecimens.map((specimen) => specimen[1]));
  if (duplicateWorkedSpecimens.length > 0) {
    errors.push(`catalog: duplicate worked specimens [${duplicateWorkedSpecimens.join(", ")}]`);
  }
  for (let index = 0; index < workedSpecimens.length; index += 1) {
    const specimen = workedSpecimens[index];
    const start = specimen.index ?? 0;
    const end = workedSpecimens[index + 1]?.index ?? worked.length;
    const block = worked.slice(start, end);
    const specimenLeaf = specimen[2].toLowerCase();
    if (!leafSet.has(specimenLeaf)) {
      errors.push(`catalog: ${specimen[1]} does not resolve to a canonical leaf`);
    }
    const fieldTable = parseMarkdownTable(
      block,
      "Required field",
      2,
      `catalog: ${specimen[1]} specimen table`,
      errors,
      ["Required field", "Value"],
    );
    const fields = new Map<string, string>();
    for (const cells of fieldTable.rows) {
      if (cells.length !== 2) continue;
      if (fields.has(cells[0])) {
        errors.push(`catalog: ${specimen[1]} has duplicate ${cells[0]}`);
      }
      fields.set(cells[0], cells[1]);
    }
    for (const field of requiredWorkedFields) {
      const value = fields.get(field);
      if (value === undefined) {
        errors.push(`catalog: ${specimen[1]} omits ${field}`);
      } else if (!hasSemanticContent(value)) {
        errors.push(`catalog: ${specimen[1]} has empty ${field}`);
      }
    }
    const expectedBinding = `\`${inventory.leafCategories[specimenLeaf]}/${specimenLeaf}\``;
    const purpose = fields.get("purpose / applicability") ?? "";
    if (leafSet.has(specimenLeaf) && !purpose.includes(expectedBinding)) {
      errors.push(`catalog: ${specimen[1]} purpose does not bind ${expectedBinding}`);
    }
    const allocation = fields.get("allocation / AI realization") ?? "";
    if (!allocation.includes("`implementation-gap`") || allocation.includes("`profile-bound`")) {
      errors.push(
        `catalog: ${specimen[1]} allocation must remain implementation-gap until a complete versioned profile is published`,
      );
    }
  }

  const sourceMetrics = validateSourceRecords(core, catalog, errors);

  const stageSection = section(core, "DPF's default macro-backbone", "### 8.2 Stage contract");
  const stageTable = parseMarkdownTable(
    stageSection,
    "Canonical key",
    2,
    "core: Stage table",
    errors,
    ["Canonical key", "Default display label"],
  );
  const stageContract = stageTable.rows.map((cells) => [
    cells[0]?.match(/^`([^`]+)`$/)?.[1] ?? "<malformed>",
    cells[1] ?? "",
  ]);
  if (stageContract.length !== EXPECTED_STAGE_CONTRACT.length ||
      stageContract.some((row, index) => !sameOrdered(row, EXPECTED_STAGE_CONTRACT[index]))) {
    errors.push(
      `core: canonical Stage contract must be exactly ordered; canonical Stage keys must be exactly [${EXPECTED_STAGE_CONTRACT.map(([key]) => key)}]`,
    );
  }

  const portfolioSection = section(core, "The four roots remain stable", "The snake_case keys above");
  const portfolioTable = parseMarkdownTable(
    portfolioSection,
    "Canonical FPAW exchange key",
    4,
    "core: canonical four-portfolio root table",
    errors,
    ["Canonical FPAW exchange key", "Display name", "Primary placement question", "Representative governed aspects"],
  );
  const portfolioRoots = portfolioTable.rows.map(
    (cells) => cells[0]?.match(/^`([^`]+)`$/)?.[1] ?? "<malformed>",
  );
  if (!sameOrdered(portfolioRoots, EXPECTED_PORTFOLIO_ROOTS)) {
    errors.push(
      `core: canonical four-portfolio root keys must be exactly ordered [${EXPECTED_PORTFOLIO_ROOTS}], found [${portfolioRoots}]`,
    );
  }

  const adapterSection = section(core, "The current DPF adapter mapping is:", "This table defines serialization equivalence");
  const adapterTable = parseMarkdownTable(
    adapterSection,
    "Current runtime/persistence key",
    2,
    "core: portfolio adapter table",
    errors,
    ["Current runtime/persistence key", "FPAW exchange key"],
  );
  const adapterRows = adapterTable.rows.map((cells) => [
    cells[0]?.match(/^`([^`]+)`$/)?.[1] ?? "<malformed>",
    cells[1]?.match(/^`([^`]+)`$/)?.[1] ?? "<malformed>",
  ]);
  if (adapterRows.length !== EXPECTED_PORTFOLIO_ADAPTER.length ||
      adapterRows.some((row, index) => !sameOrdered(row, EXPECTED_PORTFOLIO_ADAPTER[index]))) {
    errors.push(
      "core: portfolio adapter contract must be exactly ordered; portfolio adapter mapping is incomplete or incorrect",
    );
  }
  if (core.includes("FPAW-DigitalProduct-Lifecycle")) {
    errors.push("core: generic lifecycle profile name remains coupled to AI requirements");
  }

  return {
    errors,
    metrics: {
      categories: inventory.categories.length,
      leaves: inventory.leaves.length,
      itemTemplates: inventory.itemTemplates,
      matrixFamilies: families.length,
      matrixCells,
      deviations: deviations.length,
      coreRequirements: coreRequirements.length,
      catalogRequirements: catalogRequirements.length,
      totalRequirements: allRequirements.length,
      profiles: profileRows.length,
      workedSpecimens: workedSpecimens.length,
      ...sourceMetrics,
    },
  };
}

function main(): void {
  const core = readFileSync(resolve(CORE_PATH), "utf8");
  const catalog = readFileSync(resolve(CATALOG_PATH), "utf8");
  const result = analyzeFPAW(core, catalog);
  if (result.errors.length) {
    console.error("FPAW standard check failed:");
    result.errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  const m = result.metrics;
  console.log(
    `FPAW standard check passed: ${m.categories} categories, ${m.leaves} leaves, ` +
      `${m.itemTemplates} item templates, ${m.matrixCells} matrix cells, ${m.deviations} deviations, ` +
      `${m.totalRequirements} requirements, ${m.profiles} conformance profiles, ` +
      `${m.workedSpecimens} worked specimens, ${m.sourceUseDecisions}/${m.sourceCitations}/` +
      `${m.contributorAttestations} SUD/SCIT/CA records.`,
  );
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) main();
