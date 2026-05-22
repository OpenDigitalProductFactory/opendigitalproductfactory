"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { MAX_MESSAGE_LENGTH } from "@/lib/agent-coworker-types";
import {
  QUESTION_PACKET_EXPECTED_ARTIFACTS,
  type QuestionPacket,
  type QuestionPacketExpectedArtifact,
} from "@/lib/tak/question-packet";
import { AgentFileUpload } from "./AgentFileUpload";
import { MicButton } from "./MicButton";
import { useVoiceCapture } from "./hooks/useVoiceCapture";

type PendingFile = {
  attachmentId: string;
  fileName: string;
  parsedContent: unknown;
};

type Props = {
  onSend: (content: string, options?: { questionPacket?: QuestionPacket | null }) => void;
  disabled: boolean;
  busy?: boolean;
  threadId: string | null;
  pendingFile: PendingFile | null;
  onFileUploaded: (result: PendingFile) => void;
  onFileClear: () => void;
  /** Whether a ready voice profile is available for synthesis. */
  voiceSynthAvailable?: boolean;
  /** Current playback preference set by the user. */
  voicePlaybackEnabled?: boolean;
  /** Toggle handler — flips voicePlaybackEnabled and persists to localStorage. */
  onVoicePlaybackToggle?: () => void;
};

const EMPTY_EXPECTED_ARTIFACT = "";
type ExpectedArtifactValue = QuestionPacketExpectedArtifact | typeof EMPTY_EXPECTED_ARTIFACT;

// ── Question-packet chip kinds ───────────────────────────────────────────
// "intent" is single-value (only one Intent chip can exist); "source" and
// "edge" are multi-value (each chip is one entry); "artifact" is single-value
// from a fixed enum and edited via the popover, not an inline text editor.
type ChipFieldKind = "intent" | "source" | "edge";

type PendingEntry = {
  kind: ChipFieldKind;
  draft: string;
  /** When set, we are editing an existing chip at this index (source/edge only). */
  editingIndex?: number;
};

const CHIP_ICONS: Record<ChipFieldKind | "artifact", string> = {
  intent: "\u{1F3AF}", // 🎯
  source: "\u{1F4CD}", // 📍
  edge: "\u{1F6AB}", // 🚫
  artifact: "\u{1F4E6}", // 📦
};

const CHIP_LABELS: Record<ChipFieldKind | "artifact", string> = {
  intent: "Intent",
  source: "Source",
  edge: "Scope edge",
  artifact: "Output shape",
};

const FIELD_HINTS: Record<ChipFieldKind, string> = {
  intent: "Tell the coworker what you're really trying to figure out",
  source: "Point at a file, route, spec, or record to ground on",
  edge: "A hard line the coworker shouldn't cross",
};

function truncate(value: string, max = 32): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

