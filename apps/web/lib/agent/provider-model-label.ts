/**
 * Friendly provider/model label for the per-turn coworker chat attribution
 * badge (BI-1D0B5308).
 *
 * Pure, dependency-free, client-safe: maps a raw (providerId, modelId) pair to
 * a compact human label plus a full-fidelity title for the hover tooltip
 * (progressive disclosure — the operator UX-fit decision `always-compact-badge`
 * on the human_cognitive_load axis).
 *
 *   ("anthropic", "claude-opus-4-8")  -> { label: "Claude · Opus 4.8",  title: "anthropic / claude-opus-4-8" }
 *   ("local",     "qwen2.5-coder")    -> { label: "Local model",        title: "local / qwen2.5-coder" }
 *   ("openai",    "gpt-5-codex")      -> { label: "OpenAI · GPT-5 Codex",title: "openai / gpt-5-codex" }
 *   ("google",    "gemini-2.5-pro")   -> { label: "Gemini · 2.5 Pro",   title: "google / gemini-2.5-pro" }
 *
 * This is intentionally an *algorithmic* label rather than a lookup against the
 * heavy known-model catalog (apps/web/lib/routing/known-provider-models.ts):
 * that catalog is a server-side discovery fallback keyed on exact modelId and
 * does not cover arbitrary/local/newer ids. Deriving the label keeps the badge
 * meaningful for any id and keeps this module client-importable.
 */

export interface ProviderModelLabel {
  /** Compact, always-visible chip text, e.g. "Claude · Opus 4.8". */
  label: string;
  /** Full-fidelity hover text with the raw ids, e.g. "anthropic / claude-opus-4-8". */
  title: string;
}

/** Provider ids (or ModelProvider.name values) that mean "the bundled local model". */
const LOCAL_PROVIDER_HINTS = ["local", "bundled", "dmr", "ollama", "docker-model-runner"];

function titleCaseWord(w: string): string {
  if (!w) return w;
  // Preserve tokens that are already all-caps acronyms (e.g. "GPT").
  if (/^[A-Z0-9.]+$/.test(w)) return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}

/** Build the raw-id title (hover text) from whatever ids we have. */
function buildTitle(providerId: string | null | undefined, modelId: string | null | undefined): string {
  const p = (providerId ?? "").trim();
  const m = (modelId ?? "").trim();
  if (p && m) return `${p} / ${m}`;
  return m || p || "unknown model";
}

/** Normalize a provider id / display name to a lowercase family key. */
function providerKey(providerId: string | null | undefined): string {
  return (providerId ?? "").trim().toLowerCase();
}

function isLocalProvider(key: string, modelId: string | null | undefined): boolean {
  if (LOCAL_PROVIDER_HINTS.some((h) => key.includes(h))) return true;
  const m = (modelId ?? "").toLowerCase();
  return LOCAL_PROVIDER_HINTS.some((h) => m.startsWith(`${h}/`) || m.startsWith(`${h}:`));
}

/**
 * Turn a raw model id into a short, human model name.
 *   "claude-opus-4-8"     -> "Opus 4.8"
 *   "claude-3-5-sonnet"   -> "Sonnet 3.5"  (best-effort)
 *   "gpt-5-codex"         -> "GPT-5 Codex"
 *   "gemini-2.5-pro"      -> "2.5 Pro"      (provider prefix carries "Gemini")
 * Falls back to the raw id when no pattern matches.
 */
