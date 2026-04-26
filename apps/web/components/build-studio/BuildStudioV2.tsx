"use client";
import { useState } from "react";
import {
  DEMO_BUILD,
  DEMO_CONVERSATION,
  DEMO_PENDING_APPROVALS,
  DEMO_STEPS,
} from "@/lib/build-studio-demo";
import type { ArtifactView } from "./types";
import { HeaderBar } from "./HeaderBar";
import { StepTracker } from "./StepTracker";
import { ConversationPane } from "./ConversationPane";
import { ArtifactPane } from "./ArtifactPane";

export function BuildStudioV2() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [view, setView] = useState<ArtifactView>("preview");

  const pendingForCurrent = DEMO_PENDING_APPROVALS.filter((a) => a.current).length;
  const otherBuildPending = DEMO_PENDING_APPROVALS.length - pendingForCurrent;

  return (
    <div
      className="grid h-screen overflow-hidden bg-[var(--dpf-bg)] text-[var(--dpf-text)]"
      style={{ gridTemplateRows: "auto auto 1fr" }}
      data-theme={theme}
    >
      <HeaderBar
        build={DEMO_BUILD}
        pendingApprovalCount={pendingForCurrent}
        otherBuildApprovalCount={otherBuildPending}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      <StepTracker steps={DEMO_STEPS} />
      <div
        className="grid min-h-0"
        style={{ gridTemplateColumns: "minmax(420px, 44%) 1fr" }}
      >
        <ConversationPane
          messages={DEMO_CONVERSATION}
          steps={DEMO_STEPS}
          userName={DEMO_BUILD.requestedBy}
          onSend={() => {
            /* Slice 2 wires this */
          }}
          onPause={() => {
            /* Slice 2 wires this */
          }}
          onSuggest={() => {
            /* Slice 2 wires this */
          }}
          onOpenArtifact={setView}
        />
        <ArtifactPane
          view={view}
          onViewChange={setView}
          sandboxUrl="sandbox.dpf.local/settings/api-keys"
        />
      </div>
    </div>
  );
}
