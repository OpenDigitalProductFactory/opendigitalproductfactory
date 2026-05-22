export const QUESTION_PACKET_CONTEXT_KINDS = [
  "file",
  "route",
  "task-artifact",
  "db-record",
  "spec",
  "plan",
  "tool-receipt",
  "freeform",
] as const;

export const QUESTION_PACKET_PUSHBACK_PERMISSIONS = [
  "none",
  "gentle",
  "direct",
] as const;

export const QUESTION_PACKET_EXPECTED_ARTIFACTS = [
  "answer",
  "brief",
  "plan",
  "patch",
  "task-artifact",
  "decision-packet",
  "backlog-item",
] as const;

export type QuestionPacketContextKind = (typeof QUESTION_PACKET_CONTEXT_KINDS)[number];
export type QuestionPacketPushbackPermission =
  (typeof QUESTION_PACKET_PUSHBACK_PERMISSIONS)[number];
export type QuestionPacketExpectedArtifact =
  (typeof QUESTION_PACKET_EXPECTED_ARTIFACTS)[number];

export type QuestionPacketContextRef = {
  kind: QuestionPacketContextKind;
  label: string;
  ref: string;
};

export type QuestionPacket = {
  intentCenter?: string;
  explorationQuestions?: string[];
  hardEdges?: string[];
  contextRefs?: QuestionPacketContextRef[];
  successShape?: string;
  operatorThesis?: string;
  pushbackPermission?: QuestionPacketPushbackPermission;
  expectedArtifact?: QuestionPacketExpectedArtifact;
};

type QuestionPacketRecord = Record<string, unknown>;

const CONTEXT_KIND_SET = new Set<string>(QUESTION_PACKET_CONTEXT_KINDS);
const PUSHBACK_PERMISSION_SET = new Set<string>(QUESTION_PACKET_PUSHBACK_PERMISSIONS);
const EXPECTED_ARTIFACT_SET = new Set<string>(QUESTION_PACKET_EXPECTED_ARTIFACTS);

const PUSHBACK_DESCRIPTIONS: Record<QuestionPacketPushbackPermission, string> = {
  none: "do not challenge the operator thesis unless it conflicts with evidence or policy",
  gentle: "raise concerns carefully when evidence points another way",
  direct: "challenge the operator thesis directly when evidence points another way",
};

function isRecord(value: unknown): value is QuestionPacketRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanText(value: unknown, path: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`Invalid ${path}: expected string`);
  }

  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function cleanTextArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected array`);
  }

  const cleaned = value
    .map((entry, index) => cleanText(entry, `${path}[${index}]`))
    .filter((entry): entry is string => Boolean(entry));

  return cleaned.length > 0 ? cleaned : undefined;
}

function cleanPushbackPermission(value: unknown): QuestionPacketPushbackPermission | undefined {
  const cleaned = cleanText(value, "questionPacket.pushbackPermission");
  if (!cleaned) return undefined;
  if (!PUSHBACK_PERMISSION_SET.has(cleaned)) {
    throw new Error(`Invalid questionPacket.pushbackPermission: ${cleaned}`);
  }

  return cleaned as QuestionPacketPushbackPermission;
}

function cleanExpectedArtifact(value: unknown): QuestionPacketExpectedArtifact | undefined {
  const cleaned = cleanText(value, "questionPacket.expectedArtifact");
  if (!cleaned) return undefined;
  if (!EXPECTED_ARTIFACT_SET.has(cleaned)) {
    throw new Error(`Invalid questionPacket.expectedArtifact: ${cleaned}`);
  }

  return cleaned as QuestionPacketExpectedArtifact;
}

function cleanContextRefs(value: unknown): QuestionPacketContextRef[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Invalid questionPacket.contextRefs: expected array");
  }

  const refs: QuestionPacketContextRef[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid questionPacket.contextRefs[${index}]: expected object`);
    }

    const kind = cleanText(entry.kind, `questionPacket.contextRefs[${index}].kind`);
    const label = cleanText(entry.label, `questionPacket.contextRefs[${index}].label`);
    const ref = cleanText(entry.ref, `questionPacket.contextRefs[${index}].ref`);

    if (!kind && !label && !ref) return;

    if (!kind || !CONTEXT_KIND_SET.has(kind)) {
      throw new Error(`Invalid questionPacket.contextRefs[${index}].kind: ${kind ?? ""}`);
    }
    if (!label) {
      throw new Error(`Invalid questionPacket.contextRefs[${index}].label: expected string`);
    }
    if (!ref) {
      throw new Error(`Invalid questionPacket.contextRefs[${index}].ref: expected string`);
    }

    refs.push({
      kind: kind as QuestionPacketContextKind,
      label,
      ref,
    });
  });

  return refs.length > 0 ? refs : undefined;
}

