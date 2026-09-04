"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import type { AgentMessageRow, AgentInfo } from "@/lib/agent-coworker-types";
import type { UserContext } from "@/lib/permissions";
import { resolveAgentForRouteSync, AGENT_NAME_MAP } from "@/lib/agent-routing";
import { agentHoldsWebSearchGrant } from "@/lib/tak/agent-web-search-grant";
import { clearConversation, getOrCreateThreadSnapshot, getThreadSnapshotById, getMarketingSkillRules } from "@/lib/actions/agent-coworker";
import { signOutAction } from "@/lib/actions";
import { useResilientEventSource } from "@/lib/hooks/useResilientEventSource";
import { isTurnStalled } from "@/lib/agent/turn-watchdog";
import { approveProposal, rejectProposal } from "@/lib/actions/proposals";
import { AgentPanelHeader } from "./AgentPanelHeader";
import { AgentSkillAttributionChip } from "./AgentSkillAttributionChip";
import { AgentMessageBubble } from "./AgentMessageBubble";
import { AgentMessageInput } from "./AgentMessageInput";
import { CoworkerPriorityDock } from "@/components/golden-triangle/CoworkerPriorityDock";
import { CoworkerProfilePanel } from "./CoworkerProfilePanel";
import { CollaborationActivityPanel } from "./CollaborationActivityPanel";
import { collaborationReturnMessage, type CollaborationCard } from "./HandoffCard";
import { getConversationParticipants } from "@/lib/actions/conversation-participants-action";
import type { ConversationParticipant } from "@/lib/tak/conversation-participants-core";
import { isTaskInFlight } from "@/lib/tak/task-state-intent";
import { CoworkerHealthStatus } from "@/components/monitoring/CoworkerHealthStatus";
import { SetupActionButtonsWrapper } from "@/components/setup/SetupActionButtonsWrapper";
import { resolveCoworkerRuntimeMode } from "./coworker-runtime-mode";
import type { QuestionPacket } from "@/lib/tak/question-packet";
import { isStandingCooAgentId, presentStandingCoo, resolveCooPresentationIdentity, resolveCooPresentationName } from "@/lib/coworker-presentation/coo-name";
import {
  loadElevatedAssistPreference,
  saveElevatedAssistPreference,
} from "./agent-form-assist-prefs";
import {
  buildExternalAccessContinuationPrompt,
  loadExternalAccessSessionState,
  saveExternalAccessSessionState,
  loadCoworkerMode,
  saveCoworkerMode,
  type CoworkerMode,
} from "./agent-external-access-session";
import {
  buildAgentFormAssistContext,
  getActiveFormAssist,
} from "@/lib/agent-form-assist";
import {
  createOptimisticUserMessage,
  failOptimisticMessage,
  retryOptimisticMessage,
  type AgentRenderableMessage,
} from "./agent-message-state";
import { useVoiceSynth } from "./hooks/useVoiceSynth";
import { deriveComposerState, type ThreadLoadState } from "./composer-state";
import { resolvePanelRouteContextLabel } from "@/lib/agent/panel-route-context";

type Props = {
  threadId: string | null;
  initialMessages: AgentMessageRow[];
  userContext: UserContext;
  useUnifiedCoworker: boolean;
  onClose: () => void;
  onDragStart: (e: React.MouseEvent) => void;
  pendingAutoMessage?: string | null;
  /**
   * What the OWNER sees for an auto-sent nudge whose sent text is
   * machine-precise. Sending stays exact; the transcript stays plain, so a
   * nudge naming tools does not read as if the owner typed it.
   */
  pendingAutoMessageDisplay?: string | null;
  onAutoMessageConsumed?: () => void;
  onConversationCleared?: () => void;
  /** When set, overrides pathname for agent routing and message routeContext.
   *  Used during setup so all steps route to the onboarding-coo agent. */
  routeContextOverride?: string;
  isDocked?: boolean;
  /** Thread snapshot load lifecycle; "failed" renders the reconnect banner (BI-D028B2A8). */
  threadLoadState?: ThreadLoadState;
  /** Recovery for a failed load: hard reload to fetch a fresh bundle (see shell handler). */
  onReloadToReconnect?: () => void;
  /** Organization-scoped presentation preference for the standing COO only. */
  cooConversationalName?: string | null;
};

type MessageSendOptions = {
  externalAccessEnabled?: boolean;
  questionPacket?: QuestionPacket | null;
};

function filterMessages(messages: AgentMessageRow[]): AgentMessageRow[] {
  return messages.filter((m) => {
    // Hide system-join notices ("X has joined the conversation").
    if (m.role === "system" && m.content.endsWith("has joined the conversation")) {
      return false;
    }
    // D5 / D9 (2026-05-23): hide setup-trigger user messages from the rendered
    // chat. These are emitted by SetupOverlay as user-role messages that begin
    // with "[Setup step: <label>]" + organisation context + instructions
    // intended for the coworker. The agent handles them as a setup trigger
    // (see agent-coworker.ts isSetupTrigger), but the user previously saw the
    // literal setup-instruction text in their chat history — looked like
    // debug output leaking into the UI. The trigger does its job invisibly
    // now; the coworker's response is still rendered as normal.
    if (m.role === "user" && m.content.trimStart().startsWith("[Setup step:")) {
      return false;
    }
    return true;
  });
}

function isClearDisabled(
  messages: AgentRenderableMessage[],
  busy: boolean,
  isClearing: boolean,
  threadId?: string | null,
) {
  return !threadId || messages.length === 0 || busy || isClearing;
}

// BI-2750EB6F: how long a busy turn may go with NO sign of server life (no SSE
// data frame and no 15s liveness heartbeat) before the client surfaces a failure
// and clears the spinner. Comfortably above the 15s heartbeat cadence and the
// 40s transport watchdog, so it only trips when the portal event loop is
// genuinely saturated/dead — never on a legitimately slow-but-progressing turn.
const TURN_STALL_LIMIT_MS = 90_000;
const TURN_WATCHDOG_TICK_MS = 5_000;