function shortModel(providerFamily: string, modelId: string): string {
  const raw = modelId.trim();
  if (!raw) return raw;

  // Anthropic Claude: pull the family word (opus/sonnet/haiku) + version digits.
  const claude = raw.match(/claude[-_]?(?:(\d+)[-_.](\d+)[-_]?)?(opus|sonnet|haiku)?[-_.]?(\d+)?[-_.]?(\d+)?/i);
  if (/claude/i.test(raw) && claude) {
    const family = claude[3] ? titleCaseWord(claude[3].toLowerCase()) : "Claude";
    // Version can appear before (claude-3-5-sonnet) or after (claude-opus-4-8) the family word.
    const major = claude[4] ?? claude[1];
    const minor = claude[5] ?? claude[2];
    const version = [major, minor].filter(Boolean).join(".");
    return version ? `${family} ${version}` : family;
  }

  // Gemini: "gemini-2.5-pro" -> "2.5 Pro" (the "Gemini" prefix comes from the provider label).
  const gemini = raw.match(/gemini[-_]?(.+)/i);
  if (gemini && providerFamily === "gemini") {
    return gemini[1]
      .split(/[-_.]/)
      .filter(Boolean)
      .map((seg) => (/^\d/.test(seg) ? seg : titleCaseWord(seg)))
      .join(" ")
      .replace(/(\d) (\d)/g, "$1.$2");
  }

  // Generic prettify: split on separators, title-case word segments, keep version segments.
  return raw
    .split(/[-_]/)
    .filter(Boolean)
    .map((seg) => {
      if (/^gpt$/i.test(seg)) return "GPT";
      if (/^glm$/i.test(seg)) return "GLM";
      if (/^\d/.test(seg)) return seg;
      return titleCaseWord(seg);
    })
    .join(" ")
    // Re-join adjacent bare digits ("5 1" -> "5.1") only when they read as a version.
    .replace(/\bGPT (\d)/g, "GPT-$1");
}

/**
 * Map a (providerId, modelId) pair to a friendly badge label + hover title.
 * `providerName` (optional) is the resolved ModelProvider.name — preferred as
 * the human provider label when present; otherwise the providerId is titled.
 */
export function providerModelLabel(
  providerId: string | null | undefined,
  modelId: string | null | undefined,
  providerName?: string | null,
): ProviderModelLabel {
  const title = buildTitle(providerId, modelId);
  const key = providerKey(providerId);
  const nameKey = providerKey(providerName);

  // Local / bundled model — a single honest label, no noisy raw id in the chip.
  if (isLocalProvider(key, modelId) || isLocalProvider(nameKey, modelId)) {
    return { label: "Local model", title };
  }

  const modelKey = (modelId ?? "").trim().toLowerCase();
  // Provider identity can come from the provider id, its display name, or — when
  // neither is present — be inferred from the model id itself (e.g. a bare
  // "gpt-5-codex" clearly implies OpenAI).
  const matches = (hint: string) =>
    key.includes(hint) || nameKey.includes(hint) || (!key && !nameKey && modelKey.includes(hint));

  // Resolve the human-facing provider label.
  let providerLabel: string;
  let family: string;
  if (matches("anthropic") || matches("claude")) {
    providerLabel = "Claude";
    family = "anthropic";
  } else if (matches("openai") || matches("chatgpt") || matches("gpt") || matches("codex")) {
    providerLabel = matches("chatgpt") ? "ChatGPT" : "OpenAI";
    family = "openai";
  } else if (matches("google") || matches("gemini")) {
    providerLabel = "Gemini";
    family = "gemini";
  } else if (matches("zai") || matches("z.ai") || matches("glm")) {
    providerLabel = "Z.ai";
    family = "zai";
  } else if (providerName && providerName.trim()) {
    providerLabel = providerName.trim();
    family = key || nameKey;
  } else if (key) {
    providerLabel = titleCaseWord(key);
    family = key;
  } else {
    providerLabel = "Model";
    family = "";
  }

  if (!modelId || !modelId.trim()) {
    return { label: providerLabel, title };
  }

  const model = shortModel(family, modelId);
  // Avoid "Gemini · Gemini 2.5 Pro" style stutter.
  const label =
    model && model.toLowerCase() !== providerLabel.toLowerCase()
      ? `${providerLabel} · ${model}`
      : providerLabel;
  return { label, title };
}
