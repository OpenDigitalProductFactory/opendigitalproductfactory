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
   * Occurrences matching this are removed from the probe text BEFORE
   * `textPattern` is evaluated, so the rule fires only on evidence that is NOT
   * exempt. Strip-then-retest rather than skip-if-present on purpose: a payload
   * carrying both a DCO trailer and a genuine customer address must still
   * match on the genuine one (BI-EBE25715).
   */
  textExemptionPattern?: RegExp;
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
// Addresses that identify a COMMIT AUTHOR or the acting account, not a customer.
// Matched with the surrounding trailer/identifier so a bare address elsewhere in
// the same payload is still classified normally (BI-EBE25715).
const GIT_AUTHORSHIP_EMAIL_PATTERN =
  /(?:signed-off-by|co-authored-by|author|committer|reported-by|reviewed-by|acked-by|createdby(?:id)?|actorid)\s*:?\s*[^\n<]*<?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}>?|<(?:noreply|no-reply|do-not-reply)@[A-Z0-9.-]+\.[A-Z]{2,}>/i;

const EMPLOYEE_RECORD_VALUE_PATTERN =
  /\b(?:salary|performance review|disciplinary|manager-only|payroll record|employee record|personnel file)\b/i;
// BARE `payroll` moved here from the precise set (BI-67CAF494). It names a
// DOMAIN, not a record: "the payroll module", "design payroll tax acquisition",
// "help me with payroll" are all requests ABOUT payroll containing no payroll
// data. Escalating on it alone meant a coworker could not be asked for help with
// payroll at all — the request was clamped to local-only before anyone read it.
//
// The record-SHAPED phrases stay precise and still escalate alone: "payroll
// record", "employee record", "personnel file" name the thing itself, as do a
// salary figure or an SSN. The line is domain versus record, not topic.
const EMPLOYEE_RECORD_AMBIGUOUS_VALUE_PATTERN =
  /\b(?:compensation|benefits?|payroll)\b/i;

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
    // BI-EBE25715: an address carried as AUTHORSHIP METADATA is not a customer
    // contact record. Build Studio payloads routinely embed commit history —
    // `Signed-off-by:` (the DCO the repo requires on every commit),
    // `Co-Authored-By:`, `Author:` — plus the operator's own account id. Those
    // matched `contact-detail` deterministically, which is precise evidence, so
    // it escalated the turn to `confidential` on its own and the vertical
    // customer-records pack denied external routing. The observed effect was
    // that ordinary source-code turns were pinned to `local_only` and then died
    // whenever local-CI held the host reservation.
    //
    // Scope is deliberately narrow: the address must sit in a recognised
    // trailer/identifier position. A bare address anywhere else still matches,
    // so a real customer email pasted into a message is unaffected.
    textExemptionPattern: GIT_AUTHORSHIP_EMAIL_PATTERN,
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
    // `disciplinary` and `employeeDiscipline` name employment records and nothing
    // else. Bare `discipline` does not — it is a field of practice as often as an
    // HR action — so it sits in the corroboration-gated rule below (BI-3F608240).
    pathPattern: /\b(?:employee|salary|disciplinary|employee[-_ ]?discipline|payroll|performance[-_ ]?review)\b/i,
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
    pathPattern: /\b(?:worker|compensation|benefit|performance|manager|discipline)\b/i,
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
    // `payroll` is deliberately absent from this list. It is employment
    // vocabulary and belongs to the employee-records rules; carrying it here too
    // made ONE word produce two distinct restricted reasons, which is exactly the
    // corroboration bar — so the guard corroborated itself (BI-67CAF494).
    //
    // `invoice` and `bank account` are left precise on purpose. They read as
    // domain words too, but no evidence shows them causing a false clamp, and
    // demoting them stops semantic memory producing a mask obligation for
    // confidential content — which silently DROPS the memory rather than storing
    // it masked. Not changed without evidence that it needs changing.
    textPattern:
      /\b(?:routing number|account number|credit card|invoice|bank account|tax id|ein|ssn)\b/i,
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

/**
 * Remove every occurrence of `exemption` from `text` so a rule's own pattern is
 * evaluated against the remainder only. Returns the text unchanged when the
 * exemption never matches, so the common path costs one failed regex test.
 */
function stripExemptSpans(text: string, exemption: RegExp): string {
  const global = exemption.global
    ? exemption
    : new RegExp(exemption.source, `${exemption.flags}g`);
  global.lastIndex = 0;
  return text.replace(global, " ");
}