export function AgentMessageInput({ onSend, disabled, busy, threadId, pendingFile, onFileUploaded, onFileClear, voiceSynthAvailable, voicePlaybackEnabled, onVoicePlaybackToggle }: Props) {
  const [value, setValue] = useState("");
  const [intentCenter, setIntentCenter] = useState("");
  const [sources, setSources] = useState<string[]>([]);
  const [hardEdges, setHardEdges] = useState<string[]>([]);
  const [expectedArtifact, setExpectedArtifact] = useState<ExpectedArtifactValue>(EMPTY_EXPECTED_ARTIFACT);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingEntry, setPendingEntry] = useState<PendingEntry | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popoverContainerRef = useRef<HTMLDivElement>(null);
  const pendingInputRef = useRef<HTMLInputElement>(null);

  // ── Voice input wiring (Slice 1 Task 10) ─────────────────────────────────
  // Splices the transcript into the textarea at the current cursor position
  // so users can review + edit before sending. We do NOT auto-send — the
  // transcript is treated like text the user typed.
  const insertTranscriptAtCursor = useCallback((text: string) => {
    if (!text) return;
    const el = textareaRef.current;
    setValue((current) => {
      const trimmed = text.trim();
      if (!el) return current ? `${current} ${trimmed}` : trimmed;
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const before = current.slice(0, start);
      const after = current.slice(end);
      const sep = before && !before.endsWith(" ") ? " " : "";
      return `${before}${sep}${trimmed}${after}`;
    });
    // Refocus so the user can press Enter to send or edit further.
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  const voice = useVoiceCapture({
    threadId,
    onTranscript: insertTranscriptAtCursor,
    context: "coworker_panel",
  });

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  // Auto-focus the inline editor when a pending entry is opened so the user
  // can type immediately without an extra click.
  useEffect(() => {
    if (pendingEntry) {
      pendingInputRef.current?.focus();
    }
  }, [pendingEntry]);

  // Close the popover when clicking outside it.
  useEffect(() => {
    if (!popoverOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      const container = popoverContainerRef.current;
      if (container && !container.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [popoverOpen]);

  function handleSubmit() {
    const trimmed = value.trim();
    if (!trimmed || disabled || busy) return;
    if (trimmed.length > MAX_MESSAGE_LENGTH) return;
    const questionPacket = buildQuestionPacket();
    if (questionPacket) {
      onSend(trimmed, { questionPacket });
    } else {
      onSend(trimmed);
    }
    setValue("");
    setIntentCenter("");
    setSources([]);
    setHardEdges([]);
    setExpectedArtifact(EMPTY_EXPECTED_ARTIFACT);
    setPendingEntry(null);
    setPopoverOpen(false);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
      return;
    }
    // Spacebar push-to-talk per spec §10 Q1: only when textarea is empty +
    // focused. Otherwise spacebar inserts a space normally.
    if (e.key === " " && value.length === 0 && voice.state === "idle" && voice.supported) {
      e.preventDefault();
      void voice.start();
      return;
    }
    // Escape cancels in-flight dictation per spec §5.1 ("hit Esc to stop").
    if (e.key === "Escape" && voice.state === "recording") {
      e.preventDefault();
      voice.stop();
      return;
    }
  }

  function buildQuestionPacket(): QuestionPacket | null {
    const packet: QuestionPacket = {};
    const trimmedIntent = intentCenter.trim();
    const trimmedSources = sources.map((s) => s.trim()).filter(Boolean);
    const trimmedEdges = hardEdges.map((e) => e.trim()).filter(Boolean);

    if (trimmedIntent) {
      packet.intentCenter = trimmedIntent;
    }
    if (trimmedSources.length > 0) {
      packet.contextRefs = trimmedSources.map((ref, index) => ({
        kind: "freeform",
        label: `Source ${index + 1}`,
        ref,
      }));
    }
    if (trimmedEdges.length > 0) {
      packet.hardEdges = trimmedEdges;
    }
    if (expectedArtifact) {
      packet.expectedArtifact = expectedArtifact;
    }

    return Object.keys(packet).length > 0 ? packet : null;
  }

  // ── Chip editing helpers ──────────────────────────────────────────────────

  function togglePopover() {
    setPendingEntry(null);
    setPopoverOpen((current) => !current);
  }

  function startEntry(kind: ChipFieldKind, prefill = "", editingIndex?: number) {
    setPopoverOpen(false);
    setPendingEntry({ kind, draft: prefill, editingIndex });
  }

  function commitEntry() {
    if (!pendingEntry) return;
    const draft = pendingEntry.draft.trim();
    if (!draft) {
      setPendingEntry(null);
      return;
    }
    if (pendingEntry.kind === "intent") {
      setIntentCenter(draft);
    } else if (pendingEntry.kind === "source") {
      setSources((current) => {
        if (pendingEntry.editingIndex !== undefined) {
          return current.map((item, i) => (i === pendingEntry.editingIndex ? draft : item));
        }
        return [...current, draft];
      });
    } else if (pendingEntry.kind === "edge") {
      setHardEdges((current) => {
        if (pendingEntry.editingIndex !== undefined) {
          return current.map((item, i) => (i === pendingEntry.editingIndex ? draft : item));
        }
        return [...current, draft];
      });
    }
    setPendingEntry(null);
  }

  function cancelEntry() {
    setPendingEntry(null);
  }

  function removeSource(index: number) {
    setSources((current) => current.filter((_, i) => i !== index));
  }

  function removeEdge(index: number) {
    setHardEdges((current) => current.filter((_, i) => i !== index));
  }

  function toggleArtifact(next: QuestionPacketExpectedArtifact) {
    setExpectedArtifact((current) => (current === next ? EMPTY_EXPECTED_ARTIFACT : next));
  }

  const overLimit = value.trim().length > MAX_MESSAGE_LENGTH;
  const hasAnyChip =
    !!pendingFile ||
    !!intentCenter ||
    sources.length > 0 ||
    hardEdges.length > 0 ||
    !!expectedArtifact;

  // ── Render helpers ────────────────────────────────────────────────────────

  function renderChip(opts: {
    icon: string;
    label: string;
    value: string;
    onEdit?: () => void;
    onRemove: () => void;
    title?: string;
  }) {
    return (
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          background: "var(--dpf-surface-2)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 12,
          padding: "2px 8px 2px 6px",
          fontSize: 11,
          color: "var(--dpf-text)",
          maxWidth: "100%",
        }}
        title={opts.title ?? `${opts.label}: ${opts.value}`}
      >
        <span style={{ fontSize: 12 }}>{opts.icon}</span>
        {opts.onEdit ? (
          <button
            type="button"
            onClick={opts.onEdit}
            style={{
              background: "none",
              border: "none",
              color: "var(--dpf-text)",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 220,
              textAlign: "left",
            }}
          >
            <span style={{ color: "var(--dpf-muted)" }}>{opts.label}:</span>{" "}
            {truncate(opts.value)}
          </button>
        ) : (
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 220,
            }}
          >
            <span style={{ color: "var(--dpf-muted)" }}>{opts.label}:</span>{" "}
            {truncate(opts.value)}
          </span>
        )}
        <button
          type="button"
          onClick={opts.onRemove}
          style={{
            background: "none",
            border: "none",
            color: "var(--dpf-muted)",
            cursor: "pointer",
            fontSize: 13,
            lineHeight: 1,
            padding: "0 2px",
            marginLeft: 2,
          }}
          title={`Remove ${opts.label.toLowerCase()}`}
          aria-label={`Remove ${opts.label.toLowerCase()}`}
        >
          &times;
        </button>
      </span>
    );
  }

  function renderPendingEntryRow() {
    if (!pendingEntry) return null;
    const hint = FIELD_HINTS[pendingEntry.kind];
    const icon = CHIP_ICONS[pendingEntry.kind];
    const label = CHIP_LABELS[pendingEntry.kind];
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 12px 0",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 12 }}>{icon}</span>
        <span style={{ fontSize: 11, color: "var(--dpf-muted)", flexShrink: 0 }}>{label}:</span>
        <input
          ref={pendingInputRef}
          aria-label={label}
          value={pendingEntry.draft}
          placeholder={hint}
          onChange={(e) =>
            setPendingEntry((current) =>
              current ? { ...current, draft: e.target.value } : current,
            )
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitEntry();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelEntry();
            }
          }}
          style={{
            flex: "1 1 160px",
            minWidth: 0,
            background: "var(--dpf-surface-1)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            color: "var(--dpf-text)",
            fontSize: 12,
            minHeight: 28,
            padding: "4px 8px",
          }}
        />
        <button
          type="button"
          onClick={commitEntry}
          style={{
            background: "var(--dpf-surface-2)",
            border: "1px solid var(--dpf-border)",
            borderRadius: 6,
            color: "var(--dpf-text)",
            cursor: "pointer",
            fontSize: 11,
            padding: "4px 8px",
          }}
        >
          Save
        </button>
        <button
          type="button"
          onClick={cancelEntry}
          style={{
            background: "none",
            border: "none",
            color: "var(--dpf-muted)",
            cursor: "pointer",
            fontSize: 11,
            padding: "4px 6px",
          }}
        >
          Cancel
        </button>
      </div>
    );
  }

  function renderChipTray() {
    if (!hasAnyChip) return null;
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          padding: "6px 12px 0",
        }}
      >
        {pendingFile &&
          renderChip({
            icon: "\u{1F4CE}",
            label: "File",
            value: pendingFile.fileName,
            onRemove: onFileClear,
            title: pendingFile.fileName,
          })}
        {intentCenter &&
          renderChip({
            icon: CHIP_ICONS.intent,
            label: CHIP_LABELS.intent,
            value: intentCenter,
            onEdit: () => startEntry("intent", intentCenter),
            onRemove: () => setIntentCenter(""),
          })}
        {sources.map((src, i) => (
          <span key={`src-${i}`}>
            {renderChip({
              icon: CHIP_ICONS.source,
              label: CHIP_LABELS.source,
              value: src,
              onEdit: () => startEntry("source", src, i),
              onRemove: () => removeSource(i),
            })}
          </span>
        ))}
        {hardEdges.map((edge, i) => (
          <span key={`edge-${i}`}>
            {renderChip({
              icon: CHIP_ICONS.edge,
              label: CHIP_LABELS.edge,
              value: edge,
              onEdit: () => startEntry("edge", edge, i),
              onRemove: () => removeEdge(i),
            })}
          </span>
        ))}
        {expectedArtifact &&
          renderChip({
            icon: CHIP_ICONS.artifact,
            label: CHIP_LABELS.artifact,
            value: expectedArtifact.replace(/-/g, " "),
            onRemove: () => setExpectedArtifact(EMPTY_EXPECTED_ARTIFACT),
          })}
      </div>
    );
  }

  function renderContextPopover() {
    if (!popoverOpen) return null;
    return (
      <div
        role="menu"
        aria-label="Add context"
        style={{
          position: "absolute",
          bottom: "calc(100% + 6px)",
          left: 0,
          minWidth: 260,
          background: "var(--dpf-surface-1)",
          border: "1px solid var(--dpf-border)",
          borderRadius: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          padding: 6,
          display: "flex",
          flexDirection: "column",
          gap: 2,
          zIndex: 20,
        }}
      >
        <PopoverItem
          icon={CHIP_ICONS.intent}
          label={intentCenter ? "Edit intent" : "Set intent…"}
          hint={FIELD_HINTS.intent}
          onClick={() => startEntry("intent", intentCenter)}
        />
        <PopoverItem
          icon={CHIP_ICONS.source}
          label="Add source ref…"
          hint={FIELD_HINTS.source}
          onClick={() => startEntry("source")}
        />
        <PopoverItem
          icon={CHIP_ICONS.edge}
          label="Add scope edge…"
          hint={FIELD_HINTS.edge}
          onClick={() => startEntry("edge")}
        />
        <div
          style={{
            borderTop: "1px solid var(--dpf-border)",
            marginTop: 4,
            paddingTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 6px",
              fontSize: 11,
              color: "var(--dpf-muted)",
            }}
          >
            <span style={{ fontSize: 12 }}>{CHIP_ICONS.artifact}</span>
            Output shape
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 4,
              padding: "0 6px 4px",
            }}
          >
            {QUESTION_PACKET_EXPECTED_ARTIFACTS.map((artifact) => {
              const selected = expectedArtifact === artifact;
              return (
                <button
                  type="button"
                  key={artifact}
                  onClick={() => toggleArtifact(artifact)}
                  aria-pressed={selected}
                  style={{
                    background: selected ? "var(--dpf-accent)" : "var(--dpf-surface-2)",
                    border: `1px solid ${selected ? "var(--dpf-accent)" : "var(--dpf-border)"}`,
                    borderRadius: 999,
                    color: selected ? "#ffffff" : "var(--dpf-text)",
                    cursor: "pointer",
                    fontSize: 11,
                    padding: "2px 8px",
                  }}
                >
                  {artifact.replace(/-/g, " ")}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ borderTop: "1px solid var(--dpf-border)" }}>
      {/*
        Voice Slice 2 follow-up: surface voice errors INLINE, not just in the
        button tooltip. Operators were clicking the mic, getting silent
        failures (red ring on a small button), and concluding "nothing
        happened". The error banner shows the failure reason + the next
        actionable step in plain language.
      */}
      {voice.state === "error" && voice.error && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            padding: "6px 12px",
            background: "rgba(211, 51, 51, 0.08)",
            borderBottom: "1px solid rgba(211, 51, 51, 0.25)",
            fontSize: 11,
            color: "var(--dpf-text)",
          }}
        >
          <span style={{ color: "var(--dpf-error, #d33)", fontWeight: 600 }}>
            Voice input failed
          </span>
          <span style={{ flex: 1, color: "var(--dpf-muted)" }}>
            {voice.error}
          </span>
          <button
            type="button"
            onClick={voice.reset}
            style={{
              background: "none",
              border: "none",
              color: "var(--dpf-accent)",
              cursor: "pointer",
              fontSize: 11,
              padding: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {renderChipTray()}
      {renderPendingEntryRow()}
      <div style={{
        display: "flex",
        gap: 6,
        padding: "10px 12px",
        alignItems: "flex-end",
        flexWrap: "wrap",
      }}>
        <div ref={popoverContainerRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button"
            onClick={togglePopover}
            aria-expanded={popoverOpen}
            aria-haspopup="menu"
            aria-label="Add context"
            title="Add context (intent, sources, scope edges, output shape)"
            disabled={disabled || !!busy}
            style={{
              background: "var(--dpf-surface-2)",
              border: "1px solid var(--dpf-border)",
              borderRadius: 6,
              color: "var(--dpf-text)",
              cursor: disabled || busy ? "not-allowed" : "pointer",
              fontSize: 18,
              lineHeight: 1,
              height: 32,
              width: 32,
              opacity: disabled || busy ? 0.5 : 1,
              padding: 0,
            }}
          >
            +
          </button>
          {renderContextPopover()}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder={disabled ? "Sending..." : busy ? "Agent is working... type your next message" : "Ask your co-worker..."}
          rows={1}
          style={{
            flex: "1 1 180px",
            minWidth: 0,
            background: "color-mix(in srgb, var(--dpf-bg) 80%, transparent)",
            border: `1px solid ${overLimit ? "var(--dpf-error)" : "var(--dpf-border)"}`,
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 12,
            color: "var(--dpf-text)",
            outline: "none",
            resize: "none",
            overflow: "auto",
            lineHeight: "1.4",
            minHeight: 32,
            maxHeight: 160,
          }}
        />
        {overLimit && (
          <span style={{ fontSize: 10, color: "var(--dpf-error)", flexShrink: 0, alignSelf: "center" }}>
            {value.trim().length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}
          </span>
        )}
        <MicButton
          state={voice.state}
          errorMessage={voice.error}
          errorCode={voice.errorCode}
          supported={voice.supported}
          onStart={() => void voice.start()}
          onStop={voice.stop}
          onReset={voice.reset}
          disabled={disabled || !!busy}
        />
        {voiceSynthAvailable && onVoicePlaybackToggle && (
          <button
            type="button"
            onClick={onVoicePlaybackToggle}
            title={voicePlaybackEnabled ? "Mute voice playback" : "Unmute voice playback"}
            aria-label={voicePlaybackEnabled ? "Mute voice playback" : "Unmute voice playback"}
            aria-pressed={voicePlaybackEnabled}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: voicePlaybackEnabled ? "var(--dpf-accent)" : "var(--dpf-muted)",
              fontSize: 16,
              lineHeight: 1,
              padding: "0 2px",
              flexShrink: 0,
              height: 32,
              display: "flex",
              alignItems: "center",
              opacity: voicePlaybackEnabled ? 1 : 0.5,
              transition: "color 0.15s, opacity 0.15s",
            }}
          >
            {voicePlaybackEnabled ? "🔊" : "🔇"}
          </button>
        )}
        <AgentFileUpload
          threadId={threadId}
          disabled={disabled || !!busy}
          onUploaded={onFileUploaded}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={disabled || busy || !value.trim() || overLimit}
          title={busy ? "Agent is still working" : undefined}
          style={{
            background: "var(--dpf-accent)",
            border: "none",
            borderRadius: 6,
            padding: "6px 12px",
            fontSize: 12,
            color: "#ffffff",
            cursor: disabled || busy || !value.trim() || overLimit ? "not-allowed" : "pointer",
            opacity: disabled || busy || !value.trim() || overLimit ? 0.5 : 1,
            flexShrink: 0,
            height: 32,
          }}
        >
          Send
        </button>
      </div>
    </div>
  );
}

function PopoverItem({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: string;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      title={hint}
      style={{
        background: "none",
        border: "none",
        color: "var(--dpf-text)",
        cursor: "pointer",
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 8,
        rowGap: 0,
        alignItems: "center",
        textAlign: "left",
        padding: "6px 8px",
        borderRadius: 6,
        fontSize: 12,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--dpf-surface-2)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "none";
      }}
    >
      <span style={{ fontSize: 14, gridRow: "1 / span 2" }}>{icon}</span>
      <span>{label}</span>
      <span style={{ fontSize: 10, color: "var(--dpf-muted)" }}>{hint}</span>
    </button>
  );
}
