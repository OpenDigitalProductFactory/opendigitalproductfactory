import {
  getWorkPatternBindingPresentation,
  type WorkPatternBindingRecord,
} from "@/lib/tak/work-pattern-binding-reader";
import { Chip } from "./panels";

export function WorkPatternBindingCard({
  binding,
  now,
}: {
  binding: WorkPatternBindingRecord;
  now?: Date;
}) {
  const presentation = getWorkPatternBindingPresentation(binding, now);
  const tone =
    binding.status === "active"
      ? "success"
      : binding.status === "rolled-back"
        ? "error"
        : "muted";
  return (
    <div
      aria-label={`Living Playbook ${binding.name}`}
      style={{
        display: "grid",
        gap: 7,
        padding: "9px 10px",
        borderRadius: 6,
        border: "1px solid var(--dpf-border)",
        background: "var(--dpf-surface-1)",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        <Chip tone={tone}>{presentation.stateLabel}</Chip>
        <Chip tone="accent">{presentation.scopeLabel}</Chip>
        <Chip tone="muted">{presentation.freshnessLabel}</Chip>
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--dpf-text)" }}>
        {binding.name}
      </div>
      <div style={{ fontSize: 11, color: "var(--dpf-muted)" }}>
        {presentation.evidenceLabel}. This method cannot add to the coworker&apos;s tool authority.
      </div>
      {presentation.blockerMessages.length > 0 ? (
        <details>
          <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--dpf-accent)" }}>
            What is needed for broader use
          </summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 11, color: "var(--dpf-muted)" }}>
            {presentation.blockerMessages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
