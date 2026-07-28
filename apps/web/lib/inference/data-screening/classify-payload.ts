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
};

// Text probes must contain value-shaped evidence, not merely governance or
// instructional vocabulary that happens to name a protected data class.
const EMPLOYEE_RECORD_VALUE_PATTERN =
  /\b(?:salary|compensation|benefits?|performance review|disciplinary|manager-only|payroll)\b/i;

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
    pathPattern: /\b(?:employee|worker|salary|compensation|benefit|performance|discipline|manager|payroll)\b/i,
  },
  {
    dataClass: "employee-records",
    reason: "employee-record-text",
    confidence: "inferred",
    textPattern: EMPLOYEE_RECORD_VALUE_PATTERN,
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
    pathPattern: /\b(?:security[-_]?log|audit[-_]?log|incident|ip[-_]?address|siem|threat)\b/i,
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
  const overallSensitivity = inferOverallSensitivity(dataClasses, input.governedData);
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

function inferOverallSensitivity(
  dataClasses: readonly InferenceDataClass[],
  governedData: readonly GovernedPayloadHint[] | undefined,
): InferencePayloadSensitivity {
  if (governedData?.some((hint) => hint.sensitivity === "restricted")) {
    return "restricted";
  }
  if (dataClasses.some((dataClass) => RESTRICTED_CLASSES.has(dataClass))) {
    return "restricted";
  }
  if (
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
