"use client";
import { useEffect, useRef } from "react";
import type { ArtifactView, Message, Step } from "./types";
import { Bubble } from "./Bubble";
import { Composer } from "./Composer";

interface Props {
  messages: Message[];
  steps: Step[];
  userName: string;
  onSend: (text: string) => void;
  onPause: () => void;
  onSuggest: () => void;
  onOpenArtifact: (v: ArtifactView) => void;
}

export function ConversationPane({
  messages,
  steps,
  userName,
  onSend,
  onPause,
  onSuggest,
  onOpenArtifact,
}: Props) {
  const actionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (actionRef.current && typeof actionRef.current.scrollIntoView === "function") {
      actionRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-[var(--dpf-bg)] min-h-0">
      <div className="flex-1 overflow-auto pt-3.5 pb-2">
        {messages.map((m, i) => (
          <div key={i} ref={m.needsAction ? actionRef : undefined}>
            <Bubble
              msg={m}
              steps={steps}
              userName={userName}
              onOpenArtifact={onOpenArtifact}
            />
          </div>
        ))}
      </div>
      <Composer onSend={onSend} onPause={onPause} onSuggest={onSuggest} />
    </div>
  );
}
