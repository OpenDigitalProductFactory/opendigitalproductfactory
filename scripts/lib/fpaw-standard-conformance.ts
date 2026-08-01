const REQUIRED_SUD_FIELDS = [
  "source/title/owner/version/locator/access",
  "intended use / status",
  "action permissions",
  "attribution / trademark",
  "evidence / reviewer",
  "decision dates / expiry / revocation",
] as const;

const REQUIRED_SUD_ACTIONS = [
  "ai processing",
  "quotation",
  "paraphrase",
  "transformation",
  "storage",
  "reproduction",
  "repository",
  "apache-2.0 sublicensing",
  "external submission",
] as const;

const SUD_STATUSES = new Set([
  "permitted-public",
  "permitted-contributor",
  "reference-only",
  "excluded",
  "undetermined",
]);

const REQUIRED_CA_FIELDS = [
  "contributor / authentication",
  "work / relationship",
  "exact source scope",
  "contribution kind / separability",
  "asserted rights basis",
  "permissions / exclusions",
  "authentication / evidence / date",
] as const;

const EXPECTED_SUD_IDS = [
  "SUD-MB-FPAW-DIRECT-2026-08-01",
  "SUD-MB-CSDM-DIRECT-2026-08-01",
  "SUD-MB-RIGHTS-STATEMENT-2026-08-01",
  "SUD-C24A-COMPILED-2026-08-01",
  "SUD-G252-COMPILED-2026-08-01",
  "SUD-W205-2026-08-01",
  "SUD-PORTFOLIO-WORKBOOK-V2-2026-08-01",
  "SUD-PORTFOLIO-WORKBOOK-V3-2026-08-01",
  "SUD-IT4IT-CRITERIA-WORKBOOK-2026-08-01",
  "SUD-TAXONOMY-V3-COMPOSITE-2026-08-01",
  "SUD-CSDM-LOCAL-2026-08-01",
] as const;

const EXPECTED_CA_IDS = [
  "CA-MB-2026-08-01-IT4IT-PROVENANCE",
  "CA-MB-2026-08-01-CSDM-PROVENANCE",
] as const;

const EXPECTED_SCIT_IDS = [
  "SCIT-TOG-C24A",
  "SCIT-TOG-G252",
  "SCIT-TOG-W205",
  "SCIT-TOG-MEMBERSHIP",
  "SCIT-TOG-PROCESS",
  "SCIT-TOG-COPYRIGHT",
  "SCIT-TOG-LICENSING",
  "SCIT-TOG-TRADEMARKS",
  "SCIT-TOG-STYLE",
  "SCIT-MB-PROFILE",
  "SCIT-SNOW-CSDM-RESOURCES",
  "SCIT-SNOW-CSDM-MODEL",
  "SCIT-SNOW-CSDM-INDEX",
  "SCIT-SNOW-AICT-PRODUCT",
  "SCIT-SNOW-AICT-GUIDANCE",
  "SCIT-SNOW-TERMS",
  "SCIT-OMG-BACM",
  "SCIT-OMG-VDML",
  "SCIT-TOG-ARCHIMATE",
  "SCIT-OMG-BPMN",
  "SCIT-OMG-CMMN",
  "SCIT-OMG-DMN",
  "SCIT-NIST-AIRMF",
  "SCIT-ISO-42001",
  "SCIT-ISO-23894",
  "SCIT-ISO-30414",
  "SCIT-ILO-ISCO08",
  "SCIT-EC-ESCO",
  "SCIT-USDOL-ONET",
  "SCIT-ISA-95",
  "SCIT-GS1-STANDARDS",
  "SCIT-ISO-55000",
  "SCIT-W3C-PROVO",
  "SCIT-W3C-SKOS",
  "SCIT-W3C-SHACL",
  "SCIT-W3C-DCAT3",
] as const;