export function classifyInferencePayload(
  input: InferencePayloadClassificationInput,
): InferencePayloadClassification {
  const probes = collectTextProbes(input);
  const matches: InferencePayloadMatch[] = [];

  for (const probe of probes) {
    for (const rule of CLASS_RULES) {
      const probeText = rule.textExemptionPattern
        ? stripExemptSpans(probe.text, rule.textExemptionPattern)
        : probe.text;
      if (
        rule.pathPattern?.test(normalizeProbePath(probe.path)) ||
        rule.textPattern?.test(probeText)
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
  const dataMatches = dedupedMatches.filter((match) => !isInstructionProvenance(match));
  // The corroboration bar decides BOTH verdicts a restricted class can drive.
  // Sensitivity was gated on it from the start; the data-evidenced set was not,
  // and that set selects the vertical policy packs — each of which asserts its
  // own class sensitivity in the PDP context, overriding the gated one. So an
  // uncorroborated ambiguous match still reached `restricted-external-destination`
  // and clamped residency to local_only, voiding the gate on the harder of the
  // two exclusions. One predicate, both verdicts (BI-DECCF716).
  const restrictedCorroborated = restrictedEvidenceIsCorroborated(
    dataMatches,
    input.governedData,
  );
  const dataEvidencedClasses = uniqueSorted(
    dataMatches
      .filter((match) =>
        restrictedCorroborated || !RESTRICTED_CLASSES.has(match.dataClass)
      )
      .map((match) => match.dataClass),
  );
  const overallSensitivity = inferOverallSensitivity(dedupedMatches, input.governedData);
  const inputHash = hashCanonical({
    messages: input.messages,
    systemPrompt: input.systemPrompt,
    systemPromptInstructionSpans: input.systemPromptInstructionSpans ?? [],
    tools: input.tools ?? [],
    taskType: input.taskType ?? null,
    governedData: input.governedData ?? [],
  });

  return {
    overallSensitivity,
    dataClasses,
    dataEvidencedClasses,
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
    const split = splitPromptByProvenance(
      input.systemPrompt,
      input.systemPromptInstructionSpans,
    );
    split.instruction.forEach((span, index) => {
      probes.push({ path: `${INSTRUCTION_PATH_PREFIX}${index}]`, text: span });
    });
    // The remainder keeps the bare `systemPrompt` path: it is data, and every
    // caller that supplies no spans lands here with the whole prompt, unchanged.
    if (split.data.trim().length > 0) {
      probes.push({ path: "systemPrompt", text: split.data });
    }
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
 *
 * DI-BF2FEDA18D81 (2026-08-23) revisited the provenance half of that decision on
 * live measurement DI-0A58373E26D0 did not have, and added the instruction-path
 * rule documented on INSTRUCTION_PROBE_PATHS above. It did NOT reopen external
 * clearance, which remains rejected for the same two commandments.
 */
/**
 * Probe-path prefix for a span of the system prompt the caller marked as
 * platform-authored INSTRUCTION (BI-463BE12A / BI-9C14CB5D).
 *
 * A coworker's system prompt describes the job it does. A COO's says "payroll";
 * a finance controller's says "invoice"; an HR director's says "salary". Those
 * are `employee-records` and `payments-finance` text patterns, and because
 * neither is `ambiguousVocabulary` they took the hasPreciseEvidence branch below
 * and escalated the turn to `restricted` — which hard-denies every external
 * provider. Measured on the live install over seven days: coo 36/36,
 * hr-specialist 33/33, admin-assistant 38/38, market-research-analyst 50/50 and
 * finance-agent 7/7 turns routed restricted, against 0/45 for platform-engineer.
 * Those coworkers had never once reached a cloud provider, and since only
 * `local` and `speaches` carry restricted clearance — and `speaches` offers no
 * toolUse — their candidate pool was one endpoint with no fallback. One held
 * lease and the turn was a dead end (BI-A89E4827).
 *
 * This is the same category of evidence the tool-declaration exemption already
 * recognises in collectTextProbes: a static schema field named `payment` is not
 * a payment. The rule stated at the top of CLASS_RULES — "text probes must
 * contain value-shaped evidence, not merely governance or instructional
 * vocabulary that happens to name a protected data class" — simply was not being
 * applied to the largest block of instructional vocabulary in the payload.
 *
 * WHY SPANS RATHER THAN EXEMPTING THE PROMPT. The assembled prompt is a mix.
 * `finalDomainContext` alone concatenates the coworker persona, an authorized-
 * surface instruction, retrieved knowledge, and semantic memory into one string,
 * and text is appended after assembly in at least two more places. Exempting the
 * whole prompt would open a real egress path for every one of those. Naming the
 * instruction spans instead means anything unlabelled — including any future
 * append — is data, so the control fails closed by construction.
 *
 * WHY NOT DEMOTE INSTRUCTION MATCHES TO ambiguousVocabulary. That was the first
 * approach (`prompt-corroboration`, DI-BF2FEDA18D81) and it does not work. The
 * COO prompt produces three distinct restricted-class reasons on its own, so it
 * satisfies `distinctAmbiguousReasons >= 2` and escalates anyway. Worse, four
 * independent channels clamp a turn to local-only — sensitivity clearance, the
 * per-class export decision, the vertical policy packs, and a mask obligation
 * that clamps residencyPolicy — and only provenance at the source closes all
 * four. See docs/superpowers/plans/2026-08-23-prompt-provenance-in-inference-screening.md.
 */
const INSTRUCTION_PATH_PREFIX = "systemPrompt.instruction[";

function isInstructionProvenance(match: InferencePayloadMatch): boolean {
  return match.path.startsWith(INSTRUCTION_PATH_PREFIX);
}

/**
 * True when the DATA evidence is nothing but corroboration-gated vocabulary —
 * a domain was named and no value was found.
 *
 * The distinction matters at the routing seam. A mask obligation exists to
 * redact something before it leaves the boundary; when the only evidence is the
 * word "payroll", there is no span to redact, so masking is a no-op and
 * clamping the turn to local-only protects nothing while making the coworker
 * unreachable for its own subject (BI-67CAF494).
 *
 * Deliberately strict: ONE precise match, or any declared governed hint, and
 * this is false. It answers "is there anything here to mask?", not "is this
 * probably fine?".
 */
export function isVocabularyOnlyEvidence(
  matches: readonly InferencePayloadMatch[],
  governedData?: readonly GovernedPayloadHint[],
): boolean {
  if (governedData && governedData.length > 0) return false;
  const dataMatches = matches.filter((match) => !isInstructionProvenance(match));
  if (dataMatches.length === 0) return false;
  return dataMatches.every((match) => AMBIGUOUS_REASONS.has(match.reason));
}

/**
 * Split the prompt into instruction spans and the data remainder.
 *
 * Spans are matched literally and every occurrence is removed, so a block that
 * appears twice cannot leave one copy classified as data. A span the caller
 * names but that is not present is ignored rather than treated as an error —
 * assembly may legitimately drop a block under a token budget.
 */
function splitPromptByProvenance(
  systemPrompt: string,
  instructionSpans: readonly string[] | undefined,
): { instruction: string[]; data: string } {
  const spans = (instructionSpans ?? [])
    .map((span) => span.trim())
    .filter((span) => span.length > 0);
  if (spans.length === 0) return { instruction: [], data: systemPrompt };

  const present: string[] = [];
  let remainder = systemPrompt;
  // Longest first: a short span that is a substring of a longer one must not
  // carve a hole out of the middle of the longer span before it is matched.
  for (const span of [...spans].sort((a, b) => b.length - a.length)) {
    if (!remainder.includes(span)) continue;
    present.push(span);
    remainder = remainder.split(span).join("\n");
  }
  return { instruction: present, data: remainder };
}

/**
 * Does the turn's DATA carry restricted-class evidence strong enough to act on?
 *
 * The bar itself is unchanged (see the essay above `INSTRUCTION_PATH_PREFIX`):
 * a caller-declared restricted hint, any precise match, or two distinct
 * ambiguous detectors agreeing. What changed is who asks. Both the sensitivity
 * verdict and the data-evidenced class set now call this one predicate, so a
 * lone ambiguous word can no longer clear one and fail the other.
 */
function restrictedEvidenceIsCorroborated(
  dataMatches: readonly InferencePayloadMatch[],
  governedData: readonly GovernedPayloadHint[] | undefined,
): boolean {
  if (governedData?.some((hint) => hint.sensitivity === "restricted")) return true;
  const restrictedMatches = dataMatches.filter((match) =>
    RESTRICTED_CLASSES.has(match.dataClass)
  );
  if (restrictedMatches.some((match) => !AMBIGUOUS_REASONS.has(match.reason))) return true;
  // One word echoed across many probes is one signal: count distinct reasons.
  return new Set(restrictedMatches.map((match) => match.reason)).size >= 2;
}

function inferOverallSensitivity(
  matches: readonly InferencePayloadMatch[],
  governedData: readonly GovernedPayloadHint[] | undefined,
): InferencePayloadSensitivity {
  if (governedData?.some((hint) => hint.sensitivity === "restricted")) {
    return "restricted";
  }

  // Sensitivity rests on the turn's DATA only. Instruction-provenance matches
  // stay in `matches` and `dataClasses` so the receipt reports everything
  // detected, but they set no floor at all: a job description naming payroll is
  // not evidence that payroll data is present, and holding it at `confidential`
  // still summoned the PDP, which attached a mask obligation, which clamped
  // residencyPolicy to local_only — the fourth of four channels, and the one
  // that survived every narrower fix (BI-463BE12A).
  //
  // This is only safe BECAUSE provenance is declared at the source rather than
  // inferred: anything the caller does not name as instruction — including an
  // injected briefing or PAGE DATA block inside the prompt — is classified as
  // data and escalates exactly as a message would.
  const dataMatches = matches.filter((match) => !isInstructionProvenance(match));
  const restrictedMatches = dataMatches.filter((match) => RESTRICTED_CLASSES.has(match.dataClass));
  if (restrictedEvidenceIsCorroborated(dataMatches, governedData)) {
    return "restricted";
  }

  const dataClasses = dataMatches.map((match) => match.dataClass);
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