export function AgentCoworkerPanel({
  threadId,
  initialMessages,
  userContext,
  useUnifiedCoworker,
  onClose,
  onDragStart,
  pendingAutoMessage,
  pendingAutoMessageDisplay,
  onAutoMessageConsumed,
  onConversationCleared,
  routeContextOverride,
  isDocked = false,
  threadLoadState,
  onReloadToReconnect,
  cooConversationalName = null,
}: Props) {
  const pathname = usePathname();
  // During setup, use the override so the onboarding-coo agent handles all steps
  const effectiveRoute = routeContextOverride ?? pathname;
  const [messages, setMessages] = useState<AgentRenderableMessage[]>(() => filterMessages(initialMessages));
  // EP-ASYNC-COWORKER-001: isBusy replaces useTransition's isPending for message flow.
  // This is a plain useState — it does NOT block the Next.js router or prevent navigation.
  const [isBusy, setIsBusy] = useState(false);
  // Count of /api/agent/send requests still settling — drives the composer's
  // "Sending…" window; isBusy keeps covering the whole agent execution.
  const [sendsInFlight, setSendsInFlight] = useState(0);
  // BI-2750EB6F: last sign of SERVER life (any SSE data frame OR the 15s liveness
  // heartbeat), driving the turn-completion watchdog effect below.
  const lastServerActivityRef = useRef<number>(0);
  const [isClearing, startClearing] = useTransition();
  // Embedders that don't thread load state through (e.g. tests rendering the
  // panel directly) get the legacy inference: no threadId means still loading.
  const effectiveThreadLoadState: ThreadLoadState =
    threadLoadState ?? (threadId ? "ready" : "loading");
  const composerState = deriveComposerState({
    isClearing,
    threadLoadState: effectiveThreadLoadState,
    threadId,
    sendsInFlight,
    isBusy,
  });
  const [elevatedAssistEnabled, setElevatedAssistEnabled] = useState(false);
  const [externalAccessEnabled, setExternalAccessEnabled] = useState(false);
  // Build Studio defaults to Act mode — its purpose is building, not advising
  const [coworkerMode, setCoworkerMode] = useState<CoworkerMode>(() =>
    pathname.startsWith("/build") ? "act" : "advise"
  );
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<{ attachmentId: string; fileName: string; parsedContent: unknown } | null>(null);
  const [lastProviderInfo, setLastProviderInfo] = useState<{ providerId: string; modelId: string } | null>(null);
  const [devMode, setDevMode] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  // Governed Hermes learning Slice 1: active skill steering the in-flight
  // request. Set when the user picks a skill from the dropdown; cleared when
  // the response arrives. Drives the AgentSkillAttributionChip in the busy
  // status line.
  const [activeSkill, setActiveSkill] = useState<{ skillId: string; label: string } | null>(null);
  const [marketingSkillRules, setMarketingSkillRules] = useState<Record<string, { visible?: boolean; label?: string; reframe?: string }> | null>(null);
  // EP-A2A multi-agent collaboration (2026-06-04 spec, Slice 1): the live
  // participant roster + the inline handoff/summon cards the user SEES when the
  // active coworker hands off to, or brings in, another coworker. Visibility
  // only — the human never picks or tasks peers; the active coworker does.
  const [participants, setParticipants] = useState<ConversationParticipant[]>([]);
  const [collaborationCards, setCollaborationCards] = useState<CollaborationCard[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshParticipants = useCallback(() => {
    if (!threadId) {
      setParticipants([]);
      return;
    }
    getConversationParticipants(threadId)
      .then(setParticipants)
      .catch(() => { /* projection failures must not break chat — quiet rail */ });
  }, [threadId]);

  // Ref so the SSE handler always calls the latest refresh without needing it
  // in the EventSource effect's dependency array (mirrors voiceSynthRef below).
  const refreshParticipantsRef = useRef(refreshParticipants);
  refreshParticipantsRef.current = refreshParticipants;

  // Initial + on-thread-change roster fetch. Collaboration SSE events below
  // also trigger a refresh so the rail stays live during a turn.
  useEffect(() => {
    refreshParticipants();
  }, [refreshParticipants]);

  // While any sub-agent is in-flight, poll the roster so the done indicator
  // flips to "done" when child tasks reach a terminal state. (Slice 2 wires
  // collaboration:return from child terminal transitions to make this push.)
  useEffect(() => {
    const anyInFlight = participants.some((p) => p.role !== "owner" && isTaskInFlight(p.state));
    if (!anyInFlight) return;
    const t = setInterval(() => refreshParticipantsRef.current(), 4000);
    return () => clearInterval(t);
  }, [participants]);

  // Cards shown in the disclosure = live SSE cards merged with cards
  // reconstructed from persisted provenance (participant enteredVia), so
  // handoff/summon cards survive a page refresh. Live cards win by id (they
  // carry the question-packet summary the reconstruction lacks).
  const collaborationCardsToShow = useMemo<CollaborationCard[]>(() => {
    const ownerLabel = participants.find((p) => p.role === "owner")?.label ?? "Coworker";
    const byId = new Map<string, CollaborationCard>();
    for (const p of participants) {
      if (p.role === "owner") continue;
      if (p.enteredVia !== "summon" && p.enteredVia !== "handoff") continue;
      const kind = p.enteredVia === "summon" ? "summon" : "handoff";
      byId.set(`collab-${kind}-${p.threadId}`, {
        id: `collab-${kind}-${p.threadId}`,
        kind,
        // Both handoff and summon are coworker-initiated: the active coworker
        // (owner) is the source, never "You" — the human does not task peers.
        fromLabel: ownerLabel,
        toLabel: p.label,
        tier: p.tier === 3 ? 3 : 2,
        childThreadId: p.threadId,
      });
    }
    for (const c of collaborationCards) byId.set(c.id, c); // live overrides reconstructed
    return [...byId.values()];
  }, [participants, collaborationCards]);
  const voiceSynth = useVoiceSynth();
  // Keep a ref so the SSE done handler always sees the latest voiceSynth state
  // without needing to re-subscribe the EventSource on every render.
  const voiceSynthRef = useRef(voiceSynth);
  voiceSynthRef.current = voiceSynth;

  // Per-session voice playback toggle — persisted in localStorage so it
  // survives panel close/open within the same browser session.
  const VOICE_PLAYBACK_KEY = "dpf:voice_playback_enabled";
  const [voicePlaybackEnabled, setVoicePlaybackEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(VOICE_PLAYBACK_KEY);
    return stored === null ? true : stored === "true";
  });

  const toggleVoicePlayback = useCallback(() => {
    setVoicePlaybackEnabled((prev) => {
      const next = !prev;
      localStorage.setItem(VOICE_PLAYBACK_KEY, String(next));
      // Stop any in-flight audio immediately when the user disables playback
      if (!next) voiceSynthRef.current.stop();
      return next;
    });
  }, []);

  // Keep a ref so the SSE done handler always reads the latest value.
  const voicePlaybackEnabledRef = useRef(voicePlaybackEnabled);
  voicePlaybackEnabledRef.current = voicePlaybackEnabled;

  const routeAgent: AgentInfo = resolveAgentForRouteSync(effectiveRoute, userContext);
  const agent = presentStandingCoo(routeAgent, cooConversationalName);
  const agentIdentity = resolveCooPresentationIdentity({ agentId: agent.agentId, canonicalName: agent.agentName, conversationalName: cooConversationalName });
  const webAccessAvailable = agentHoldsWebSearchGrant(agent.agentId);
  const canUseDev = userContext.isSuperuser || userContext.platformRole === "HR-000" || userContext.platformRole === "HR-300";
  const preferenceUserKey = userContext.userId ?? `${userContext.isSuperuser ? "super" : "role"}:${userContext.platformRole ?? "none"}`;

  // Fetch archetype-driven marketing skill rules for the marketing specialist
  useEffect(() => {
    if (agent?.agentId !== "marketing-specialist") {
      setMarketingSkillRules(null);
      return;
    }
    getMarketingSkillRules().then((rules) =>
      setMarketingSkillRules(rules as Record<string, { visible?: boolean; label?: string; reframe?: string }> | null),
    );
  }, [agent?.agentId]);

  // Elapsed time counter for thinking indicator
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [currentTool, setCurrentTool] = useState<string | null>(null);
  const [orchestratorStatus, setOrchestratorStatus] = useState<string | null>(null);
  // Task status board: keyed by taskTitle, updated in place as events arrive
  type TaskStatus = { specialist: string; status: "pending" | "working" | "done" | "concern" | "blocked" | "retry"; time: string };
  const [buildTasks, setBuildTasks] = useState<Map<string, TaskStatus>>(new Map());
  const [buildProgress, setBuildProgress] = useState<{ completed: number; total: number } | null>(null);
  const buildLogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isBusy) { setThinkingSeconds(0); return; }
    const t = setInterval(() => setThinkingSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [isBusy]);

  // Governed Hermes learning Slice 1: clear the active-skill chip when the
  // turn finishes (isBusy drops false). Keeps the chip visible for the
  // lifetime of the in-flight request, never longer.
  useEffect(() => {
    if (!isBusy && activeSkill) {
      setActiveSkill(null);
    }
  }, [isBusy, activeSkill]);

  // SSE for tool-level progress, orchestrator status, and async completion.
  //
  // Resilient SSE (BI-1AFF530D): the coworker stream is open whenever the agent
  // is busy — including while a self-upgrade recreates the portal container — so
  // a plain EventSource here was a prime source of the zombie connections that
  // wedge Chrome's ~6 HTTP/1.1 slots (BI-864E83B0). The heartbeat watchdog in
  // useResilientEventSource reaps the stream the moment it goes silent past the
  // window and reconnects, so it can never strand a slot. The idle reset and the
  // periodic DB recovery poll that used to share this effect are split out below.
  const coworkerStreamUrl = isBusy && threadId ? `/api/agent/stream?threadId=${threadId}` : null;
  useResilientEventSource(coworkerStreamUrl, {
    // BI-2750EB6F: the 15s liveness heartbeat proves the server loop is alive
    // even between real events — record it so the turn watchdog below does not
    // false-fire on a slow-but-progressing turn.
    onHeartbeat: () => {
      lastServerActivityRef.current = Date.now();
    },
    onMessage: (event) => {
      // Any real data frame is also a sign of server life.
      lastServerActivityRef.current = Date.now();
      try {
        const data = JSON.parse(event.data);
        if (data.type === "tool:start") setCurrentTool(data.tool);
        if (data.type === "tool:complete") setCurrentTool(null);
        // Orchestrator progress — update task status board in place
        const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        if (data.type === "orchestrator:build_started") {
          setOrchestratorStatus(`Building: ${data.taskCount} tasks`);
          setBuildTasks(new Map());
          setBuildProgress({ completed: 0, total: data.taskCount });
        }
        if (data.type === "orchestrator:task_dispatched") {
          setOrchestratorStatus(`${data.specialist} working on: ${data.taskTitle}`);
          setBuildTasks((prev) => {
            const next = new Map(prev);
            next.set(data.taskTitle, { specialist: data.specialist, status: "working", time: now });
            return next;
          });
        }
        if (data.type === "orchestrator:task_progress") {
          setOrchestratorStatus(`${data.taskTitle}: ${data.message}`);
        }
        if (data.type === "orchestrator:task_complete") {
          const status = data.status === "DONE" ? "done" as const : data.status === "DONE_WITH_CONCERNS" ? "concern" as const : "blocked" as const;
          setOrchestratorStatus(`${data.specialist} complete`);
          setBuildTasks((prev) => {
            const next = new Map(prev);
            next.set(data.taskTitle, { specialist: data.specialist, status, time: now });
            return next;
          });
        }
        if (data.type === "orchestrator:phase_summary") {
          setOrchestratorStatus(`${data.completed}/${data.total} tasks done`);
          setBuildProgress({ completed: data.completed, total: data.total });
        }
        if (data.type === "orchestrator:specialist_retry") {
          setOrchestratorStatus(`Retrying ${data.specialist}`);
          setBuildTasks((prev) => {
            const next = new Map(prev);
            // Find the task this specialist is working on and mark retry
            for (const [title, task] of next) {
              if (task.specialist === data.specialist && task.status === "working") {
                next.set(title, { ...task, status: "retry", time: now });
              }
            }
            return next;
          });
        }
        // Brand-extraction progress from the Inngest worker (cross-process)
        // EP-A2A multi-agent collaboration — render the handoff/summon/return
        // inline and refresh the participant rail.
        if (data.type === "collaboration:handoff" || data.type === "collaboration:summon" ||
          data.type === "collaboration:return") {
          const labelOf = (id: string | undefined, fallback: string) => (id ? AGENT_NAME_MAP[id] : undefined) ?? id ?? fallback;
          let card: CollaborationCard;
          if (data.type === "collaboration:handoff") {
            card = {
              id: `collab-handoff-${data.childThreadId}`,
              kind: "handoff",
              fromLabel: labelOf(data.fromAgentId, "Coworker"),
              toLabel: labelOf(data.toAgentId, "Coworker"),
              tier: data.tier === 3 ? 3 : 2,
              summary: typeof data.questionPacketSummary === "string" ? data.questionPacketSummary : undefined,
              childThreadId: data.childThreadId,
            };
          } else if (data.type === "collaboration:summon") {
            card = {
              id: `collab-summon-${data.childThreadId}`,
              kind: "summon",
              // The active coworker summoned the peer, not the human.
              fromLabel: labelOf(data.fromAgentId, agent.agentName),
              toLabel: labelOf(data.summonedAgentId, "Coworker"),
              tier: data.tier === 3 ? 3 : 2,
              childThreadId: data.childThreadId,
            };
          } else {
            card = {
              id: `collab-return-${data.childThreadId}`,
              kind: "return",
              fromLabel: labelOf(data.fromAgentId, "Coworker"),
              toLabel: labelOf(data.toAgentId, "Owner"),
              tier: 2,
              outcome: data.outcome, summary: data.ownerMessage ? "Grounded advisory added to the COO conversation." : undefined,
              childThreadId: data.childThreadId,
            };
            const returnedMessage = collaborationReturnMessage(data, effectiveRoute);
            if (returnedMessage) setMessages((prev) => prev.some((message) => message.id === returnedMessage.id)
              ? prev : [...prev, returnedMessage]);
          }
          setCollaborationCards((prev) => (prev.some((c) => c.id === card.id) ? prev : [...prev, card]));
          refreshParticipantsRef.current();
        }
        if (data.type === "brand:extract.progress") {
          setOrchestratorStatus(`${data.stage}: ${data.message} (${data.percent}%)`);
        }
        if (data.type === "brand:extract.complete") {
          setOrchestratorStatus("Brand ready");
          setMessages((prev) => [...prev, {
            id: `local-brand-complete-${Date.now()}`,
            role: "system" as const,
            content: `${data.summary}\n\nView your new brand: /admin/branding`,
            agentId: agent.agentId,
            routeContext: effectiveRoute,
            createdAt: new Date().toISOString(),
          }]);
        }
        if (data.type === "brand:extract.failed") {
          setOrchestratorStatus(null);
          setMessages((prev) => [...prev, {
            id: `local-brand-failed-${Date.now()}`,
            role: "system" as const,
            content: `Brand extraction failed: ${data.error}. Try a different URL or source.`,
            agentId: agent.agentId,
            routeContext: effectiveRoute,
            createdAt: new Date().toISOString(),
          }]);
        }
        // EP-ASYNC-COWORKER-001: error event — show in chat
        if (data.type === "error") {
          setMessages((prev) => [...prev, {
            id: `local-error-${Date.now()}`,
            role: "system" as const,
            content: data.message ?? "An error occurred during agent execution.",
            agentId: agent.agentId,
            routeContext: effectiveRoute,
            createdAt: new Date().toISOString(),
          }]);
        }
        // EP-ASYNC-COWORKER-001: enriched done — fetch messages from DB and apply ephemeral data
        if (data.type === "done") {
          setCurrentTool(null);
          setOrchestratorStatus(null);
          // Keep buildTasks and buildProgress visible as a record of what was done.
          // They clear on the next build start or conversation clear.

          // Apply ephemeral data not stored in DB
          if (data.providerInfo) {
            setLastProviderInfo(data.providerInfo);
          }
          if (data.formAssistUpdate && activeFormAssistRef.current) {
            activeFormAssistRef.current.applyFieldUpdates(data.formAssistUpdate);
          }

          // Refresh messages from DB — authoritative source.
          // Fetch by threadId (which we already have as a prop) rather than
          // by routeContext. The thread may be bound to a sub-context like
          // "/build#FB-xxx" while pathname is just "/build"; fetching by
          // routeContext would return the wrong (empty) thread and blow
          // the panel's message list away.
          if (threadId) {
            getThreadSnapshotById({ threadId }).then((snapshot) => {
              if (snapshot) {
                const filtered = filterMessages(snapshot.messages);
                setMessages(filtered);
                // Auto-synthesize the last assistant message if voice is available
                // and the user has not muted playback via the speaker toggle.
                const lastMsg = filtered[filtered.length - 1];
                if (lastMsg?.role === "assistant" && voiceSynthRef.current.available && voicePlaybackEnabledRef.current) {
                  voiceSynthRef.current.synthesize(lastMsg.content).catch(() => {});
                }
              }
              setIsBusy(false);
            }).catch(() => {
              setIsBusy(false);
            });
          } else {
            setIsBusy(false);
          }
        }

        // Relay build-relevant events to BuildStudio via DOM event.
        // The panel is always SSE-connected when busy; BuildStudio may not
        // have a threadId yet, so this relay is the primary update channel.
        const RELAY_TYPES = ["phase:change", "evidence:update", "sandbox:ready", "orchestrator:task_dispatched", "orchestrator:task_complete", "done"];
        if (RELAY_TYPES.includes(data.type)) {
          window.dispatchEvent(new CustomEvent("build-progress-update", { detail: data }));
        }
        // Relay research progress messages separately so FeatureBriefPanel can
        // show them without triggering unnecessary DB refetches in BuildStudio.
        if (data.type === "orchestrator:task_progress" && data.message) {
          window.dispatchEvent(new CustomEvent("build-research-progress", { detail: data }));
        }
      } catch { /* ignore */ }
    },
  });

  // Idle reset — clear the in-flight tool/orchestrator chips when the agent is
  // not busy (formerly the early-return of the combined SSE effect).
  useEffect(() => {
    if (!isBusy || !threadId) {
      setCurrentTool(null);
      setOrchestratorStatus(null);
    }
  }, [isBusy, threadId]);

  // Periodic recovery: check DB every 15 seconds while busy. Catches missed SSE
  // "done" events (connection drops, server restart, etc.). This is the backstop
  // for the case the resilient stream reconnects *after* the server already
  // emitted "done" and so never replays it. Fetches by threadId for the same
  // reason as the "done" handler above.
  useEffect(() => {
    if (!isBusy || !threadId) return;
    const recoveryInterval = setInterval(() => {
      if (!threadId) return;
      getThreadSnapshotById({ threadId }).then((snapshot) => {
        if (!snapshot) return;
        const latestMsg = snapshot.messages[snapshot.messages.length - 1];
        if (latestMsg && (latestMsg.role === "assistant" || latestMsg.role === "system")) {
          setMessages(filterMessages(snapshot.messages));
          setIsBusy(false);
          setCurrentTool(null);
          setOrchestratorStatus(null);
        }
      }).catch(() => {});
    }, 15_000);
    return () => clearInterval(recoveryInterval);
  }, [isBusy, threadId]);

  // BI-2750EB6F: turn-completion watchdog. Purely client-side — the ONLY clearer
  // that keeps working when the portal event loop itself is saturated (the SSE
  // `done`, the DB recovery poll, and the transport reconnect all need the loop
  // to make progress). If no server life (data frame OR liveness heartbeat) has
  // been observed for TURN_STALL_LIMIT_MS while busy, the turn is presumed lost:
  // surface a failure system message so the user isn't left staring at a silent
  // spinner, clear isBusy so the composer is usable again, and reset the chips.
  useEffect(() => {
    if (!isBusy) return;
    const watchdog = setInterval(() => {
      if (!isTurnStalled(lastServerActivityRef.current, Date.now(), TURN_STALL_LIMIT_MS)) return;
      setMessages((prev) => [
        ...prev,
        {
          id: `local-turn-timeout-${Date.now()}`,
          role: "system" as const,
          content:
            "The coworker didn't respond — the server may be overloaded right now. Your message was sent; try again in a moment.",
          agentId: agent.agentId,
          routeContext: effectiveRoute,
          createdAt: new Date().toISOString(),
        },
      ]);
      setIsBusy(false);
      setCurrentTool(null);
      setOrchestratorStatus(null);
    }, TURN_WATCHDOG_TICK_MS);
    return () => clearInterval(watchdog);
  }, [isBusy, agent.agentId, effectiveRoute]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setMessages(filterMessages(initialMessages));
    setClearConfirmOpen(false);
  }, [threadId, initialMessages]);

  // EP-ASYNC-COWORKER-001: When thread changes (user navigated to another page),
  // reset isBusy and probe the server to check if this thread has an active execution.
  // This handles the re-entrant scenario: user leaves while COO is working on /workspace,
  // starts a new task on /employee, then comes back to /workspace — the thinking
  // indicator resumes if the COO is still executing.
  useEffect(() => {
    setIsBusy(false);
    setCurrentTool(null);
    setOrchestratorStatus(null);
    if (!threadId) return;
    let cancelled = false;
    fetch(`/api/agent/status?threadId=${threadId}`).then(async (res) => {
      if (cancelled) return;
      const body = await res.json().catch(() => null);
      if (body?.active) {
        setIsBusy(true); // Resume SSE listener and thinking indicator
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [threadId]);

  useEffect(() => {
    setElevatedAssistEnabled(loadElevatedAssistPreference(preferenceUserKey, pathname));
    setExternalAccessEnabled(loadExternalAccessSessionState(preferenceUserKey, pathname));
    setCoworkerMode(loadCoworkerMode(preferenceUserKey, pathname));
  }, [pathname, preferenceUserKey]);

  useEffect(() => {
    function handleBuildChange(e: Event) {
      const buildId = (e as CustomEvent<string | null>).detail;
      setActiveBuildId(buildId);
    }
    window.addEventListener("build-studio-active-build", handleBuildChange);
    return () => window.removeEventListener("build-studio-active-build", handleBuildChange);
  }, []);

  // Auto-send a message when triggered by build creation or other events
  useEffect(() => {
    if (pendingAutoMessage && threadId) {
      const shown = pendingAutoMessageDisplay ?? pendingAutoMessage;
      submitMessage(pendingAutoMessage, createOptimisticUserMessage(shown, effectiveRoute));
      onAutoMessageConsumed?.();
    }
  }, [pendingAutoMessage, threadId]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleToggleElevatedAssist() {
    setElevatedAssistEnabled((prev) => {
      const next = !prev;
      saveElevatedAssistPreference(preferenceUserKey, pathname, next);
      return next;
    });
  }

  function handleToggleExternalAccess() {
    const next = !externalAccessEnabled;
    setExternalAccessEnabled(next);
    saveExternalAccessSessionState(preferenceUserKey, pathname, next);

    if (next && !isBusy) {
      const continuation = buildExternalAccessContinuationPrompt(messages);
      if (continuation) {
        submitMessage(
          continuation,
          createOptimisticUserMessage(continuation, effectiveRoute),
          true,
          { externalAccessEnabled: true },
        );
      }
    }
  }

  function handleToggleCoworkerMode() {
    setCoworkerMode((prev) => {
      const next: CoworkerMode = prev === "advise" ? "act" : "advise";
      saveCoworkerMode(preferenceUserKey, pathname, next);
      return next;
    });
  }

  // EP-ASYNC-COWORKER-001: activeFormAssist ref for SSE done handler
  const activeFormAssistRef = useRef<ReturnType<typeof getActiveFormAssist>>(null);
  activeFormAssistRef.current = elevatedAssistEnabled ? getActiveFormAssist(pathname) : null;

  function submitMessage(
    content: string,
    optimisticMessage = createOptimisticUserMessage(content, effectiveRoute),
    appendOptimistic = true,
    sendOptions?: MessageSendOptions,
  ) {
    // BI-6D7DDE9F: the composer clears its input the moment send fires, so a
    // bare `return` here DESTROYS the message — no request, no row, no error.
    // Fail it like a network error instead, so the words stay on screen and
    // handleRetry can resend them once the thread connects.
    if (!threadId) {
      console.warn("[submitMessage] not sent: conversation is not connected yet (no threadId)");
      if (appendOptimistic) {
        setMessages((prev) => [...prev, failOptimisticMessage(optimisticMessage)]);
      }
      return;
    }
    const formAssistContext = activeFormAssistRef.current
      ? buildAgentFormAssistContext(activeFormAssistRef.current)
      : undefined;
    if (appendOptimistic) {
      setMessages((prev) => [...prev, optimisticMessage]);
    }

    const attachmentForThisMessage = pendingAttachment;
    if (attachmentForThisMessage) setPendingAttachment(null);

    setIsBusy(true);
    setSendsInFlight((count) => count + 1);
    // BI-2750EB6F: start the turn watchdog's clock — the server has "just been
    // heard from" (we're about to POST). If nothing (data or heartbeat) arrives
    // before the deadline, the watchdog effect surfaces a failure.
    lastServerActivityRef.current = Date.now();

    const runtimeMode = resolveCoworkerRuntimeMode({
      pathname,
      devMode,
      useUnifiedCoworker,
      coworkerMode,
      externalAccessEnabled: sendOptions?.externalAccessEnabled ?? externalAccessEnabled,
    });

    // EP-ASYNC-COWORKER-001: Non-blocking fetch to API route.
    // Returns immediately. Agent execution runs in background on the server.
    // Completion is signaled via SSE "done" event (handled in useEffect below).
    fetch("/api/agent/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        content,
        routeContext: effectiveRoute,
        coworkerMode: runtimeMode.coworkerMode,
        externalAccessEnabled: runtimeMode.externalAccessEnabled,
        elevatedFormFillEnabled: elevatedAssistEnabled,
        ...(formAssistContext ? { formAssistContext } : {}),
        ...(activeBuildId ? { buildId: activeBuildId } : {}),
        ...(attachmentForThisMessage ? { attachmentId: attachmentForThisMessage.attachmentId } : {}),
        ...(sendOptions?.questionPacket ? { questionPacket: sendOptions.questionPacket } : {}),
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Send failed" }));
        console.warn("[submitMessage] send failed:", body.error);
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id ? failOptimisticMessage(message) : message,
          ),
        );
        setIsBusy(false);
      } else {
        // Server accepted — mark as sent so user sees delivery confirmation
        // instead of "Sending..." for the entire duration of agent execution.
        setMessages((prev) =>
          prev.map((message) =>
            message.id === optimisticMessage.id ? { ...message, deliveryState: "sent" as const } : message,
          ),
        );
        // Notify BuildStudio of the threadId so it can connect SSE as a fallback.
        // The server writes threadId to the build on first message (fire-and-forget),
        // so by the time the response arrives, the link exists in the DB.
        if (activeBuildId && threadId) {
          window.dispatchEvent(new CustomEvent("build-thread-linked", {
            detail: { buildId: activeBuildId, threadId },
          }));
        }
      }
    }).catch((e) => {
      console.error("[submitMessage] network error:", e);
      setMessages((prev) =>
        prev.map((message) =>
          message.id === optimisticMessage.id ? failOptimisticMessage(message) : message,
        ),
      );
      setIsBusy(false);
    }).finally(() => {
      setSendsInFlight((count) => Math.max(0, count - 1));
    });
  }

  function handleSend(content: string, options?: Pick<MessageSendOptions, "questionPacket">) {
    submitMessage(content, undefined, true, options);
  }

  /**
   * Governed Hermes learning Slice 1: skill-attributed send path. Captures
   * the active skill metadata in state so AgentSkillAttributionChip renders
   * alongside the busy state for the lifetime of this turn.
   */
  function handleSendSkill(skill: { skillId: string; label: string; prompt: string }) {
    setActiveSkill({ skillId: skill.skillId, label: skill.label });
    submitMessage(skill.prompt);
  }

  function handleRetry(messageId: string) {
    const failedMessage = messages.find(
      (message) => message.id === messageId && message.role === "user" && message.deliveryState === "failed",
    );
    if (!failedMessage) return;
    const retryContent = failedMessage.retryContent ?? failedMessage.content;

    const retriedMessage = retryOptimisticMessage(failedMessage);
    setMessages((prev) =>
      prev.map((message) => (message.id === messageId ? retriedMessage : message)),
    );
    submitMessage(retryContent, retriedMessage, false);
  }

  async function handleApprove(proposalId: string) {
    try {
      const result = await approveProposal(proposalId);
      const msg = messages.find((m) => m.proposal?.proposalId === proposalId);
      const actionType = msg?.proposal?.actionType ?? "action";

      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? {
                ...m,
                proposal: {
                  ...m.proposal,
                  status: result.success ? "executed" : "failed",
                  ...(result.resultEntityId !== undefined ? { resultEntityId: result.resultEntityId } : {}),
                  ...(result.error !== undefined ? { resultError: result.error } : {}),
                },
              }
            : m,
        ),
      );

      // Auto-send a follow-up so the agent reacts to the result
      if (result.success) {
        const followUp = result.resultEntityId
          ? `I approved ${actionType.replace(/_/g, " ")}. Result: ${result.resultEntityId}. What's next?`
          : `I approved ${actionType.replace(/_/g, " ")}. What's next?`;
        submitMessage(followUp);
      }
    } catch (e) {
      console.error("[handleApprove]", e);
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? { ...m, proposal: { ...m.proposal, status: "failed", resultError: "Execution failed" } }
            : m,
        ),
      );
    }
  }

  async function handleReject(proposalId: string) {
    const result = await rejectProposal(proposalId);
    if (result.success) {
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? { ...m, proposal: { ...m.proposal, status: "rejected" } }
            : m,
        ),
      );
    }
  }

  function handleOpenClearConfirm() {
    if (isClearDisabled(messages, isBusy, isClearing, threadId)) return;
    setClearConfirmOpen(true);
  }

  function handleCancelClearConfirm() {
    setClearConfirmOpen(false);
  }

  function handleConfirmClear() {
    if (!threadId) return;
    setClearConfirmOpen(false);

    startClearing(async () => {
      // BI-63906D5D — coworker panel wedge: useTransition keeps `isClearing`
      // true until this async resolves, and `isClearing` disables the input
      // (placeholder "Sending..."). clearConversation can hang server-side
      // (observed after an aborted/ghost-called coworker turn left the thread
      // mid-flight), which left the panel permanently wedged — surviving a
      // page reload and a portal restart, with no operator recovery. Race the
      // call against a timeout so the transition — and therefore the input —
      // always recovers, then reset local state best-effort so the operator can
      // keep working even if the server side never confirmed the clear.
      const CLEAR_TIMEOUT_MS = 10_000;
      let timedOut = false;
      const result = await Promise.race([
        clearConversation({ threadId }),
        new Promise<{ error: string }>((resolve) =>
          setTimeout(() => {
            timedOut = true;
            resolve({ error: "clearConversation timed out" });
          }, CLEAR_TIMEOUT_MS),
        ),
      ]);
      if ("error" in result) {
        console.warn("clearConversation error:", result.error);
        if (timedOut) {
          // Best-effort local reset so a hung server action doesn't strand the
          // operator. The input re-enables as soon as this async returns.
          setMessages([]);
          setBuildTasks(new Map());
          setBuildProgress(null);
          onConversationCleared?.();
        }
        return;
      }
      setMessages([]);
      setBuildTasks(new Map());
      setBuildProgress(null);
      onConversationCleared?.();
    });
  }

  return (
    <>
      <AgentPanelHeader
        agent={agent}
        userContext={userContext}
        onSend={handleSend}
        onSendSkill={handleSendSkill}
        onOpenClearConfirm={handleOpenClearConfirm}
        onCancelClearConfirm={handleCancelClearConfirm}
        onConfirmClear={handleConfirmClear}
        clearDisabled={isClearDisabled(messages, isBusy, isClearing, threadId)}
        clearConfirmOpen={clearConfirmOpen}
        onClose={onClose}
        onDragStart={onDragStart}
        providerInfo={lastProviderInfo}
        devMode={devMode}
        canUseDev={canUseDev}
        onToggleDev={() => setDevMode((prev) => !prev)}
        onViewProfile={() => setShowProfile(true)}
        marketingSkillRules={marketingSkillRules}
        isDocked={isDocked}
        routeContextLabel={resolvePanelRouteContextLabel(effectiveRoute)}
        presentationIdentity={agentIdentity}
      />

      {/* Voice activity indicator — shown when voice synthesis is active */}
      {voiceSynth.available && (voiceSynth.isSynthesizing || voiceSynth.isPlaying) && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            background: "color-mix(in srgb, var(--dpf-accent) 8%, transparent)",
            borderBottom: "1px solid color-mix(in srgb, var(--dpf-accent) 20%, transparent)",
            fontSize: 11,
            color: "var(--dpf-accent)",
          }}
        >
          <button
            type="button"
            aria-label="Stop voice playback"
            onClick={() => voiceSynth.stop()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--dpf-accent)",
              fontSize: 13,
              lineHeight: 1,
              padding: 0,
              flexShrink: 0,
            }}
          >
            {voiceSynth.isSynthesizing ? "⏳" : "🔊"}
          </button>
          <span>{voiceSynth.isSynthesizing ? "Synthesizing voice…" : "Speaking — click to stop"}</span>
        </div>
      )}

      {showProfile && (
        <CoworkerProfilePanel
          agent={agent}
          onClose={() => setShowProfile(false)}
        />
      )}

      <CollaborationActivityPanel participants={participants} cards={collaborationCardsToShow} />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px",
        }}
      >
        {messages.map((msg, i) => {
          const prevAgentId = i > 0 ? messages[i - 1]?.agentId : null;
          const activeAgent = msg.agentId === agent.agentId
            || (isStandingCooAgentId(msg.agentId) && isStandingCooAgentId(agent.agentId));
          const showAgentLabel = msg.role === "assistant" && !activeAgent && msg.agentId !== prevAgentId;
          // Decisions are actionable only on the latest idle turn.
          const isLatest = i === messages.length - 1;
          const decisionActive = isLatest && !isBusy && msg.role === "assistant";
          return (
            <AgentMessageBubble
              key={msg.id}
              message={msg}
              showAgentLabel={showAgentLabel}
              agentName={msg.agentId ? resolveCooPresentationName({
                agentId: msg.agentId,
                canonicalName: AGENT_NAME_MAP[msg.agentId] ?? msg.agentId,
                conversationalName: cooConversationalName,
              }) : null}
              onApprove={handleApprove}
              onReject={handleReject}
              {...(decisionActive ? { onDecision: (value: string) => handleSend(value) } : {})}
              {...(msg.deliveryState ? { deliveryState: msg.deliveryState } : {})}
              {...(msg.deliveryState === "failed" ? { onRetry: () => handleRetry(msg.id) } : {})}
            />
          );
        })}
        {/* Setup action buttons — shown when setup overlay is active */}
        <SetupActionButtonsWrapper isPending={isBusy} />
        {(isBusy || isClearing || buildTasks.size > 0) && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
            {/* Pulsing agent avatar (only while busy) */}
            {(isBusy || isClearing) && (
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "linear-gradient(135deg, color-mix(in srgb, var(--dpf-accent) 30%, transparent), color-mix(in srgb, var(--dpf-accent) 10%, transparent))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 12,
                color: "var(--dpf-accent)",
                flexShrink: 0,
                animation: "dpf-pulse 2s ease-in-out infinite",
              }}
            >
              {agent.agentName.charAt(0)}
            </div>
            )}
            <div
              style={{
                padding: "8px 14px",
                borderRadius: "12px 12px 12px 2px",
                fontSize: 12,
                background: "color-mix(in srgb, var(--dpf-surface-1) 80%, transparent)",
                color: "var(--dpf-muted)",
                display: "flex",
                flexDirection: "column",
                gap: 6,
                maxWidth: "100%",
                minWidth: 0,
              }}
            >
              {/* Current status line — only while busy */}
              {(isBusy || isClearing) && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11 }}>
                {isClearing
                  ? "Clearing conversation"
                  : orchestratorStatus
                    ? orchestratorStatus
                    : currentTool
                      ? `${agentIdentity.primaryName} is using ${currentTool.replace(/_/g, " ")}...`
                      : thinkingSeconds < 5
                        ? `${agentIdentity.primaryName} is thinking`
                        : thinkingSeconds < 15
                          ? `${agentIdentity.primaryName} is working on it`
                          : `${agentIdentity.primaryName} is still working (${thinkingSeconds}s)`}
              </span>
              {/* Animated bouncing dots */}
              <span style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      background: "var(--dpf-accent)",
                      animation: `dpf-bounce 1.4s ease-in-out ${i * 0.16}s infinite`,
                    }}
                  />
                ))}
              </span>
              {/* Governed Hermes learning Slice 1: active skill chip */}
              <AgentSkillAttributionChip skill={activeSkill} />
              {/* EP-ASYNC-COWORKER-001: Cancel button after 15s */}
              {!isClearing && thinkingSeconds >= 15 && threadId && (
                <button
                  type="button"
                  onClick={() => {
                    fetch("/api/agent/cancel", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ threadId }),
                    }).catch(() => {});
                  }}
                  style={{
                    background: "none",
                    border: "1px solid color-mix(in srgb, var(--dpf-text) 15%, transparent)",
                    borderRadius: 999,
                    color: "var(--dpf-muted)",
                    cursor: "pointer",
                    fontSize: 10,
                    lineHeight: 1,
                    padding: "2px 8px",
                    marginLeft: 4,
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
              )}
              {/* Task status board — each task shows its latest state */}
              {buildTasks.size > 0 && (
                <div
                  ref={buildLogRef}
                  style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    borderTop: "1px solid color-mix(in srgb, var(--dpf-border) 50%, transparent)",
                    paddingTop: 6,
                    marginTop: 2,
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  {/* Progress bar */}
                  {buildProgress && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                      <div style={{
                        flex: 1, height: 3, borderRadius: 2,
                        background: "color-mix(in srgb, var(--dpf-border) 50%, transparent)",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 2,
                          background: "var(--dpf-accent)",
                          width: `${buildProgress.total > 0 ? (buildProgress.completed / buildProgress.total) * 100 : 0}%`,
                          transition: "width 0.5s ease",
                        }} />
                      </div>
                      <span style={{ fontSize: 9, color: "var(--dpf-muted)", flexShrink: 0 }}>
                        {buildProgress.completed}/{buildProgress.total}
                      </span>
                    </div>
                  )}
                  {Array.from(buildTasks).map(([title, task]) => {
                    const icon = task.status === "done" ? "\u2713"
                      : task.status === "concern" ? "!"
                      : task.status === "blocked" ? "\u2717"
                      : task.status === "retry" ? "\u21BB"
                      : task.status === "working" ? "\u25CB"
                      : "\u00B7";
                    const color = task.status === "done" ? "var(--dpf-success)"
                      : task.status === "concern" ? "var(--dpf-warning, #e5a100)"
                      : task.status === "blocked" ? "var(--dpf-error)"
                      : task.status === "working" ? "var(--dpf-accent)"
                      : "var(--dpf-muted)";
                    const isActive = task.status === "working";
                    return (
                      <div key={title} style={{
                        display: "flex", alignItems: "center", gap: 6,
                        fontSize: 10, lineHeight: 1.4,
                        opacity: task.status === "done" ? 0.7 : 1,
                      }}>
                        <span style={{
                          color, flexShrink: 0, width: 12, textAlign: "center",
                          fontWeight: isActive ? 700 : 400,
                          animation: isActive ? "dpf-pulse 2s ease-in-out infinite" : "none",
                        }}>{icon}</span>
                        <span style={{
                          flex: 1, minWidth: 0,
                          color: isActive ? "var(--dpf-text)" : "var(--dpf-text-secondary, var(--dpf-muted))",
                          fontWeight: isActive ? 500 : 400,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{title}</span>
                        <span style={{
                          fontSize: 9, color: "color-mix(in srgb, var(--dpf-muted) 60%, transparent)",
                          flexShrink: 0,
                        }}>{task.specialist}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            <style>{`
              @keyframes dpf-bounce {
                0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
                40% { transform: translateY(-5px); opacity: 1; }
              }
              @keyframes dpf-pulse {
                0%, 100% { opacity: 0.6; transform: scale(1); }
                50% { opacity: 1; transform: scale(1.05); }
              }
            `}</style>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <CoworkerHealthStatus />
      <CoworkerPriorityDock agentId={agent.agentId} />
      {effectiveThreadLoadState === "failed" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 10px 6px",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--dpf-error) 35%, transparent)",
            background: "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
            fontSize: 12,
            color: "var(--dpf-text)",
          }}
        >
          <span style={{ flex: 1 }}>Couldn&apos;t load this conversation.</span>
          {onReloadToReconnect && (
            <button
              type="button"
              onClick={onReloadToReconnect}
              style={{
                background: "none",
                border: "1px solid var(--dpf-border)",
                borderRadius: 999,
                color: "var(--dpf-accent)",
                cursor: "pointer",
                fontSize: 12,
                padding: "3px 12px",
              }}
            >
              Reload to reconnect
            </button>
          )}
        </div>
      )}
      {/* BI-836B0304: a valid session whose userId has no matching User row
          (e.g. a stale session surviving a re-seed) can never load a thread —
          retrying or reloading the tab does not fix it. Say so plainly and
          offer the one action that does: sign out and sign back in. */}
      {effectiveThreadLoadState === "invalid-session" && (
        <div
          role="alert"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "0 10px 6px",
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid color-mix(in srgb, var(--dpf-error) 35%, transparent)",
            background: "color-mix(in srgb, var(--dpf-error) 8%, transparent)",
            fontSize: 12,
            color: "var(--dpf-text)",
          }}
        >
          <span style={{ flex: 1 }}>
            Your sign-in session is no longer valid. Sign in again to continue.
          </span>
          <form action={signOutAction}>
            <button
              type="submit"
              style={{
                background: "none",
                border: "1px solid var(--dpf-border)",
                borderRadius: 999,
                color: "var(--dpf-accent)",
                cursor: "pointer",
                fontSize: 12,
                padding: "3px 12px",
              }}
            >
              Sign in again
            </button>
          </form>
        </div>
      )}
      <AgentMessageInput
        onSend={handleSend}
        composerState={composerState}
        busy={isBusy}
        threadId={threadId}
        pendingFile={pendingAttachment}
        onFileUploaded={setPendingAttachment}
        onFileClear={() => setPendingAttachment(null)}
        voiceSynthAvailable={voiceSynth.available}
        voiceSynthChecking={voiceSynth.checking}
        voicePlaybackUnavailableReason={voiceSynth.unavailableReason}
        voicePlaybackEnabled={voicePlaybackEnabled}
        onVoicePlaybackToggle={toggleVoicePlayback}
        elevatedAssistEnabled={elevatedAssistEnabled}
        onToggleElevatedAssist={handleToggleElevatedAssist}
        externalAccessEnabled={webAccessAvailable && externalAccessEnabled}
        onToggleExternalAccess={handleToggleExternalAccess}
        webAccessAvailable={webAccessAvailable}
        coworkerMode={coworkerMode}
        onToggleCoworkerMode={handleToggleCoworkerMode}
        useUnified={useUnifiedCoworker}
      />
    </>
  );
}
