import { estimateMaxParameters } from "@/lib/ollama";

interface OllamaHardwareInfoProps {
  gpu: string;
  vramGb: number | null;
  modelCount: number;
}

export function OllamaHardwareInfo({ gpu, vramGb, modelCount }: OllamaHardwareInfoProps) {
  const maxParams = estimateMaxParameters(vramGb);
  const isGpu = gpu !== "CPU-only";

  return (
    <div style={{
      background: "var(--dpf-surface-1, #1a1a2e)",
      border: "1px solid var(--dpf-border, #2a2a40)",
      borderRadius: 6,
      padding: 12,
      marginBottom: 16,
    }}>
      <div style={{
        color: "var(--dpf-accent, #7c8cf8)",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        marginBottom: 8,
      }}>
        Hardware
      </div>
      <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div>
          <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Compute</div>
          <div style={{ color: "var(--dpf-text)", fontSize: 12, fontWeight: 600 }}>
            {isGpu ? `${gpu}${vramGb ? ` (${vramGb}GB VRAM)` : ""}` : "CPU-only"}
          </div>
        </div>
        {maxParams && (
          <div>
            <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Max Model Size (Q4)</div>
            <div style={{ color: "var(--dpf-text)", fontSize: 12, fontWeight: 600 }}>{maxParams} parameters</div>
          </div>
        )}
        <div>
          <div style={{ color: "var(--dpf-muted, #8888a0)", fontSize: 10 }}>Available Models</div>
          <div style={{ color: "var(--dpf-text)", fontSize: 12, fontWeight: 600 }}>{modelCount}</div>
        </div>
      </div>
    </div>
  );
}
