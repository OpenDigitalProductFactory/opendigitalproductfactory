// apps/web/components/platform/ModelClassBadge.tsx

const MODEL_CLASS_CONFIG: Record<string, { label: string; emoji: string; color: string }> = {
  chat:       { label: "Chat",       emoji: "",   color: "" },
  reasoning:  { label: "Reasoning",  emoji: "🧠", color: "#a78bfa" },
  image_gen:  { label: "Image",      emoji: "🖼️", color: "#f97316" },
  embedding:  { label: "Embedding",  emoji: "📐", color: "#06b6d4" },
  audio:      { label: "Audio",      emoji: "🎤", color: "#ec4899" },
  speech:     { label: "Speech",     emoji: "🔊", color: "#8b5cf6" },
  video:      { label: "Video",      emoji: "🎬", color: "#ef4444" },
  moderation: { label: "Moderation", emoji: "🛡️", color: "#f59e0b" },
  realtime:   { label: "Realtime",   emoji: "⚡", color: "#10b981" },
  code:       { label: "Code",       emoji: "💻", color: "#6366f1" },
};

export function getModelClassConfig(modelClass: string) {
  return MODEL_CLASS_CONFIG[modelClass] ?? { label: modelClass, emoji: "", color: "var(--dpf-muted)" };
}

export function ModelClassBadge({ modelClass }: { modelClass: string }) {
  if (modelClass === "chat") return null;
  const cfg = getModelClassConfig(modelClass);
  if (!cfg.color) return null;
  return (
    <span
      title={`Model class: ${modelClass}`}
      style={{
        fontSize: 9,
        fontWeight: 700,
        color: cfg.color,
        background: `${cfg.color}18`,
        padding: "1px 5px",
        borderRadius: 3,
        whiteSpace: "nowrap",
      }}
    >
      {cfg.emoji} {cfg.label}
    </span>
  );
}

/** Render a row of badges for an array of non-chat model classes. */
export function ModelClassBadges({ classes }: { classes: string[] }) {
  const filtered = classes.filter((c) => c !== "chat");
  if (filtered.length === 0) return null;
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {filtered.map((c) => (
        <ModelClassBadge key={c} modelClass={c} />
      ))}
    </span>
  );
}