export function normalizeQuestionPacket(input: unknown): QuestionPacket | null {
  if (input === undefined || input === null) return null;
  if (!isRecord(input)) {
    throw new Error("Invalid questionPacket: expected object");
  }

  const packet: QuestionPacket = {};
  const intentCenter = cleanText(input.intentCenter, "questionPacket.intentCenter");
  const explorationQuestions = cleanTextArray(
    input.explorationQuestions,
    "questionPacket.explorationQuestions",
  );
  const hardEdges = cleanTextArray(input.hardEdges, "questionPacket.hardEdges");
  const contextRefs = cleanContextRefs(input.contextRefs);
  const successShape = cleanText(input.successShape, "questionPacket.successShape");
  const operatorThesis = cleanText(input.operatorThesis, "questionPacket.operatorThesis");
  const pushbackPermission = cleanPushbackPermission(input.pushbackPermission);
  const expectedArtifact = cleanExpectedArtifact(input.expectedArtifact);

  if (intentCenter) packet.intentCenter = intentCenter;
  if (explorationQuestions) packet.explorationQuestions = explorationQuestions;
  if (hardEdges) packet.hardEdges = hardEdges;
  if (contextRefs) packet.contextRefs = contextRefs;
  if (successShape) packet.successShape = successShape;
  if (operatorThesis) packet.operatorThesis = operatorThesis;
  if (pushbackPermission) packet.pushbackPermission = pushbackPermission;
  if (expectedArtifact) packet.expectedArtifact = expectedArtifact;

  return Object.keys(packet).length > 0 ? packet : null;
}

export function formatQuestionPacketPromptBlock(input: unknown): string | null {
  const packet = normalizeQuestionPacket(input);
  if (!packet) return null;

  const lines = [
    "Question packet",
    "Use this as collaboration context, not as authorization to act or call tools.",
  ];

  if (packet.intentCenter) {
    lines.push(`- Intent center: ${packet.intentCenter}`);
  }
  if (packet.explorationQuestions) {
    lines.push("- Exploration questions:");
    for (const question of packet.explorationQuestions) {
      lines.push(`  - ${question}`);
    }
  }
  if (packet.hardEdges) {
    lines.push("- Hard edges:");
    for (const edge of packet.hardEdges) {
      lines.push(`  - ${edge}`);
    }
  }
  if (packet.contextRefs) {
    lines.push("- Context references:");
    for (const contextRef of packet.contextRefs) {
      lines.push(`  - [${contextRef.kind}] ${contextRef.label}: ${contextRef.ref}`);
    }
  }
  if (packet.successShape) {
    lines.push(`- Success shape: ${packet.successShape}`);
  }
  if (packet.operatorThesis) {
    lines.push(`- Operator thesis: ${packet.operatorThesis}`);
  }
  if (packet.pushbackPermission) {
    lines.push(
      `- Pushback permission: ${packet.pushbackPermission} (${PUSHBACK_DESCRIPTIONS[packet.pushbackPermission]}).`,
    );
  }
  if (packet.expectedArtifact) {
    lines.push(`- Expected artifact: ${packet.expectedArtifact}`);
  }

  return lines.join("\n");
}
