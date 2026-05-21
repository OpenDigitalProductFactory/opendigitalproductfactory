"use client"

import { useRef, useState } from "react"

interface Props {
  audioUrl?: string
  durationMs?: number
  voiceEnabled?: boolean
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function VoiceRationalePlayer({ audioUrl, durationMs, voiceEnabled = true }: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)

  if (!voiceEnabled) return null

  if (!audioUrl) {
    return (
      <div role="status" aria-label="Preparing audio" className="flex items-center gap-1.5 text-xs text-muted-foreground py-1">
        <span className="animate-pulse">●</span>
        <span>Preparing audio…</span>
      </div>
    )
  }

  const toggle = () => {
    const el = audioRef.current
    if (!el) return
    if (playing) { el.pause(); setPlaying(false) }
    else { el.play(); setPlaying(true) }
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <button
        onClick={toggle}
        aria-label={playing ? "Pause" : "Play"}
        className="rounded-full p-1 hover:bg-muted transition-colors"
      >
        {playing ? "⏸" : "▶"}
      </button>
      {durationMs !== undefined && (
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatDuration(durationMs)}
        </span>
      )}
      <audio
        ref={audioRef}
        src={audioUrl}
        onEnded={() => setPlaying(false)}
        preload="metadata"
      />
    </div>
  )
}
