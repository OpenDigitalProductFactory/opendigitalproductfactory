import { createHash } from "node:crypto";

import type { ContentBlock } from "@/lib/inference/ai-inference";
import type {
  GovernedPayloadHint,
  InferenceDataClass,
  InferencePayloadClassification,
  InferencePayloadClassificationInput,
  InferencePayloadMatch,
  InferencePayloadSensitivity,
} from "./types";

type TextProbe = {
  path: string;
  text: string;
};

type ClassRule = {
  dataClass: InferenceDataClass;
  reason: string;
  confidence: InferencePayloadMatch["confidence"];
  pathPattern?: RegExp;
  textPattern?: RegExp;
  /**
   * BI-CD13D818 — this rule is built from vocabulary that is ALSO ordinary
   * English outside its protected domain ("performance", "benefits", "manager",
   * "incident"). On its own such a match may not escalate a turn to
   * `restricted`, because restricted hard-denies every external provider; it
   * needs a second, distinct detector to corroborate it. A lone match still
   * lands on `confidential`, so the control keeps failing closed.
   *
   * Set this ONLY where the words genuinely collide with common usage. Precise
   * evidence — a field literally named `password` or `employeeDiscipline`, a
   * secret-shaped token — must NOT carry this flag and escalates alone.
   */
  ambiguousVocabulary?: true;
};

// Text probes must contain value-shaped evidence, not merely governance or
// instructional vocabulary that happens to name a protected data class.
//
// Split by precision (BI-CD13D818). The first set names employment data and
// nothing else; the second is real HR vocabulary that is ALSO everyday English
// on an AI-operations, capacity, or product surface, so it needs corroboration.
const EMPLOYEE_RECORD_VALUE_PATTERN =
  /\b(?:salary|performance review|disciplinary|manager-only|payroll)\b/i;
const EMPLOYEE_RECORD_AMBIGUOUS_VALUE_PATTERN =
  /\b(?:compensation|benefits?)\b/i;

