export type AgentFormAssistField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  helperText?: string;
  allowedValues?: string[];
  shareCurrentValue?: boolean;
};

export type AgentFormAssistContext = {
  formId: string;
  formName: string;
  fields: AgentFormAssistField[];
  values?: Record<string, unknown>;
};

export type AgentFormAssistClientAdapter = AgentFormAssistContext & {
  routeContext: string;
  getValues: () => Record<string, unknown>;
  applyFieldUpdates: (updates: Record<string, unknown>) => void;
};

type ExtractedAssist = {
  displayContent: string;
  fieldUpdates: Record<string, unknown> | null;
};

const activeAssistByRoute = new Map<string, AgentFormAssistClientAdapter>();

function sanitizeFieldUpdates(
  raw: unknown,
  fields: AgentFormAssistField[],
): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const allowed = new Set(fields.map((field) => field.key));
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (allowed.has(key)) {
      next[key] = value;
    }
  }

  return Object.keys(next).length > 0 ? next : null;
}

export function buildAgentFormAssistContext(
  adapter: AgentFormAssistClientAdapter,
): AgentFormAssistContext {
  const values = adapter.getValues();
  const safeValues: Record<string, unknown> = {};

  for (const field of adapter.fields) {
    if (field.shareCurrentValue !== false && field.key in values) {
      safeValues[field.key] = values[field.key];
    }
  }

  return {
    formId: adapter.formId,
    formName: adapter.formName,
    fields: adapter.fields,
    values: safeValues,
  };
}

export function buildFormAssistInstruction(context: AgentFormAssistContext): string {
  const fieldLines = context.fields.map((field) => {
    const currentValue = context.values && field.key in context.values
      ? ` Current value: ${String(context.values[field.key] ?? "")}.`
      : "";
    const allowedValues = field.allowedValues && field.allowedValues.length > 0
      ? ` Allowed values: ${field.allowedValues.join(", ")}.`
      : "";
    const helperText = field.helperText ? ` ${field.helperText}` : "";

    return `- ${field.key} (${field.type}) — ${field.label}.${allowedValues}${currentValue}${helperText}`.trim();
  });

  return [
    `A page form is available for optional assistance: ${context.formName}.`,
    "If the user asks you to help fill the form, provide your normal explanation and then append a fenced ```agent-form block.",
    "Inside that block, emit JSON shaped like {\"fieldUpdates\": {\"fieldKey\": value}}.",
    "Only include fields listed below. Never include submit actions or hidden fields.",
    ...fieldLines,
  ].join("\n");
}

export function extractFormAssistResult(
  content: string,
  context: AgentFormAssistContext,
): ExtractedAssist {
  const blockMatch = content.match(/```agent-form\s*([\s\S]*?)```/i);
  if (!blockMatch) {
    return {
      displayContent: content.trim(),
      fieldUpdates: null,
    };
  }

  const displayContent = content.replace(blockMatch[0], "").trim();
  try {
    const parsed = JSON.parse(blockMatch[1] ?? "{}") as { fieldUpdates?: unknown };
    return {
      displayContent,
      fieldUpdates: sanitizeFieldUpdates(parsed.fieldUpdates, context.fields),
    };
  } catch {
    return {
      displayContent,
      fieldUpdates: null,
    };
  }
}

export function registerActiveFormAssist(
  adapter: AgentFormAssistClientAdapter,
): () => void {
  activeAssistByRoute.set(adapter.routeContext, adapter);

  return () => {
    const current = activeAssistByRoute.get(adapter.routeContext);
    if (current?.formId === adapter.formId) {
      activeAssistByRoute.delete(adapter.routeContext);
    }
  };
}

export function getActiveFormAssist(routeContext: string): AgentFormAssistClientAdapter | null {
  return activeAssistByRoute.get(routeContext) ?? null;
}
