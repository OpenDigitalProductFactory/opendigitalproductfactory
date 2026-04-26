"use client";
import type { ArtifactView, Message, Step } from "./types";
import { Persona } from "./avatars/Persona";
import { UserMark } from "./avatars/UserMark";
import { ChoiceCard } from "./cards/ChoiceCard";
import { PlanSummaryCard } from "./cards/PlanSummaryCard";
import { FilesTouchedCard } from "./cards/FilesTouchedCard";
import { VerificationStripCard } from "./cards/VerificationStripCard";
import { DecisionCard } from "./cards/DecisionCard";
import { StepRefCard } from "./cards/StepRefCard";
import { DEMO_FILES_TOUCHED, DEMO_STORY_STEPS } from "@/lib/build-studio-demo";

interface Props {
  msg: Message;
  steps: Step[];
  onOpenArtifact: (v: ArtifactView) => void;
  userName?: string;
}

export function Bubble({ msg, steps, onOpenArtifact, userName = "Maya" }: Props) {
  const isUser = msg.role === "user";
  const displayName = isUser ? userName : "DPF";
  const caption = isUser ? null : "your build assistant";

  const rowClass = [
    "dpf-slide-up",
    "flex gap-3 px-[22px] py-3.5 transition-colors",
    msg.needsAction
      ? "bg-[color-mix(in_srgb,var(--dpf-warning)_5%,transparent)]"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={rowClass}
      data-needs-action={msg.needsAction ? "true" : undefined}
    >
      <div className="shrink-0">
        {isUser ? <UserMark name={userName} /> : <Persona />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-[var(--dpf-text)]">
            {displayName}
          </span>
          {caption && (
            <span className="text-[11.5px] text-[var(--dpf-muted)]">{caption}</span>
          )}
          <span className="text-[11.5px] text-[var(--dpf-muted)]">·</span>
          <span className="text-[11.5px] text-[var(--dpf-muted)]">{msg.time}</span>
        </div>
        <p className="m-0 text-[13.5px] text-[var(--dpf-text)] leading-snug whitespace-pre-wrap">
          {msg.text}
        </p>

        {msg.choices?.map((choice) => (
          <ChoiceCard key={choice.id} choice={choice} />
        ))}

        {msg.cards?.map((card, i) => {
          switch (card.kind) {
            case "step-ref":
              return card.refStep ? (
                <div key={i} className="mt-2">
                  <StepRefCard steps={steps} stepId={card.refStep} />
                </div>
              ) : null;
            case "plan-summary":
              return (
                <PlanSummaryCard key={i} onDrill={() => onOpenArtifact("schema")} />
              );
            case "files-touched":
              return (
                <FilesTouchedCard
                  key={i}
                  files={DEMO_FILES_TOUCHED}
                  onDrill={() => onOpenArtifact("diff")}
                />
              );
            case "verification-strip":
              return (
                <VerificationStripCard
                  key={i}
                  steps={DEMO_STORY_STEPS}
                  onDrill={() => onOpenArtifact("verification")}
                />
              );
            case "callout-decision":
              return (
                <DecisionCard
                  key={i}
                  body="A small public API change ships with this — the rotate endpoint. I want you to confirm before I push."
                  onApprove={() => {
                    /* Slice 4 wires this */
                  }}
                  onRequestChanges={() => {
                    /* Slice 4 wires this */
                  }}
                  onDrill={() => onOpenArtifact("diff")}
                />
              );
            default:
              return null;
          }
        })}
      </div>
    </div>
  );
}