const SOURCE_CODE_VALUE_PATTERN =
  /(?:\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?:[:=;,])|\bfunction\s+[A-Za-z_$][\w$]*\s*\(|\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{|\bimport\s+[\w*{},\s]+\s+from\s+["']|\bexport\s+(?:default\s+)?(?:const|let|var|function|class)\b|=>|```(?:ts|tsx|js|jsx|py|sql|sh|ps1)\b)/;

const CLASS_RULES: readonly ClassRule[] = [
  {
    dataClass: "secrets-credentials",
    reason: "secret-shaped-token",
    confidence: "deterministic",
    textPattern:
      /\b(?:sk-[A-Za-z0-9_-]{10,}|dpfmcp_[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,}|AKIA[0-9A-Z]{12,}|-----BEGIN\s+(?:RSA\s+)?PRIVATE KEY-----)\b/i,
  },
  {
    dataClass: "secrets-credentials",
    reason: "secret-field-name",
    confidence: "inferred",
    pathPattern: /\b(?:api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|credential|authorization)\b/i,
  },
  {
    dataClass: "customer-records",
    reason: "contact-detail",
    confidence: "deterministic",
    textPattern:
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/i,
  },
  {
    dataClass: "customer-records",
    reason: "customer-record-field",
    confidence: "inferred",
    pathPattern: /\b(?:customer|account|contact|support|order|address|phone|email)\b/i,
  },
  {
    dataClass: "employee-records",
    reason: "employee-record-field",
    confidence: "inferred",
    pathPattern: /\b(?:employee|salary|discipline|payroll|performance[-_ ]?review)\b/i,
  },
  {
    dataClass: "employee-records",
    reason: "employee-record-text",
    confidence: "inferred",
    textPattern: EMPLOYEE_RECORD_VALUE_PATTERN,
  },
  {
    // Same class, weaker evidence: these words carry employment meaning in an HR
    // context and an entirely innocent one elsewhere (model `performance`, the
    // `benefits` of a routing change, a capacity `manager`, a `worker` process).
    // Corroboration-gated so one of them cannot deny all external routing on its
    // own — the live /platform/ai/operations-map false positive.
    dataClass: "employee-records",
    reason: "employee-record-ambiguous-term",
    confidence: "inferred",
    ambiguousVocabulary: true,
    pathPattern: /\b(?:worker|compensation|benefit|performance|manager)\b/i,
    textPattern: EMPLOYEE_RECORD_AMBIGUOUS_VALUE_PATTERN,
  },
  {
    dataClass: "payments-finance",
    reason: "payment-or-finance-field",
    confidence: "inferred",
    pathPattern:
      /\b(?:payment|card|credit[-_]?card|routing[-_]?number|account[-_]?number|iban|invoice|bank|tax|payroll)\b/i,
  },
  {
    dataClass: "payments-finance",
    reason: "payment-or-finance-text",
    confidence: "inferred",
    textPattern:
      /\b(?:routing number|account number|credit card|invoice|bank account|payroll|tax id|ein|ssn)\b/i,
  },
  {
    dataClass: "health-phi",
    reason: "health-record-field",
    confidence: "inferred",
    pathPattern: /\b(?:patient|diagnosis|medication|medical|health|phi|hipaa|visit|claim)\b/i,
  },
  {
    dataClass: "student-records",
    reason: "student-record-field",
    confidence: "inferred",
    pathPattern: /\b(?:student|learner|iep|ferpa|grade|transcript|enrollment)\b/i,
  },
  {
    dataClass: "legal-privileged",
    reason: "legal-privilege-field",
    confidence: "inferred",
    pathPattern: /\b(?:attorney|legal|privileged|counsel|litigation|contract[-_]?review)\b/i,
  },
  {
    dataClass: "public-sector-records",
    reason: "public-sector-field",
    confidence: "inferred",
    pathPattern: /\b(?:citizen|case[-_]?number|permit|public[-_]?sector|foia|agency)\b/i,
  },
  {
    dataClass: "security-logs",
    reason: "security-log-field",
    confidence: "inferred",
    pathPattern: /\b(?:security[-_]?log|audit[-_]?log|ip[-_]?address|siem)\b/i,
  },
  {
    // `incident` and `threat` are security vocabulary and also ordinary
    // operations vocabulary (an incident note about a stalled build, the threat
    // a regression poses). Corroboration-gated for the same reason as the
    // employee-record ambiguous terms — BI-CD13D818.
    dataClass: "security-logs",
    reason: "security-log-ambiguous-term",
    confidence: "inferred",
    ambiguousVocabulary: true,
    pathPattern: /\b(?:incident|threat)\b/i,
  },
  {
    dataClass: "criminal-justice",
    reason: "criminal-justice-field",
    confidence: "inferred",
    pathPattern:
      /\b(?:criminal[-_ ]?justice|cji|ncic|criminal[-_ ]?history|arrest[-_ ]?record|rap[-_ ]?sheet)\b/i,
    textPattern:
      /\b(?:criminal justice information|CJI|NCIC|criminal history|arrest record|rap sheet)\b/i,
  },
  {
    dataClass: "safety-sensitive",
    reason: "safety-sensitive-field",
    confidence: "inferred",
    pathPattern:
      /\b(?:threat[-_ ]?assessment|safety[-_ ]?plan|shelter[-_ ]?location|domestic[-_ ]?violence|emergency[-_ ]?response)\b/i,
    textPattern:
      /\b(?:threat assessment|protected shelter location|domestic violence safety plan)\b/i,
  },
  {
    dataClass: "youth-sensitive",
    reason: "youth-sensitive-field",
    confidence: "inferred",
    pathPattern:
      /\b(?:parental[-_ ]?consent|guardian|minor|child[-_ ]?(?:record|profile|age|birth)|youth)\b/i,
    textPattern:
      /\b(?:child under 13|parental consent|legal guardian|minor child|youth record)\b/i,
  },
  {
    dataClass: "regulated-decisioning",
    reason: "regulated-decisioning-field",
    confidence: "inferred",
    pathPattern: /\b(?:eligibility|underwriting|risk[-_]?score|credit[-_]?decision|benefit[-_]?decision)\b/i,
  },
  {
    dataClass: "source-code",
    reason: "source-code-text",
    confidence: "inferred",
    textPattern: SOURCE_CODE_VALUE_PATTERN,
  },
  {
    dataClass: "source-code",
    reason: "source-code-field",
    confidence: "inferred",
    pathPattern: /\b(?:source|source[-_]?code|stack|diff|patch|repository|commit|filePath)\b/i,
  },
] as const;

const RESTRICTED_CLASSES = new Set<InferenceDataClass>([
  "employee-records",
  "payments-finance",
  "health-phi",
  "student-records",
  "legal-privileged",
  "security-logs",
  "public-sector-records",
  "regulated-decisioning",
  "secrets-credentials",
  "unknown-governed-data",
]);

/**
 * Reasons emitted by `ambiguousVocabulary` rules — derived from CLASS_RULES so a
 * new corroboration-gated rule can never be added without this set following it
 * (BI-CD13D818).
 */
const AMBIGUOUS_REASONS: ReadonlySet<string> = new Set(
  CLASS_RULES.filter((rule) => rule.ambiguousVocabulary).map((rule) => rule.reason),
);

const CONFIDENTIAL_CLASSES = new Set<InferenceDataClass>([
  "customer-records",
  "source-code",
]);

export function classifyInferencePayload(
  input: InferencePayloadClassificationInput,
): InferencePayloadClassification {
  const probes = collectTextProbes(input);
  const matches: InferencePayloadMatch[] = [];

  for (const probe of probes) {
    for (const rule of CLASS_RULES) {
      if (
        rule.pathPattern?.test(normalizeProbePath(probe.path)) ||
        rule.textPattern?.test(probe.text)
      ) {
        matches.push({
          dataClass: rule.dataClass,
          path: probe.path,
          reason: rule.reason,
          confidence: rule.confidence,
        });
      }
    }
  }

  matches.push(...classifyGovernedHints(input.governedData));

  const dedupedMatches = dedupeMatches(matches);
  const dataClasses = uniqueSorted(dedupedMatches.map((match) => match.dataClass));
  const overallSensitivity = inferOverallSensitivity(dedupedMatches, input.governedData);
  const inputHash = hashCanonical({
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    tools: input.tools ?? [],
    taskType: input.taskType ?? null,
    governedData: input.governedData ?? [],
  });

  return {
    overallSensitivity,
    dataClasses,
    matches: dedupedMatches,
    receipt: {
      screenId: `screen_${inputHash.slice(0, 16)}`,
      inputHash,
      detectedClasses: dataClasses,
      matchCount: dedupedMatches.length,
      transformation: "none",
      rawPayloadStored: false,
    },
  };
}

function normalizeProbePath(path: string): string {
  return path
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[.[\]]+/g, "-")
    .toLowerCase();
}

function collectTextProbes(input: InferencePayloadClassificationInput): TextProbe[] {
  const probes: TextProbe[] = [];
  if (input.systemPrompt) {
    probes.push({ path: "systemPrompt", text: input.systemPrompt });
  }

  input.messages.forEach((message, index) => {
    probes.push({ path: `messages[${index}].role`, text: message.role });
    collectMessageContent(message.content, `messages[${index}].content`, probes);
    if (message.toolCallId) {
      probes.push({ path: `messages[${index}].toolCallId`, text: message.toolCallId });
    }
    message.toolCalls?.forEach((toolCall, toolIndex) => {
      probes.push({
        path: `messages[${index}].toolCalls[${toolIndex}].name`,
        text: toolCall.name,
      });
      collectUnknown(
        toolCall.arguments,
        `messages[${index}].toolCalls[${toolIndex}].arguments`,
        probes,
      );
    });
  });

  // Tool declarations are transport metadata, not live organization data.
  // Their static schemas commonly contain field names such as `password`,
  // `employee`, or `payment`; classifying those names as payload values forces
  // every broad agentic tool surface into restricted/local-only routing. Keep
  // declarations in the canonical input hash below, but classify only actual
  // prompts, messages, tool-call arguments/results, and governed-data hints.
  if (input.taskType) {
    probes.push({ path: "taskType", text: input.taskType });
  }
  return probes;
}

function collectMessageContent(
  content: string | ContentBlock[],
  path: string,
  probes: TextProbe[],
): void {
  if (typeof content === "string") {
    probes.push({ path, text: content });
    return;
  }

  content.forEach((block, index) => {
    const blockPath = `${path}[${index}]`;
    probes.push({ path: `${blockPath}.type`, text: block.type });
    switch (block.type) {
      case "text":
        probes.push({ path: `${blockPath}.text`, text: block.text });
        break;
      case "image_url":
        probes.push({ path: `${blockPath}.image_url.url`, text: block.image_url.url });
        break;
      case "input_audio":
        probes.push({ path: `${blockPath}.input_audio.format`, text: block.input_audio.format });
        break;
      case "tool_use":
        probes.push({ path: `${blockPath}.name`, text: block.name });
        collectUnknown(block.input, `${blockPath}.input`, probes);
        break;
      case "tool_result":
        probes.push({ path: `${blockPath}.content`, text: block.content });
        break;
    }
  });
}

function collectUnknown(value: unknown, path: string, probes: TextProbe[]): void {
  if (typeof value === "string") {
    probes.push({ path, text: value });
    return;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    probes.push({ path, text: String(value) });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectUnknown(entry, `${path}[${index}]`, probes));
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  for (const [key, entry] of Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) {
    collectUnknown(entry, `${path}.${key}`, probes);
  }
}

function classifyGovernedHints(
  hints: readonly GovernedPayloadHint[] | undefined,
): InferencePayloadMatch[] {
  if (!hints) return [];
  const matches: InferencePayloadMatch[] = [];
  hints.forEach((hint, index) => {
    if (!hint.classificationKnown) {
      matches.push({
        dataClass: "unknown-governed-data",
        path: `governedData[${index}]`,
        reason: "governed-classification-missing",
        confidence: "governed",
      });
    }
    hint.dataClasses?.forEach((dataClass) => {
      matches.push({
        dataClass,
        path: `governedData[${index}].dataClasses`,
        reason: "governed-classification-hint",
        confidence: "governed",
      });
    });
  });
  return matches;
}

function dedupeMatches(matches: InferencePayloadMatch[]): InferencePayloadMatch[] {
  const seen = new Set<string>();
  const deduped: InferencePayloadMatch[] = [];
  for (const match of matches) {
    const key = `${match.dataClass}\0${match.path}\0${match.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(match);
  }
  return deduped.sort((a, b) =>
    `${a.dataClass}:${a.path}:${a.reason}`.localeCompare(`${b.dataClass}:${b.path}:${b.reason}`),
  );
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

/**
 * Escalate to `restricted` only on corroborated evidence — BI-CD13D818.
 *
 * WHY THIS IS NOT A SIMPLE "any restricted class => restricted" TEST.
 *
 * Several restricted classes are detected by regexes built from ordinary
 * English words: `benefit(s)`, `performance`, `manager`, `worker`,
 * `compensation`, `incident`, `threat`. On a non-HR, non-security surface those
 * appear in their everyday sense constantly — "model performance", "the
 * benefits of local routing", "capacity manager". A single such match escalated
 * the whole turn to `restricted`, which the data policy then hard-denies for
 * every external destination (`restricted-cannot-leave-boundary`), leaving only
 * local-cleared endpoints.
 *
 * Observed live: a /platform/ai/operations-map conversation was classified
 * `employee-records` and pinned to the bundled local model — 14 of 15 endpoints
 * excluded, 1 candidate ranked. ~20% of recent routing decisions escalated this
 * way. The same over-trigger was already fixed once for tool DECLARATIONS (see
 * the note in collectTextProbes); this is the prose-shaped recurrence.
 *
 * Escalation now requires one of:
 *   1. an explicit governed-data hint marked restricted — governance stated by
 *      the caller, never inferred, always honoured;
 *   2. any restricted-class match that is NOT from an `ambiguousVocabulary`
 *      rule — a declared governed class, a secret-shaped token, or a field
 *      literally named `password` / `employeeDiscipline`. Precise evidence
 *      escalates alone and is never subject to the corroboration bar;
 *   3. TWO OR MORE DISTINCT ambiguous detectors agreeing. One word echoed
 *      across many probes is one signal, so corroboration counts distinct
 *      `reason` values rather than match volume.
 *
 * A lone ambiguous signal does NOT drop to `internal` — it lands on
 * `confidential`, which still confines routing to confidential-cleared
 * providers. The control keeps failing closed; it just stops treating one
 * ambiguous English word as proof of an HR or security record.
 *
 * Kernel decision DI-0A58373E26D0 (2026-07-31) scored this against narrowing
 * the patterns outright, weighting paths over prose, and granting an external
 * provider restricted clearance. This option won with high confidence (margin
 * 2.70, no commandment conflict); granting external clearance scored worst,
 * opposed by "Outbound and irreversible actions require explicit go" and
 * "Least privilege, deny by default".
 */
function inferOverallSensitivity(
  matches: readonly InferencePayloadMatch[],
  governedData: readonly GovernedPayloadHint[] | undefined,
): InferencePayloadSensitivity {
  if (governedData?.some((hint) => hint.sensitivity === "restricted")) {
    return "restricted";
  }

  const restrictedMatches = matches.filter((match) => RESTRICTED_CLASSES.has(match.dataClass));
  const hasPreciseEvidence = restrictedMatches.some(
    (match) => !AMBIGUOUS_REASONS.has(match.reason),
  );
  const distinctAmbiguousReasons = new Set(
    restrictedMatches
      .filter((match) => AMBIGUOUS_REASONS.has(match.reason))
      .map((match) => match.reason),
  ).size;
  if (hasPreciseEvidence || distinctAmbiguousReasons >= 2) {
    return "restricted";
  }

  const dataClasses = matches.map((match) => match.dataClass);
  if (
    restrictedMatches.length > 0 ||
    governedData?.some((hint) => hint.sensitivity === "confidential") ||
    dataClasses.some((dataClass) => CONFIDENTIAL_CLASSES.has(dataClass))
  ) {
    return "confidential";
  }
  return "internal";
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