export const EXPECTED_DEVIATIONS = new Map<string, readonly [string, string]>([
  ["mobile-phlebotomy::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["optician::CW-SUPPLY", ["recommended", "required"]],
  ["dme-delivery::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["beauty-spa::CW-CUSTOMER-CARE", ["required", "specialized-profile-required"]],
  ["beauty-spa::CW-RECORDS-DATA", ["required", "specialized-profile-required"]],
  ["personal-trainer::CW-CUSTOMER-CARE", ["required", "specialized-profile-required"]],
  ["personal-trainer::CW-OPERATIONS", ["required", "specialized-profile-required"]],
  ["personal-trainer::CW-RECORDS-DATA", ["required", "specialized-profile-required"]],
  ["field-inspection::CW-SCHEDULE-DISPATCH", ["recommended", "specialized-profile-required"]],
  ["land-surveying::CW-SCHEDULE-DISPATCH", ["recommended", "specialized-profile-required"]],
  ["mobile-vet::CW-CUSTOMER-CARE", ["required", "specialized-profile-required"]],
  ["mobile-vet::CW-SCHEDULE-DISPATCH", ["required", "specialized-profile-required"]],
  ["mobile-vet::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["mobile-vet::CW-RECORDS-DATA", ["required", "specialized-profile-required"]],
  ["restaurant::CW-SCHEDULE-DISPATCH", ["recommended", "required"]],
  ["catering::CW-SCHEDULE-DISPATCH", ["recommended", "required"]],
  ["florist::CW-SCHEDULE-DISPATCH", ["recommended", "required"]],
  ["furniture-delivery-install::CW-SCHEDULE-DISPATCH", ["recommended", "specialized-profile-required"]],
  ["wholesale-distribution::CW-FINANCE", ["required", "specialized-profile-required"]],
  ["agricultural-cooperative::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["meal-delivery-program::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["property-management-company::CW-DEMAND-MARKET", ["recommended", "required"]],
  ["municipal-utility::CW-SUPPLY", ["recommended", "required"]],
  ["equipment-rental::CW-SUPPLY", ["recommended", "required"]],
  ["production-equipment-rental::CW-SUPPLY", ["recommended", "required"]],
  ["self-storage::CW-LEGAL-COMPLIANCE", ["required", "specialized-profile-required"]],
  ["freight-brokerage::CW-SUPPLY", ["recommended", "required"]],
  ["alarm-cctv-install::CW-SUPPLY", ["recommended", "required"]],
  ["event-production-staging::CW-SCHEDULE-DISPATCH", ["required", "specialized-profile-required"]],
  ["event-production-staging::CW-OPERATIONS", ["required", "specialized-profile-required"]],
  ["event-production-staging::CW-SUPPLY", ["recommended", "specialized-profile-required"]],
  ["event-production-staging::CW-WORKFORCE", ["required", "specialized-profile-required"]],
  ["mixed-farm-ranch::CW-CUSTOMER-CARE", ["required", "specialized-profile-required"]],
  ["cattle-ranch::CW-CUSTOMER-CARE", ["required", "specialized-profile-required"]],
]);

export function section(body: string, start: string, end: string): string {
  const from = body.indexOf(start);
  const to = body.indexOf(end, from + start.length);
  if (from < 0 || to < 0) return "";
  return body.slice(from, to);
}

export function difference(left: Iterable<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

export function duplicates(values: string[]): string[] {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

export function sameSet(left: Iterable<string>, right: Iterable<string>): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && difference(leftSet, rightSet).length === 0;
}

export function withoutHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
}

export function hasSemanticContent(value: string): boolean {
  const visible = value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(https?:\/\/[^>]+)>/gi, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:nbsp|#160|#xA0);/gi, "");
  return /[\p{L}\p{N}]/u.test(visible);
}

export function parseMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return [];

  const cells: string[] = [];
  let cell = "";
  for (const character of trimmed.slice(1, -1)) {
    if (character === "|") {
      let precedingBackslashes = 0;
      for (let index = cell.length - 1; index >= 0 && cell[index] === "\\"; index -= 1) {
        precedingBackslashes += 1;
      }
      if (precedingBackslashes % 2 === 0) {
        cells.push(cell.trim());
        cell = "";
        continue;
      }
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

export type MarkdownTable = {
  header: string[];
  rows: string[][];
  rowLines: string[];
};

export function parseMarkdownTable(
  body: string,
  headerFirstCell: string,
  expectedColumns: number,
  label: string,
  errors: string[],
  expectedHeader?: readonly string[],
): MarkdownTable {
  const lines = body.split(/\r?\n/);
  const headerIndex = lines.findIndex(
    (line) => parseMarkdownRow(line)[0] === headerFirstCell,
  );
  if (headerIndex < 0) {
    errors.push(`${label} header is missing`);
    return { header: [], rows: [], rowLines: [] };
  }

  const header = parseMarkdownRow(lines[headerIndex]);
  if (header.length !== expectedColumns) {
    errors.push(`${label} header must contain ${expectedColumns} columns, found ${header.length}`);
  }
  if (expectedHeader && (header.length !== expectedHeader.length ||
      header.some((cell, index) => cell !== expectedHeader[index]))) {
    errors.push(`${label} header must be exactly [${expectedHeader.join(" | ")}]`);
  }

  const delimiter = parseMarkdownRow(lines[headerIndex + 1] ?? "");
  if (delimiter.length !== expectedColumns) {
    errors.push(`${label} delimiter must contain ${expectedColumns} columns, found ${delimiter.length}`);
  } else if (delimiter.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    errors.push(`${label} delimiter is malformed`);
  }

  const rows: string[][] = [];
  const rowLines: string[] = [];
  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    if (!lines[index].trim().startsWith("|")) break;
    const cells = parseMarkdownRow(lines[index]);
    rows.push(cells);
    rowLines.push(lines[index]);
    if (cells.length !== expectedColumns) {
      errors.push(`${label} row must contain ${expectedColumns} columns, found ${cells.length}: ${lines[index]}`);
    }
  }
  return { header, rows, rowLines };
}

export type RequirementRecord = {
  id: string;
  family: string;
  depth: number;
  statement: string;
};

export type ProfileRow = {
  name: string;
  rawDependencies: string;
  depth: string;
  membership: string;
};

const EXPECTED_PROFILE_CONTRACT = new Map<string, {
  dependencies: string[];
  families: string[];
}>([
  ["FPAW-Core-Semantic", { dependencies: [], families: ["CORE", "CONF"] }],
  ["FPAW-Four-Portfolio", { dependencies: ["FPAW-Core-Semantic"], families: ["PORT", "PROD", "CONF"] }],
  ["FPAW-Business-Offering-Value", { dependencies: ["FPAW-Core-Semantic", "FPAW-Four-Portfolio"], families: ["PROD", "FLOW", "CONF"] }],
  ["FPAW-Operational-Work", { dependencies: ["FPAW-Core-Semantic", "FPAW-Business-Offering-Value"], families: ["FLOW", "WORK", "PHYS", "CONF"] }],
  ["FPAW-Workforce-AI", { dependencies: ["FPAW-Core-Semantic", "FPAW-Operational-Work", "FPAW-Assurance-Evidence"], families: ["WORK", "AI", "CONF"] }],
  ["FPAW-AI-Coworker-DigitalProduct-Lifecycle", { dependencies: ["FPAW-Core-Semantic", "FPAW-Four-Portfolio", "FPAW-Workforce-AI", "FPAW-Assurance-Evidence"], families: ["AI", "MAP", "CONF"] }],
  ["FPAW-Industry-Archetype", { dependencies: ["FPAW-Core-Semantic", "FPAW-Operational-Work", "FPAW-Workforce-AI"], families: ["PROF", "CONF", "CAT"] }],
  ["FPAW-Assurance-Evidence", { dependencies: ["FPAW-Core-Semantic"], families: ["MAP", "CONF", "GAP"] }],
  ["FPAW-Publication-Governance", { dependencies: ["FPAW-Core-Semantic"], families: ["GOV", "CONF"] }],
]);

export function requirementRecords(body: string): RequirementRecord[] {
  const records: RequirementRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    const cells = parseMarkdownRow(line);
    const idMatch = cells[0]?.match(/^`(FPAW-([A-Z]+)-\d{3})`$/);
    const depthMatch = cells[2]?.match(/^`(R[0-5])`$/);
    if (!idMatch || cells.length !== 3 || !depthMatch) continue;
    records.push({
      id: idMatch[1],
      family: idMatch[2],
      depth: Number(depthMatch[1].slice(1)),
      statement: cells[1],
    });
  }
  return records;
}

export function numericRequirementRows(body: string): string[] {
  return body.split(/\r?\n/).flatMap((line) => {
    const id = parseMarkdownRow(line)[0]?.match(/^`(FPAW-[A-Z]+-\d{3})`$/)?.[1];
    return id ? [id] : [];
  });
}

export function validateRequirementTableSyntax(
  body: string,
  label: string,
  errors: string[],
): void {
  const lines = body.split(/\r?\n/);
  let tables = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const header = parseMarkdownRow(lines[index]);
    if (header.join("\0") !== ["ID", "Requirement", "Minimum depth"].join("\0")) continue;
    tables += 1;
    const delimiter = parseMarkdownRow(lines[index + 1] ?? "");
    if (delimiter.length !== 3) {
      errors.push(`${label}: requirement delimiter must contain 3 columns, found ${delimiter.length}`);
    } else if (delimiter.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
      errors.push(`${label}: requirement delimiter is malformed`);
    }
  }
  if (tables === 0) errors.push(`${label}: requirement table header is missing`);
}

export function validateRequirementSequence(
  label: string,
  ids: string[],
  errors: string[],
): void {
  const duplicateIds = duplicates(ids);
  if (duplicateIds.length > 0) {
    errors.push(`${label}: duplicate requirement IDs [${duplicateIds.join(", ")}]`);
  }

  const byFamily = new Map<string, number[]>();
  for (const id of new Set(ids)) {
    const match = id.match(/^FPAW-([A-Z]+)-(\d{3})$/);
    if (!match) continue;
    const numbers = byFamily.get(match[1]) ?? [];
    numbers.push(Number(match[2]));
    byFamily.set(match[1], numbers);
  }
  for (const [family, numbers] of byFamily) {
    numbers.sort((a, b) => a - b);
    numbers.forEach((value, index) => {
      if (value !== index + 1) {
        errors.push(
          `${label}: ${family} sequence expected ${String(index + 1).padStart(3, "0")}, found ${String(value).padStart(3, "0")}`,
        );
      }
    });
  }
}

function dependencyName(token: string): string {
  return token === "Core" ? "FPAW-Core-Semantic" : `FPAW-${token}`;
}

export function validateProfileGraph(
  rows: ProfileRow[],
  requirementDepthByFamily: Map<string, number>,
  errors: string[],
): void {
  const expectedProfiles = [...EXPECTED_PROFILE_CONTRACT.keys()];
  const profileNames = rows.map((row) => row.name);
  const duplicateProfiles = duplicates(profileNames);
  if (duplicateProfiles.length > 0) {
    errors.push(`core: duplicate conformance profiles [${duplicateProfiles.join(", ")}]`);
  }
  if (!sameSet(profileNames, expectedProfiles)) {
    errors.push(
      `core: conformance-profile set differs; missing=[${difference(expectedProfiles, new Set(profileNames))}], ` +
        `extra=[${difference(profileNames, new Set(expectedProfiles))}]`,
    );
  }

  const dependencies = new Map<string, string[]>();
  for (const row of rows) {
    const resolved = row.rawDependencies.trim() === "none"
      ? []
      : row.rawDependencies.split(",").map((token) => dependencyName(token.trim()));
    dependencies.set(row.name, resolved);
    const duplicateDependencies = duplicates(resolved);
    if (duplicateDependencies.length > 0) {
      errors.push(`core: ${row.name} has duplicate dependencies [${duplicateDependencies.join(", ")}]`);
    }
    const contract = EXPECTED_PROFILE_CONTRACT.get(row.name);
    if (contract && !sameSet(resolved, contract.dependencies)) {
      errors.push(
        `core: ${row.name} dependencies must be exactly [${contract.dependencies.join(", ")}], found [${resolved.join(", ")}]`,
      );
    }
    for (const dependency of resolved) {
      if (!profileNames.includes(dependency)) {
        errors.push(`core: ${row.name} has undefined profile dependency ${dependency}`);
      }
    }

    const membershipFamilies = [...row.membership.matchAll(/FPAW-([A-Z]+)-\*/g)].map(
      (match) => match[1],
    );
    const duplicateFamilies = duplicates(membershipFamilies);
    if (duplicateFamilies.length > 0) {
      errors.push(`core: ${row.name} has duplicate requirement families [${duplicateFamilies.join(", ")}]`);
    }
    if (contract && !sameSet(membershipFamilies, contract.families)) {
      errors.push(
        `core: ${row.name} requirement families must be exactly [${contract.families.join(", ")}], found [${membershipFamilies.join(", ")}]`,
      );
    }
    if (membershipFamilies.length === 0) {
      errors.push(`core: ${row.name} has no machine-readable requirement membership`);
    }

    const deepest = membershipFamilies.reduce((maximum, family) => {
      const familyDepth = requirementDepthByFamily.get(family);
      if (familyDepth === undefined) {
        errors.push(`core: ${row.name} references undefined requirement family ${family}`);
        return maximum;
      }
      return Math.max(maximum, familyDepth);
    }, 0);
    const declaredDepth = Number(row.depth.slice(1));
    if (declaredDepth < deepest) {
      errors.push(`core: ${row.name} minimum ${row.depth} is below membership depth R${deepest}`);
    }
  }

  const visitState = new Map<string, "visiting" | "visited">();
  const visit = (profile: string, path: string[]): void => {
    const state = visitState.get(profile);
    if (state === "visiting") {
      errors.push(`core: profile dependency cycle ${[...path, profile].join(" -> ")}`);
      return;
    }
    if (state === "visited") return;
    visitState.set(profile, "visiting");
    for (const dependency of dependencies.get(profile) ?? []) {
      if (dependencies.has(dependency)) visit(dependency, [...path, profile]);
    }
    visitState.set(profile, "visited");
  };
  profileNames.forEach((profile) => visit(profile, []));

  const transitiveDependencies = (profile: string, seen = new Set<string>()): Set<string> => {
    for (const dependency of dependencies.get(profile) ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      transitiveDependencies(dependency, seen);
    }
    return seen;
  };
  for (const profile of profileNames) {
    if (profile === "FPAW-Core-Semantic") {
      if ((dependencies.get(profile) ?? []).length > 0) {
        errors.push("core: FPAW-Core-Semantic must not depend on another profile");
      }
    } else if (!transitiveDependencies(profile).has("FPAW-Core-Semantic")) {
      errors.push(`core: ${profile} dependency closure omits FPAW-Core-Semantic`);
    }
  }
}

function exactDefinitionSet(
  label: string,
  definitions: string[],
  expected: readonly string[],
  errors: string[],
): void {
  const duplicateDefinitions = duplicates(definitions);
  if (duplicateDefinitions.length > 0) {
    errors.push(`${label}: duplicate definitions [${duplicateDefinitions.join(", ")}]`);
  }
  if (!sameSet(definitions, expected) || definitions.length !== expected.length) {
    errors.push(
      `${label} set must be exactly [${expected.join(", ")}]; ` +
        `missing=[${difference(expected, new Set(definitions))}], extra=[${difference(definitions, new Set(expected))}]`,
    );
  }
}

function tableFields(block: string, label: string, errors: string[]): Map<string, string> {
  const table = parseMarkdownTable(block, "Field", 2, label, errors);
  const fields = new Map<string, string>();
  for (const cells of table.rows) {
    if (cells.length !== 2) continue;
    const field = cells[0].trim().toLowerCase();
    if (fields.has(field)) errors.push(`${label} has duplicate field ${field}`);
    fields.set(field, cells[1].trim());
  }
  return fields;
}

function referencedIds(body: string, prefix: "SUD" | "SCIT" | "CA"): string[] {
  const pattern = new RegExp("`(" + prefix + "-[A-Z0-9]+(?:-[A-Z0-9]+)*)`", "g");
  return [...withoutHtmlComments(body).matchAll(pattern)].map((match) => match[1]);
}

function validateReferenceClosure(
  label: string,
  references: string[],
  definitions: string[],
  errors: string[],
): void {
  const undefinedReferences = difference(new Set(references), new Set(definitions));
  if (undefinedReferences.length > 0) {
    errors.push(`${label}: undefined references [${undefinedReferences.join(", ")}]`);
  }
}

function validateRequiredFields(
  id: string,
  fields: Map<string, string>,
  required: readonly string[],
  errors: string[],
): void {
  for (const field of required) {
    const value = fields.get(field);
    if (value === undefined) errors.push(`core: ${id} omits ${field}`);
    else if (!hasSemanticContent(value)) errors.push(`core: ${id} has empty ${field}`);
  }
}

function validateSudRecord(id: string, block: string, errors: string[]): void {
  const fields = tableFields(block, `core: ${id} field table`, errors);
  validateRequiredFields(id, fields, REQUIRED_SUD_FIELDS, errors);

  const requiredKeyShapes = [
    ["rights context", (field: string) => field.includes("rights") && field.includes("context")],
    ["rights basis", (field: string) => field.startsWith("rights basis")],
    ["exact scope", (field: string) => field.includes("exact scope")],
    ["exclusions/conditions", (field: string) => field.startsWith("exclusions")],
  ] as const;
  for (const [label, matches] of requiredKeyShapes) {
    const entry = [...fields].find(([field]) => matches(field));
    if (!entry) errors.push(`core: ${id} omits ${label}`);
    else if (!hasSemanticContent(entry[1])) errors.push(`core: ${id} has empty ${label}`);
  }

  const statusValue = fields.get("intended use / status") ?? "";
  const status = statusValue.match(/;\s*`([^`]+)`\s*$/)?.[1];
  if (!status || !SUD_STATUSES.has(status)) {
    errors.push(`core: ${id} has invalid intended-use status ${status ?? "<missing>"}`);
  }

  const permissions = (fields.get("action permissions") ?? "").toLowerCase();
  const clauses = permissions.split(";");
  for (const action of REQUIRED_SUD_ACTIONS) {
    const actionClauses = clauses.filter((clause) => clause.includes(action));
    if (actionClauses.length === 0) {
      errors.push(`core: ${id} action permissions omit ${action}`);
      continue;
    }
    if (actionClauses.some((clause) => {
      const disposition = clause.slice(clause.lastIndexOf(":") + 1);
      return !clause.includes(":") || !hasSemanticContent(disposition);
    })) {
      errors.push(`core: ${id} action permissions lack a disposition for ${action}`);
    }
  }
}

export type SourceRecordMetrics = {
  sourceUseDecisions: number;
  sourceCitations: number;
  contributorAttestations: number;
};

export function validateSourceRecords(
  core: string,
  catalog: string,
  errors: string[],
): SourceRecordMetrics {
  const visibleCore = withoutHtmlComments(core);
  const sudSection = section(visibleCore, "### 20.2 Complete SourceUseDecision", "### 20.3 ContributorAttestation");
  const sudHeadings = [...sudSection.matchAll(/^#### 20\.2\.\d+ `(SUD-[A-Z0-9-]+)`\r?$/gm)];
  const sudDefinitions = sudHeadings.map((heading) => heading[1]);
  exactDefinitionSet("SourceUseDecision", sudDefinitions, EXPECTED_SUD_IDS, errors);
  for (let index = 0; index < sudHeadings.length; index += 1) {
    const heading = sudHeadings[index];
    const start = heading.index ?? 0;
    const end = sudHeadings[index + 1]?.index ?? sudSection.length;
    validateSudRecord(heading[1], sudSection.slice(start, end), errors);
  }

  const contributorSection = section(visibleCore, "### 20.3 ContributorAttestation", "### 20.4 SourceCitation");
  const contributorHeadings = [...contributorSection.matchAll(
    /^#### 20\.3\.\d+ `(CA-[A-Z0-9-]+)`\r?$/gm,
  )];
  const contributorDefinitions = contributorHeadings.map((heading) => heading[1]);
  exactDefinitionSet("ContributorAttestation", contributorDefinitions, EXPECTED_CA_IDS, errors);
  for (let index = 0; index < contributorHeadings.length; index += 1) {
    const heading = contributorHeadings[index];
    const start = heading.index ?? 0;
    const end = contributorHeadings[index + 1]?.index ?? contributorSection.length;
    const fields = tableFields(
      contributorSection.slice(start, end),
      `core: ${heading[1]} field table`,
      errors,
    );
    validateRequiredFields(heading[1], fields, REQUIRED_CA_FIELDS, errors);
    const terminal = fields.get("adoption / external submission") ?? fields.get("attribution rule");
    if (terminal === undefined) {
      errors.push(`core: ${heading[1]} omits terminal use/attribution disposition`);
    } else if (!hasSemanticContent(terminal)) {
      errors.push(`core: ${heading[1]} has empty terminal use/attribution disposition`);
    }
  }

  const citationSection = section(visibleCore, "### 20.4 SourceCitation", "### 20.5 Current source");
  if (!/Every row[^\r\n]*accessed \d{4}-\d{2}-\d{2}/.test(citationSection)) {
    errors.push("core: SourceCitation register omits its common access date");
  }
  const citationTable = parseMarkdownTable(
    citationSection,
    "ID",
    4,
    "core: SourceCitation",
    errors,
    ["ID", "Owner / title and version", "Canonical locator or reproducible resolver", "Orientation scope"],
  );
  const citationDefinitions: string[] = [];
  const locatorUrls = new Set<string>();
  for (const columns of citationTable.rows) {
    if (columns.length !== 4) continue;
    const id = columns[0].match(/^`(SCIT-[A-Z0-9-]+)`$/)?.[1];
    if (!id) {
      errors.push(`core: malformed SourceCitation ID ${columns[0]}`);
      continue;
    }
    citationDefinitions.push(id);
    if (!hasSemanticContent(columns[1]) || !hasSemanticContent(columns[2]) ||
        !hasSemanticContent(columns[3])) {
      errors.push(`core: ${id} must contain four semantically non-empty SourceCitation fields`);
    }
    const locator = columns[2].match(/^<(https:\/\/[^>\s]+)>(?:\s*;[\s\S]*)?$/)?.[1];
    if (!locator) {
      errors.push(`core: ${id} must have a canonical HTTPS locator`);
      continue;
    }
    try {
      const parsed = new URL(locator);
      if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
        errors.push(`core: ${id} must have a canonical HTTPS locator`);
        continue;
      }
      locatorUrls.add(locator);
    } catch {
      errors.push(`core: ${id} must have a canonical HTTPS locator`);
    }
  }
  exactDefinitionSet("SourceCitation", citationDefinitions, EXPECTED_SCIT_IDS, errors);

  const orientationSection = section(visibleCore, "### 13.2 Orientation references", "### 13.3 IT4IT");
  for (const match of orientationSection.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
    const locator = match[1];
    if (!locator.startsWith("https://")) {
      errors.push(`core: orientation URL must use HTTPS ${locator}`);
    } else if (!locatorUrls.has(locator)) {
      errors.push(`core: orientation URL has no exact SourceCitation locator ${locator}`);
    }
  }

  const combined = `${visibleCore}\n${withoutHtmlComments(catalog)}`;
  validateReferenceClosure("SourceUseDecision", referencedIds(combined, "SUD"), sudDefinitions, errors);
  validateReferenceClosure("ContributorAttestation", referencedIds(combined, "CA"), contributorDefinitions, errors);
  validateReferenceClosure("SourceCitation", referencedIds(combined, "SCIT"), citationDefinitions, errors);

  return {
    sourceUseDecisions: sudDefinitions.length,
    sourceCitations: citationDefinitions.length,
    contributorAttestations: contributorDefinitions.length,
  };
}
