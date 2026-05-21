"use client"

export type VoiceTrainingStatusValue = "pending" | "training" | "ready" | "failed" | "revoked"

interface Props {
  status: VoiceTrainingStatusValue
  qualityScore?: number
  errorMessage?: string
}

const STATUS_LABELS: Record<VoiceTrainingStatusValue, string> = {
  pending: "Pending",
  training: "Training in progress",
  ready: "Ready",
  failed: "Failed",
  revoked: "Revoked",
}

const STATUS_COLORS: Record<VoiceTrainingStatusValue, string> = {
  pending: "text-muted-foreground",
  training: "text-blue-600",
  ready: "text-green-600",
  failed: "text-destructive",
  revoked: "text-muted-foreground",
}

export function VoiceTrainingStatus({ status, qualityScore, errorMessage }: Props) {
  const label = STATUS_LABELS[status] ?? status
  const colorClass = STATUS_COLORS[status] ?? "text-muted-foreground"

  return (
    <div className="flex flex-col gap-1 text-sm" data-testid="voice-training-status">
      <span className={`font-medium ${colorClass}`} data-status={status}>
        {label}
      </span>

      {status === "ready" && qualityScore !== undefined && (
        <span className="text-xs text-muted-foreground">
          Quality score: {Math.round(qualityScore * 100)}%
        </span>
      )}

      {status === "failed" && errorMessage && (
        <span className="text-xs text-destructive" role="alert">
          {errorMessage}
        </span>
      )}
    </div>
  )
}
