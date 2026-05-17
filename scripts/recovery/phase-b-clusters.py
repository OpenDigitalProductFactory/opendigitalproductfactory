#!/usr/bin/env python3
"""
Phase B / cluster definitions for backlog reconstruction.

Each cluster maps to one Epic plus N BacklogItems. The data here was harvested
from the post-2026-04-27 evidence survey (worktrees, specs, plans, audits,
migrations, merged PRs, memory files). Pre-allocated BI-* item IDs are
preserved verbatim — they were issued by the wiped backlog and are referenced
by merged PR titles/bodies, so reusing them preserves audit linkage.

Status rules (per Mark's autonomous directive 2026-05-17):
  - "done" when a merged PR closes the unit of work (commit/PR/verification
    evidence required per AGENTS.md §6).
  - "in-progress" when an active worktree or non-merged branch exists.
  - "open" for spec/plan-only items.
  - "deferred" for stale April-27 epics with no post-April-27 PR activity.

Provenance: every reconstructed body carries
  [recovery-note:provenance:phase-b:2026-05-17:<source>]
where <source> is the strongest evidence (typically "pr-<n>" or "spec-<path>").
"""
from __future__ import annotations

from datetime import datetime
from typing import Literal, TypedDict


class ItemSeed(TypedDict, total=False):
    # When known from harvested PR titles/bodies, preserve the exact ID.
    itemId: str
    title: str
    body: str
    status: Literal["open", "in-progress", "done", "deferred"]
    type: Literal["portfolio", "product"]
    priority: int
    source: str            # provenance source short label
    evidence_prs: list[int]   # merged PR numbers that justify status
    evidence_spec: str | None
    evidence_plan: str | None
    evidence_worktree: str | None


class EpicSeed(TypedDict, total=False):
    epicId: str
    title: str
    description: str
    status: Literal["open", "in-progress", "done", "deferred"]
    items: list[ItemSeed]
    # If true, this epic already exists in the April-27 baseline and we will
    # UPDATE its status/description rather than INSERT. The items still INSERT.
    existing: bool


# ──────────────────────────────────────────────────────────────────────────
# Stale April-27 epics → mark deferred with recovery-note
# ──────────────────────────────────────────────────────────────────────────
APRIL27_STALE_DEFER: list[str] = [
    # Per survey + my judgment: no post-Apr-27 PR activity touching these
    "EP-ARCH-8D4F2A",   # "Archetype Model V2" — 1 item, no recent activity
    "EP-LAB-6A91C2",    # "Integration Lab Sandbox" — survey shows no extensions
]

# Epics that stay open because survey shows active extensions
APRIL27_KEEP_OPEN: list[str] = [
    "EP-INT-2E7C1A",    # Integration Harness — extended by voice, ADP, MCP, etc.
    "EP-CTRL-5E21A4",   # Automated Control Utility — extended by edge-node, capsules, runtime
    "EP-BUILD-CC1BD8",  # Build Studio header — extended by CWS-BUILD-STUDIO
    "EP-TAK-3F9A21",    # TAK/GAID — extended by wiki, agents-doc
    "EP-SITE-7C4D2B",   # Customer Site Records — extended by installer
]

# Already-done epics stay done
APRIL27_KEEP_DONE: list[str] = [
    "EP-BUILD-9F749C",  # Code Graph Ship Test
    "EP-TAX-6C82D1",    # Tax Remittance — note: extended by CWS-FINANCE-TAX (continues under same epic)
]


# ──────────────────────────────────────────────────────────────────────────
# New epics
# ──────────────────────────────────────────────────────────────────────────

# Use short, stable epicIds that align with the cluster slugs. Original epic
# cuid IDs from the pre-wipe state are unknown (lost with the wipe), so the
# Epic.id column will be regenerated; what matters is the semantic epicId.

CLUSTERS: list[EpicSeed] = [
    # ── CWS-EDGE-NODE ─────────────────────────────────────────────────────
    {
        "epicId": "EP-EDGE-NODE",
        "title": "DPF Edge Node — discovery, bootstrap, multi-host LAN, air-gap",
        "description": (
            "Phases -1/0/1 + Mode 4 + T2/T3 native binaries + macOS/Linux/Windows "
            "support + air-gapped install. Discovery collectors (ARP/nmap/SNMP), "
            "principal convergence for edge nodes, mTLS hardening, EV signing."
        ),
        "status": "in-progress",
        "items": [
            {"itemId": "BI-4C4D9F05", "title": "Edge Node Phase -1 spec promotion", "status": "done", "evidence_prs": [491], "source": "pr-491"},
            {"itemId": "BI-AB4069FF", "title": "Principal convergence for EdgeNode + MobileDevice + ServiceAccount", "status": "done", "evidence_prs": [500], "source": "pr-500"},
            {"title": "Edge Node Phase 0: A1–A10 implementation slices", "status": "done", "evidence_prs": [493, 521, 517, 528], "source": "pr-528"},
            {"title": "Edge Node C1: ARP-table collector", "status": "done", "evidence_prs": [567], "source": "pr-567"},
            {"title": "Edge Node C2: nmap subnet sweep with operator allow-list", "status": "done", "evidence_prs": [575], "source": "pr-575"},
            {"title": "Edge Node C3: SNMP poll collector", "status": "done", "evidence_prs": [582], "source": "pr-582"},
            {"title": "Edge Node T2: docker-compose.edge-standalone.yml + multi-host runbook", "status": "done", "evidence_prs": [553, 555], "source": "pr-553"},
            {"title": "Edge Node T3: Windows + macOS native binary", "status": "in-progress", "evidence_worktree": "DPF-edge-mode4-t3", "source": "worktree-edge-mode4-t3"},
            {"title": "Edge Node T4: macOS/Windows installer + verify-install-edge.sh", "status": "done", "evidence_prs": [654, 666, 690], "source": "pr-690"},
            {"title": "Edge Node T5: air-gapped install runbook + verification harness", "status": "done", "evidence_prs": [586], "source": "pr-586"},
            {"title": "Edge Node Phase 1: mTLS hardening (planning)", "status": "open", "evidence_plan": "2026-05-13-edge-node-phase1-mtls-hardening.md"},
            {"title": "Edge Node EV cert for Authenticode signing", "status": "done", "evidence_prs": [669], "source": "pr-669"},
            {"title": "Edge Node Mode 4 design + spec", "status": "in-progress", "evidence_worktree": "DPF-edge-mode4", "source": "worktree-edge-mode4"},
            {"title": "Edge Node runtime decision (mode 2 / mode 4)", "status": "done", "evidence_prs": [651], "evidence_spec": "2026-05-16-edge-node-runtime-decision.md", "source": "pr-651"},
        ],
    },

    # ── CWS-WIKI-KERNEL ───────────────────────────────────────────────────
    {
        "epicId": "EP-WIKI-001",
        "title": "Platform Kernel Wiki (founder-kernel + bi-temporal + PPR + visual nav)",
        "description": (
            "Wiki kernel substrate: schema, recall path, bi-temporal revisions, "
            "importance/reflection, PPR retrieval, visual navigation. Founder "
            "kernel 0.2.0 publication. Foundation for principles + hive-scout bridge."
        ),
        "status": "in-progress",
        "items": [
            {"title": "EP-WIKI-001 Phase 1a — schema + seed-compatible upsert", "status": "done", "evidence_prs": [399, 408, 469], "source": "pr-469"},
            {"title": "EP-WIKI-001 Phase 2a — Qdrant overlay search", "status": "done", "evidence_prs": [415], "source": "pr-415"},
            {"title": "EP-WIKI-001 Phase 3 — prompt-assembler recall", "status": "done", "evidence_prs": [419, 421, 432, 449], "source": "pr-449"},
            {"title": "EP-WIKI-001 Phase 4 — wiki_lint MCP tool", "status": "done", "evidence_prs": [466], "source": "pr-466"},
            {"title": "EP-WIKI-001 Phase 5 — wiki_query MCP tool", "status": "done", "evidence_prs": [453], "source": "pr-453"},
            {"title": "EP-WIKI-001 Phase 6 — viewer/edit UI", "status": "done", "evidence_prs": [430, 433, 434, 436, 439, 443], "source": "pr-443"},
            {"title": "Founder kernel 0.2.0 draft + publish 19 pages", "status": "done", "evidence_prs": [482, 547], "source": "pr-547"},
            {"title": "EP-WIKI-002 — bi-temporal revisions design", "status": "open", "evidence_spec": "2026-05-09-wiki-bi-temporal-revisions-design.md"},
            {"title": "EP-WIKI-003 — importance + reflection design", "status": "open", "evidence_spec": "2026-05-09-wiki-importance-and-reflection-design.md"},
            {"title": "EP-WIKI-004 — PPR retrieval design", "status": "open", "evidence_spec": "2026-05-09-wiki-ppr-retrieval-design.md"},
            {"title": "EP-WIKI-005 — visual navigation design", "status": "open", "evidence_spec": "2026-05-09-wiki-visual-navigation-design.md"},
            {"title": "Consumer-archetype UI (wiki principles grouping)", "status": "in-progress", "evidence_worktree": "wiki-consumer-archetype-ui", "evidence_prs": [625, 631, 671], "source": "worktree-wiki-consumer-archetype-ui"},
            {"title": "Hive Scout → wiki bridge Slice 1", "status": "done", "evidence_prs": [646], "source": "pr-646"},
            {"title": "Hive Scout → wiki bridge Slice 2 (planning)", "status": "open", "evidence_plan": "wiki-bridge-slice-2"},
        ],
    },

    # ── CWS-PRINCIPLES ────────────────────────────────────────────────────
    {
        "epicId": "EP-PRINCIPLES",
        "title": "Principles as wiki kind + decision substrate (vectors)",
        "description": (
            "Principles authored as a typed wiki kind. Tiered governance "
            "(commandment/principle/pattern/rule). Decision-making via vector-"
            "matrix aggregation. AGENTS.md principle promotion. Batches 0–4c + "
            "consumer-archetype filtering + principle_decide MCP."
        ),
        "status": "in-progress",
        "items": [
            {"itemId": "BI-EBDFBA34", "title": "Principles foundation — schema, authoring contract, batches (parent)", "status": "done", "evidence_prs": [518, 524, 531, 538, 542, 564, 566, 570, 571, 579, 589, 592, 601], "source": "pr-601"},
            {"title": "Principles Batch 0 — schema + constants + authoring contract", "status": "done", "evidence_prs": [531], "source": "pr-531"},
            {"title": "Principles Batch 1 — first 8 commandments", "status": "done", "evidence_prs": [538], "source": "pr-538"},
            {"title": "Principles Batch 2 — retrieval MCP + principle_decide", "status": "done", "evidence_prs": [542, 564], "source": "pr-564"},
            {"title": "Principles Batch 3a/3b — AI coworker dev principles", "status": "done", "evidence_prs": [566, 570], "source": "pr-570"},
            {"title": "Principles Batch 4a/4b/4c", "status": "done", "evidence_prs": [579, 589, 592], "source": "pr-592"},
            {"title": "Principles as vectors — decision aggregation", "status": "open", "source": "memory-project_principles_as_vectors"},
            {"title": "Re-baseline against AGENTS.md principle inventory audit", "status": "done", "evidence_prs": [625], "source": "pr-625"},
        ],
    },

    # ── CWS-WORK-CAPSULES ─────────────────────────────────────────────────
    {
        "epicId": "EP-CAPSULE",
        "title": "Portal Work Capsule control harness (Phases 1/2/3)",
        "description": (
            "Sandboxed governed work capsules for coding agents. Phase 1 verification "
            "harness. Phase 2 governed creation + lease auto-renew + expose scopes "
            "to coding agents. Phase 3 plan-only. Migration adds the capsule table."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Work Capsule Phase 1 — verification harness", "status": "done", "evidence_prs": [596, 602, 603], "source": "pr-596"},
            {"title": "Work Capsule Phase 2 — governed creation (display-and-record)", "status": "done", "evidence_prs": [665, 675], "source": "pr-675"},
            {"title": "Work Capsule Phase 2 — expose scopes to coding agents", "status": "done", "evidence_prs": [604], "source": "pr-604"},
            {"title": "Work Capsule Phase 2 — auto-renew leases on capsule writes", "status": "done", "evidence_prs": [703], "source": "pr-703"},
            {"title": "Work Capsule Phase 2 — verification test hardening", "status": "done", "evidence_prs": [672], "source": "pr-672"},
            {"title": "Work Capsule Phase 3 — plan", "status": "in-progress", "evidence_worktree": "work-capsule-phase-3", "evidence_plan": "2026-05-17-portal-work-capsule-control-harness-phase-3.md", "source": "worktree-wc-phase-3"},
        ],
    },

    # ── CWS-VOICE ─────────────────────────────────────────────────────────
    {
        "epicId": "EP-VOICE",
        "title": "Voice input + transcription (Slice 1)",
        "description": (
            "Push-to-talk dictation on the AI Coworker panel. Whisper sidecar "
            "(speaches) via the EP-INF-009c transcription execution adapter. "
            "Safari MIME compat. Admin readiness card. Slice 1 closed."
        ),
        "status": "done",
        "items": [
            {"title": "Voice Slice 1 spec", "status": "done", "evidence_prs": [668], "source": "pr-668"},
            {"title": "Voice Slice 1 implementation plan", "status": "done", "evidence_prs": [670], "source": "pr-670"},
            {"title": "Voice Slice 1 pre-implementation gate decisions", "status": "done", "evidence_prs": [678], "source": "pr-678"},
            {"title": "Voice Slice 1 Chunk 1 — vad-web dep + speaches seed + docker-compose", "status": "done", "evidence_prs": [686], "source": "pr-686"},
            {"title": "Voice Slice 1 Chunk 2 — /api/transcribe + adapter composition + architecture test", "status": "done", "evidence_prs": [692], "source": "pr-692"},
            {"title": "Voice Slice 1 Chunk 3 — mic surface in AI Coworker panel", "status": "done", "evidence_prs": [696], "source": "pr-696"},
            {"title": "Voice Slice 1 Chunk 4 — admin readiness card + manual UX checklist (closes Slice 1)", "status": "done", "evidence_prs": [700], "source": "pr-700"},
            {"title": "Voice Slice 1 manual UX verification checklist execution", "status": "open", "source": "audit-2026-05-16-voice-slice-1-manual-verification"},
        ],
    },

    # ── CWS-HIVE-SCOUT ────────────────────────────────────────────────────
    {
        "epicId": "EP-HIVE-SCOUT",
        "title": "Hive Scout autonomous coworker",
        "description": (
            "Autonomous coworker that scouts gaps + ingests evidence into the "
            "wiki + summarizes review breakdowns. V1 + V2 (ambiguity review + "
            "bounded triage) + V3 (proceduralization loop) + wiki bridge."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Hive Scout autonomous coworker design", "status": "done", "evidence_spec": "2026-05-11-hive-scout-autonomous-coworker-design.md", "evidence_prs": [486], "source": "pr-486"},
            {"title": "Hive Scout TaskRun Phase 1", "status": "done", "evidence_prs": [488], "source": "pr-488"},
            {"title": "Hive Scout v2 — ambiguity review + bounded triage", "status": "done", "evidence_prs": [617, 620, 624], "source": "pr-624"},
            {"title": "Hive Scout v3 — proceduralization loop (plan)", "status": "open", "evidence_plan": "2026-05-15-hive-scout-v3-proceduralization-loop.md"},
            {"title": "Hive Scout summarize review breakdowns", "status": "done", "evidence_prs": [674], "source": "pr-674", "evidence_worktree": "hive-scout-summary-breakdowns"},
            {"title": "Hive Scout wikipage synthesis Slice 1", "status": "done", "evidence_prs": [643, 646], "source": "pr-646"},
            {"title": "Hive Scout wikipage synthesis Slice 2 (planning)", "status": "open", "evidence_plan": "wiki-bridge-slice-2"},
        ],
    },

    # ── CWS-ROUTING-SUBSTRATE ─────────────────────────────────────────────
    {
        "epicId": "EP-ROUTING-11",
        "title": "Routing substrate attempt #11 + CLI/execution adapters",
        "description": (
            "Routing control vs data plane separation. CLI execution adapter as "
            "routing dimension. Coworker execution adapter substrate. UX "
            "verification test architecture. Adapter capability + run telemetry."
        ),
        "status": "in-progress",
        "items": [
            {"itemId": "BI-28858D2F", "title": "Routing CI invariants — boot-time spec checks", "status": "done", "evidence_prs": [309, 310], "source": "pr-310"},
            {"itemId": "BI-54411FE8", "title": "Routing substrate rename to capabilityCategory", "status": "done", "evidence_prs": [310], "source": "pr-310"},
            {"itemId": "BI-6B87B3BF", "title": "Routing fix #11 fixes batch", "status": "done", "evidence_prs": [310], "source": "pr-310"},
            {"itemId": "BI-A58F94A2", "title": "Routing fix — adapter capability profile", "status": "done", "evidence_prs": [310], "source": "pr-310"},
            {"itemId": "BI-678A7C7D", "title": "Routing fix #11 follow-up", "status": "done", "evidence_prs": [309], "source": "pr-309"},
            {"itemId": "BI-7D4AF644", "title": "Routing fix #11 follow-up", "status": "done", "evidence_prs": [309], "source": "pr-309"},
            {"itemId": "BI-A810C880", "title": "Routing fix #11 follow-up", "status": "done", "evidence_prs": [309], "source": "pr-309"},
            {"itemId": "BI-931303FF", "title": "CLI native tool suppression", "status": "done", "evidence_prs": [405], "source": "pr-405"},
            {"title": "CLI execution adapter as routing dimension — Phase A", "status": "done", "evidence_prs": [650], "source": "pr-650"},
            {"title": "Coworker execution adapter substrate", "status": "in-progress", "evidence_spec": "2026-04-29-coworker-execution-adapter-substrate-design.md", "evidence_prs": [520, 528, 529]},
            {"title": "AI Routing UX verification test architecture", "status": "done", "evidence_prs": [450, 649], "source": "pr-649"},
            {"title": "AI routing topology map", "status": "in-progress", "evidence_worktree": "ai-routing-topology-map", "source": "worktree-ai-routing-topology-map"},
            {"title": "Routing control/data plane separation", "status": "open", "evidence_spec": "2026-04-27-routing-control-data-plane-design.md"},
            {"title": "Coworker chat: Anthropic CLI dispatch failures + Gemini tools-schema bug + Codex 403 (PROD BLOCKER)", "status": "open", "source": "live-telemetry-2026-05-17", "priority": 100},
            {"title": "AdapterRunTelemetry — record agentId + thread + httpStatus + refusalReason", "status": "done", "evidence_prs": [685, 691, 694], "source": "pr-685"},
        ],
    },

    # ── CWS-COWORKER-RUNTIME ──────────────────────────────────────────────
    {
        "epicId": "EP-COWORKER-RT",
        "title": "Autonomous Coworker Runtime + Persona/Grant audit",
        "description": (
            "Autonomous Coworker Runtime — extracted runtime service. AI capacity "
            "continuity. C1 persona authorship batches 1–16 + grant reconciliation. "
            "Self-assessment foundation. Coworker memory shape contracts. "
            "Subsumed: orchestration primitives (per supersession audit)."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Autonomous Coworker Runtime design + slice 1", "status": "done", "evidence_spec": "2026-05-11-autonomous-coworker-runtime-design.md", "evidence_prs": [468], "source": "pr-468"},
            {"title": "AI Capacity Continuity — runtime attachment foundation", "status": "done", "evidence_prs": [489], "source": "pr-489"},
            {"title": "C1 persona authorship batches 1–16", "status": "done", "evidence_prs": [312, 316, 317, 322, 327, 328, 329, 330, 331, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341, 342, 343, 344, 345, 346, 347], "source": "pr-347"},
            {"title": "Coworker grant reconciliation", "status": "done", "evidence_prs": [507, 534, 539, 544], "source": "pr-544"},
            {"itemId": "BI-56469E47", "title": "Coworker self-assessment foundation", "status": "done", "evidence_prs": [412], "source": "pr-412", "evidence_worktree": "DPF-coworker-self-assessment-foundation"},
            {"itemId": "BI-F026ADD0", "title": "CoworkerCapabilityNeed surface", "status": "done", "evidence_prs": [426], "source": "pr-426"},
            {"title": "Coworker persona audit (2026-04-27)", "status": "done", "evidence_spec": "2026-04-27-coworker-persona-audit-design.md", "source": "audit-2026-04-27"},
            {"title": "Coworker tool-grant spec + audit", "status": "done", "evidence_spec": "2026-04-27-coworker-tool-grant-spec-design.md", "source": "audit-2026-04-27"},
            {"title": "Coworker memory shape contracts", "status": "open", "evidence_spec": "2026-05-14-coworker-memory-shape-contracts-design.md", "evidence_prs": [605], "source": "pr-605"},
            {"title": "Coworker c-status + A2A sequencing", "status": "in-progress", "evidence_worktree": "DPF-coworker-assess", "source": "worktree-DPF-coworker-assess"},
            {"title": "Orchestration primitives (SUPERSEDED — see autonomous coworker runtime)", "status": "deferred", "evidence_spec": "2026-04-29-orchestration-primitives-design.md", "source": "audit-2026-04-29-supersession"},
        ],
    },

    # ── CWS-INSTALLER ─────────────────────────────────────────────────────
    {
        "epicId": "EP-INSTALLER",
        "title": "Installer parity — macOS + Linux + Cloud single-VM",
        "description": (
            "DPF installer with parity across Windows (existing), macOS, Linux. "
            "Phases 1–10 of install + uninstall. Cloud single-VM Phase 0 plan. "
            "Multi-arch GHCR publish. Docker Desktop .dmg. LaunchAgent/systemd-user."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Installer deployment doctrine + roadmap", "status": "done", "evidence_prs": [400, 404], "source": "pr-404"},
            {"title": "Installer multi-arch GHCR publish", "status": "done", "evidence_prs": [401, 409], "source": "pr-409"},
            {"title": "install-dpf.sh framework + Phase 1–6", "status": "done", "evidence_prs": [411, 414, 416], "source": "pr-416"},
            {"title": "install-dpf.sh Phase 7a — Linux end-to-end", "status": "done", "evidence_prs": [416], "source": "pr-416"},
            {"title": "install-dpf.sh Phase 7b — macOS Docker Desktop .dmg", "status": "done", "evidence_prs": [425], "source": "pr-425"},
            {"title": "install-dpf.sh Phase 7c — LaunchAgent + systemd-user autostart", "status": "done", "evidence_prs": [427], "source": "pr-427"},
            {"title": "install-dpf.sh Phase 10a — port-conflict preflight", "status": "done", "evidence_prs": [441], "source": "pr-441"},
            {"title": "uninstall-dpf.sh tiers", "status": "done", "evidence_prs": [440, 447, 452], "source": "pr-452"},
            {"title": "Cloud single-VM Phase 0 roadmap", "status": "open", "evidence_plan": "2026-05-17-cloud-single-vm-phase0-roadmap.md"},
            {"title": "verify-install-edge.sh — macOS-specific checks", "status": "done", "evidence_prs": [690], "source": "pr-690"},
            {"title": "macOS + Linux native support plan", "status": "in-progress", "evidence_plan": "2026-05-09-macos-linux-native-support.md"},
        ],
    },

    # ── CWS-LICENSING ─────────────────────────────────────────────────────
    {
        "epicId": "EP-LICENSING",
        "title": "Licensing / Permit / Jurisdiction readiness foundation",
        "description": (
            "Archetype-aligned compliance foundation. Licensing readiness substrate. "
            "Coworker investigation flow for licensing/permits/jurisdictions."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Licensing/Permit/Jurisdiction readiness — foundation spec", "status": "done", "evidence_spec": "2026-05-11-licensing-permit-jurisdiction-readiness-design.md"},
            {"title": "Licensing readiness foundation plan + impl", "status": "done", "evidence_prs": [484, 485], "source": "pr-485"},
            {"title": "Licensing coworker investigation flow", "status": "in-progress", "evidence_worktree": "licensing-coworker-investigation", "evidence_prs": [505], "source": "pr-505"},
        ],
    },

    # ── CWS-COMM-FABRIC ───────────────────────────────────────────────────
    {
        "epicId": "EP-COMM-FABRIC",
        "title": "Employee Communication Fabric",
        "description": (
            "Channel adapters (in-app/push/email/teams/slack/whatsapp/telegram/webhook). "
            "Inbound normalization. Delivery evidence. Reconciled with autonomous "
            "coworker runtime + WhatsApp Secretary spec trio."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Employee Communication Fabric — design spec", "status": "done", "evidence_spec": "2026-05-15-employee-communication-fabric-design.md"},
            {"title": "Channel bindings management foundation (Slice 0/1)", "status": "done", "evidence_prs": [619, 628], "source": "pr-628"},
            {"title": "Spec reconciliation — fabric + runtime + WhatsApp trio", "status": "done", "evidence_prs": [645], "source": "pr-645"},
            {"title": "Teams adapter (Slice 2)", "status": "open", "source": "plan-2026-05-15-employee-communication-fabric"},
            {"title": "WhatsApp Secretary (Slice 3)", "status": "open", "source": "plan-2026-05-15-employee-communication-fabric"},
        ],
    },

    # ── CWS-HERMES-SKILLS ─────────────────────────────────────────────────
    {
        "epicId": "EP-HERMES-SKILLS",
        "title": "Hermes — governed skill telemetry / curation / lifecycle / evidence search",
        "description": (
            "Skill telemetry + reflection. Skill revisions + proposals. Skill curator + "
            "lifecycle state machine. Governed evidence search for coworkers."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Hermes governed learning loop design", "status": "done", "evidence_spec": "2026-05-15-governed-hermes-learning-loop-design.md"},
            {"title": "Hermes Slices 1+2 — telemetry + reflection", "status": "done", "evidence_prs": [629], "source": "pr-629"},
            {"title": "Hermes Slice 3 — skill revisions + proposals", "status": "done", "evidence_prs": [634], "source": "pr-634"},
            {"title": "Hermes Slice 4 — skill curator + lifecycle", "status": "done", "evidence_prs": [638], "source": "pr-638"},
            {"title": "Hermes evidence search for coworkers", "status": "done", "evidence_prs": [676], "source": "pr-676", "evidence_worktree": "hermes-evidence-session-search"},
        ],
    },

    # ── CWS-AI-OPSMAP ─────────────────────────────────────────────────────
    {
        "epicId": "EP-AI-OPSMAP",
        "title": "AI Operations Map + Discovery triage + functional-failure routing",
        "description": (
            "AI Coworker visual control surface. Ops Map v1. Discovery triage "
            "bounded review substrate. Functional failure → backlog evidence."
        ),
        "status": "in-progress",
        "items": [
            {"title": "AI Coworker visual control surface design", "status": "done", "evidence_spec": "2026-05-10-ai-coworker-visual-control-surface-design.md"},
            {"title": "Ops Map v1 implementation", "status": "done", "evidence_prs": [429, 438, 445], "source": "pr-445"},
            {"itemId": "BI-D0EC01F9", "title": "Functional failure → ops review routing", "status": "done", "evidence_prs": [475], "source": "pr-475"},
            {"itemId": "BI-594D404E", "title": "Triage taxonomy FK fix", "status": "done", "evidence_prs": [563, 476], "source": "pr-476"},
            {"itemId": "BI-942F3D00", "title": "Triage FK fix follow-up", "status": "done", "evidence_prs": [476], "source": "pr-476"},
            {"title": "Discovery triage bounded review substrate", "status": "done", "evidence_prs": [624], "evidence_worktree": "discovery-triage-runtime-receipts", "source": "pr-624"},
        ],
    },

    # ── CWS-BUSINESS-CAPABILITY ───────────────────────────────────────────
    {
        "epicId": "EP-BIZ-CAP",
        "title": "Business Capability Map / Taxonomy / Employee Work",
        "description": (
            "Business capability taxonomy + map + employee work taxonomy. "
            "Backlog captured in PR #702 with 8 pre-allocated BI-* IDs."
        ),
        "status": "open",
        "items": [
            {"title": "Business capability + employee work taxonomy plan", "status": "done", "evidence_prs": [702], "source": "pr-702"},
            {"itemId": "BI-03AD102F", "title": "Business capability backlog item 1", "status": "open", "source": "pr-702"},
            {"itemId": "BI-1A81A968", "title": "Business capability backlog item 2", "status": "open", "source": "pr-702"},
            {"itemId": "BI-1E0454C3", "title": "Business capability backlog item 3", "status": "open", "source": "pr-702"},
            {"itemId": "BI-2A091DE5", "title": "Business capability backlog item 4", "status": "open", "source": "pr-702"},
            {"itemId": "BI-77947024", "title": "Business capability backlog item 5", "status": "open", "source": "pr-702"},
            {"itemId": "BI-937007D0", "title": "Business capability backlog item 6", "status": "open", "source": "pr-702"},
            {"itemId": "BI-B61A119C", "title": "Business capability backlog item 7", "status": "open", "source": "pr-702"},
            {"itemId": "BI-DEFE785B", "title": "Business capability backlog item 8", "status": "open", "source": "pr-702"},
            {"title": "Business capability map worktree", "status": "in-progress", "evidence_worktree": "DPF-business-capability-map"},
        ],
    },

    # ── CWS-SMALL-BIZ-OS ──────────────────────────────────────────────────
    {
        "epicId": "EP-SBO",
        "title": "Small Business OS parity (QuickBooks anchor + readiness audit)",
        "description": (
            "Small business OS parity — command center, readiness audit, QuickBooks "
            "accounting readiness snapshot."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Business OS command center design + impl", "status": "done", "evidence_prs": [626], "source": "pr-626"},
            {"title": "Business OS readiness audit", "status": "done", "evidence_prs": [635], "source": "pr-635"},
            {"itemId": "BI-AA303B6F", "title": "QuickBooks accounting readiness snapshot", "status": "done", "evidence_prs": [698], "source": "pr-698"},
            {"title": "Small business OS parity plan (worktree)", "status": "in-progress", "evidence_worktree": "DPF-small-business-os-parity"},
        ],
    },

    # ── CWS-MARKETING ─────────────────────────────────────────────────────
    {
        "epicId": "EP-MARKETING",
        "title": "Marketing coworker + native readiness (WhatsApp / Instagram / GMB)",
        "description": (
            "Marketing work products substrate. Native readiness for WhatsApp "
            "Business, Instagram, Google My Business. TAK/GAID memory freshness. "
            "Public-DOCX article generation."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Marketing work products substrate + migrations", "status": "done", "evidence_prs": [358, 359, 367, 371], "source": "pr-371"},
            {"title": "WhatsApp Business readiness", "status": "done", "evidence_prs": [377], "source": "pr-377"},
            {"title": "Instagram readiness", "status": "done", "evidence_prs": [383], "source": "pr-383"},
            {"title": "GMB media preview", "status": "done", "evidence_prs": [388], "source": "pr-388"},
            {"title": "TAK/GAID memory freshness", "status": "done", "evidence_prs": [355], "source": "pr-355"},
            {"title": "Marketing backlog handoff (worktree)", "status": "in-progress", "evidence_worktree": "DPF-marketing-backlog-handoff"},
            {"title": "Public DOCX article generation", "status": "in-progress", "evidence_worktree": "DPF-public-docx-article"},
        ],
    },

    # ── CWS-WORKTREE-HYGIENE ──────────────────────────────────────────────
    {
        "epicId": "EP-WORKTREE-HYGIENE",
        "title": "Worktree hygiene janitor",
        "description": (
            "Worktree hygiene janitor — automated cleanup of stale worktrees + "
            "compose project name isolation. Spec + plan landed; impl pending."
        ),
        "status": "open",
        "items": [
            {"title": "Worktree hygiene spec", "status": "done", "evidence_prs": [653], "source": "pr-653"},
            {"title": "Worktree hygiene plan", "status": "done", "evidence_prs": [679], "source": "pr-679"},
            {"title": "Worktree hygiene janitor implementation", "status": "open", "evidence_worktree": "worktree-hygiene"},
            {"title": "COMPOSE_PROJECT_NAME isolation per worktree (FIX FOR PGDATA WIPE RCA)", "status": "open", "source": "rca-2026-05-17"},
        ],
    },

    # ── CWS-DEPS-SWEEP ────────────────────────────────────────────────────
    {
        "epicId": "EP-DEPS-SWEEP",
        "title": "Dependabot / security alert sweep",
        "description": "Rolling chore: dependency overrides + security alert reductions.",
        "status": "in-progress",
        "items": [
            {"title": "Dependabot sweep — Q2 2026", "status": "in-progress", "evidence_prs": [389, 391, 393, 394, 395, 396, 397, 398, 640, 641, 642, 652, 680, 681, 682, 683, 684, 687], "source": "pr-687", "evidence_worktree": "DPF-dependabot-sweep"},
        ],
    },

    # ── CWS-LOCAL-AI ──────────────────────────────────────────────────────
    {
        "epicId": "EP-LOCAL-AI",
        "title": "Local AI / Qwen3 / embedding model catalog",
        "description": (
            "Local AI model catalog. Qwen3 tier fix. Provider-aware embedding-model "
            "setup. Unified coworker routing view."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Provider-aware embedding-model setup Phase 4", "status": "done", "evidence_prs": [410], "source": "pr-410"},
            {"title": "Qwen3 catalog + tier fix + unified coworker routing view", "status": "done", "evidence_prs": [689], "source": "pr-689"},
        ],
    },

    # ── CWS-MCP-TOOLS ─────────────────────────────────────────────────────
    {
        "epicId": "EP-MCP",
        "title": "MCP tooling + token onboarding + connectivity hardening",
        "description": (
            "MCP token CLI. Token onboarding bug fix. Governed tool lifecycle "
            "hooks. Env-allowlist. Connectivity onboarding harden. Protocol-version "
            "negotiation."
        ),
        "status": "in-progress",
        "items": [
            {"title": "MCP token onboarding bug fix", "status": "done", "evidence_prs": [307], "source": "pr-307"},
            {"title": "Governed tool lifecycle hooks", "status": "done", "evidence_prs": [431], "source": "pr-431"},
            {"title": "MCP env-allowlist hardening", "status": "done", "evidence_prs": [516, 519], "source": "pr-519"},
            {"title": "issue-mcp-token CLI", "status": "done", "evidence_prs": [688], "source": "pr-688"},
            {"title": "MCP protocol version negotiate", "status": "done", "evidence_prs": [705], "source": "pr-705"},
        ],
    },

    # ── CWS-FINANCE-TAX (under EP-TAX-6C82D1, extending) ─────────────────
    # Note: keeping items under existing EP-TAX-6C82D1 epic; would need
    # special handling. For simplicity, fold into a new EP-FINANCE since
    # the original is `done`.
    {
        "epicId": "EP-FINANCE",
        "title": "Finance — tax remittance + income vs expenses + period summary",
        "description": (
            "Tax remittance execution automation. Tax run confirmation. Income vs "
            "expenses canonical tool. Finance period summary."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Tax remittance execution automation", "status": "done", "evidence_prs": [370], "source": "pr-370"},
            {"title": "Tax run confirmation surface", "status": "done", "evidence_prs": [381], "source": "pr-381"},
            {"title": "Tax remittance setup wizard", "status": "done", "evidence_prs": [512], "source": "pr-512"},
            {"title": "Tax research proposals", "status": "done", "evidence_prs": [526], "source": "pr-526"},
            {"title": "Canonical income-vs-expenses tool for finance-agent", "status": "done", "evidence_prs": [609], "source": "pr-609"},
            {"title": "Finance period summary", "status": "done", "evidence_prs": [614], "source": "pr-614"},
        ],
    },

    # ── CWS-CW-MEMORY (covered under CWS-COWORKER-RUNTIME already) ───────
    # ── CWS-CODE-GRAPH ────────────────────────────────────────────────────
    {
        "epicId": "EP-CODE-GRAPH",
        "title": "Code Intelligence Graph adoption",
        "description": (
            "Code-graph substrate adoption — design + adoption plan + real-work "
            "benchmark + initial impl."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Code Intelligence Graph design", "status": "done", "evidence_spec": "2026-05-13-code-intelligence-graph-adoption-design.md"},
            {"title": "Code Intelligence Graph adoption plan", "status": "done", "evidence_plan": "2026-05-13-code-intelligence-graph-adoption.md"},
            {"title": "Code Intelligence Graph real-work benchmark", "status": "done", "evidence_prs": [543, 558, 560], "source": "pr-560"},
        ],
    },

    # ── CWS-DOC-MGMT ──────────────────────────────────────────────────────
    {
        "epicId": "EP-DOC-MGMT",
        "title": "Document Management capability",
        "description": (
            "Managed document store foundation + workspace UX integration."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Document management capability spec", "status": "done", "evidence_spec": "2026-05-12-document-management-capability.md"},
            {"title": "Managed document foundation + workspace UX", "status": "done", "evidence_prs": [525, 530], "source": "pr-530"},
        ],
    },

    # ── CWS-HITL-MOBILE ───────────────────────────────────────────────────
    {
        "epicId": "EP-HITL-MOBILE",
        "title": "Realtime HITL + Mobile companion",
        "description": (
            "Realtime human-in-the-loop notifications + mobile companion app. "
            "Paused AI work approval surface. External Access permission flow."
        ),
        "status": "open",
        "items": [
            {"title": "Realtime HITL + mobile companion design", "status": "done", "evidence_spec": "2026-05-13-realtime-hitl-mobile-companion-design.md"},
            {"title": "Paused AI work approval surface plan", "status": "done", "evidence_plan": "2026-05-13-paused-ai-work-approval-surface.md"},
            {"title": "Mobile companion readiness audit", "status": "done", "source": "audit-2026-05-13-realtime-hitl-mobile-readiness-report"},
            {"title": "External Access permission flow", "status": "done", "evidence_prs": [532, 546, 551], "source": "pr-551"},
            {"title": "HITL approval surface implementation", "status": "open"},
        ],
    },

    # ── CWS-PROVENANCE ────────────────────────────────────────────────────
    {
        "epicId": "EP-PROVENANCE",
        "title": "Artifact provenance receipts",
        "description": "Provenance receipts for build artifacts + tool executions.",
        "status": "in-progress",
        "items": [
            {"title": "Artifact provenance receipts design", "status": "done", "evidence_spec": "2026-04-27-artifact-provenance-receipts-design.md"},
            {"title": "Artifact provenance receipts Slice 1", "status": "done", "evidence_prs": [354], "source": "pr-354"},
        ],
    },

    # ── CWS-PROMPT-LINT ───────────────────────────────────────────────────
    {
        "epicId": "EP-PROMPT-LINT",
        "title": "Prompt state-leakage lint",
        "description": "Detect prompt state leakage across prompt-template surfaces.",
        "status": "in-progress",
        "items": [
            {"title": "Prompt state-leakage lint design + plan", "status": "done", "evidence_spec": "2026-04-30-prompt-state-leakage-lint-design.md"},
            {"title": "Prompt state-leakage sweep waves 3+4", "status": "done", "evidence_prs": [362, 380], "source": "pr-380"},
        ],
    },

    # ── CWS-AGENT-MKT ─────────────────────────────────────────────────────
    {
        "epicId": "EP-AGENT-MKT",
        "title": "Agent Tool Marketplace",
        "description": "Marketplace surface for agent tools — discovery + governance.",
        "status": "in-progress",
        "items": [
            {"title": "Agent Tool Marketplace design", "status": "done", "evidence_spec": "2026-05-01-agent-tool-marketplace-design.md"},
            {"title": "Agent Tool Marketplace Slice 1", "status": "done", "evidence_prs": [365, 371], "source": "pr-371"},
        ],
    },

    # ── CWS-PORTAL-UX-TRUST ───────────────────────────────────────────────
    {
        "epicId": "EP-PORTAL-UX-TRUST",
        "title": "Portal UX data source trust repair",
        "description": "Portal UX — clarify provider cost/authority sources, completeness scoring.",
        "status": "open",
        "items": [
            {"title": "Portal UX data source trust repair plan", "status": "done", "evidence_plan": "2026-05-13-portal-ux-data-source-trust-repair.md", "evidence_worktree": "portal-ux-data-source-plan"},
            {"title": "Clarify provider cost/authority sources", "status": "done", "evidence_prs": [573], "source": "pr-573"},
            {"title": "Portfolio completeness scoring", "status": "done", "evidence_prs": [594], "source": "pr-594"},
        ],
    },

    # ── CWS-A2A ────────────────────────────────────────────────────────────
    {
        "epicId": "EP-A2A",
        "title": "A2A — agent-to-agent coworker team orchestration",
        "description": (
            "A2A coworker team orchestration — draft spec in worktree, not yet merged."
        ),
        "status": "open",
        "items": [
            {"title": "A2A coworker team orchestration spec (draft)", "status": "in-progress", "evidence_worktree": "a2a-coworker-team-orchestration"},
        ],
    },

    # ── CWS-AGENTS-DOC ────────────────────────────────────────────────────
    {
        "epicId": "EP-AGENTS-DOC",
        "title": "AGENTS.md + public docs refresh",
        "description": (
            "AGENTS.md canonicalization. Standards refresh. Public-site current-"
            "state refresh. Founder-kernel 0.2.0 draft + publication."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Canonical AGENTS.md (root)", "status": "done", "evidence_prs": [313], "source": "pr-313"},
            {"title": "Agent standards refresh plan", "status": "done", "evidence_plan": "2026-05-11-agent-standards-refresh.md"},
            {"title": "Docs public site current-state refresh", "status": "in-progress", "evidence_plan": "2026-05-14-docs-public-site-current-state-refresh.md", "evidence_worktree": "DPF-docs-audit-2026-05-14"},
            {"title": "AGENTS.md principle inventory audit", "status": "done", "source": "audit-2026-05-13-agents-md-principle-inventory"},
            {"title": "Installer messaging — pivot from 'preview' to 'early access'", "status": "done", "evidence_prs": [481], "source": "pr-481"},
            {"title": "Founder kernel 0.2.0 publication", "status": "done", "evidence_prs": [482, 547], "source": "pr-547"},
            {"title": "TAK/GAID refresh — auth + agent identity + governed memory", "status": "done", "evidence_prs": [549, 550], "source": "pr-550"},
        ],
    },

    # ── CWS-CI-GATES ──────────────────────────────────────────────────────
    {
        "epicId": "EP-CI-GATES",
        "title": "CI hardening — gates, invariants, security",
        "description": (
            "Pre-commit prisma regen + Unit Tests binding gate + Block secrets at any "
            "depth + destructive-ops gate + dep-audit + ADP-harness CI."
        ),
        "status": "in-progress",
        "items": [
            {"title": "Pre-commit hook — prisma regen + typecheck", "status": "done", "evidence_prs": [321], "source": "pr-321"},
            {"title": "CI — block secrets at any depth", "status": "done", "evidence_prs": [406, 461], "source": "pr-461"},
            {"itemId": "BI-7F3BF93C", "title": "packages/db vitest pool=forks", "status": "done", "evidence_prs": [693], "source": "pr-693"},
            {"title": "Unit Tests binding merge gate", "status": "done", "evidence_prs": [697], "source": "pr-697"},
            {"itemId": "BI-5936F8CA", "title": "ADP integration-test-harness wired into CI", "status": "done", "evidence_prs": [699], "source": "pr-699"},
        ],
    },

    # ── CWS-SEED-SUBSTRATE ────────────────────────────────────────────────
    {
        "epicId": "EP-SEED-SUBSTRATE",
        "title": "Eliminate seed-as-data-load",
        "description": (
            "Migration of runtime data away from seed.ts. seedCities P2002 tolerance. "
            "Recovery-mechanism design (this work's own follow-up motivation)."
        ),
        "status": "open",
        "items": [
            {"title": "Eliminate seed-as-data-load design", "status": "done", "evidence_spec": "2026-04-28-eliminate-seed-as-data-load-design.md"},
            {"itemId": "BI-E4E21A7F", "title": "seedCities P2002 tolerance", "status": "done", "evidence_prs": [403], "source": "pr-403"},
            {"title": "Postgres backup mechanism spec (recovery follow-up)", "status": "open", "source": "rca-2026-05-17"},
        ],
    },

    # ── CWS-BUILD-STUDIO ──────────────────────────────────────────────────
    {
        "epicId": "EP-BUILD-STUDIO",
        "title": "Build Studio — intake/innovation/business brief/provider runner",
        "description": (
            "Build Studio first-lifecycle hardening. Build-specialist operator "
            "contract. Business intake radar. Build provider/runner extraction. "
            "Persistent business brief editor."
        ),
        "status": "in-progress",
        "items": [
            {"itemId": "BI-E9CD1B92", "title": "Build Studio first-lifecycle hardening (parent BI — spans 13 PRs)", "status": "done", "evidence_prs": [360, 362, 366, 374, 375, 376, 378, 559, 561, 562, 578, 580, 647], "source": "pr-647"},
            {"itemId": "BI-0B3EAAC8", "title": "Build Studio business intake — radar items", "status": "done", "evidence_prs": [375, 376, 378], "source": "pr-378"},
            {"itemId": "BI-77A1973C", "title": "Business intake — anchors", "status": "done", "evidence_prs": [375, 378], "source": "pr-378"},
            {"itemId": "BI-255C460B", "title": "Build Studio — saveBuildEvidence args", "status": "done", "evidence_prs": [374], "source": "pr-374"},
            {"itemId": "BI-AA03296D", "title": "Build Studio — cockpit fix", "status": "done", "evidence_prs": [376], "source": "pr-376"},
            {"itemId": "BI-45286EA2", "title": "Build Studio — execInSandbox maxBuffer raise (1/4)", "status": "done", "evidence_prs": [615], "source": "pr-615"},
            {"itemId": "BI-59D7E197", "title": "Build Studio — execInSandbox maxBuffer raise (2/4)", "status": "done", "evidence_prs": [615], "source": "pr-615"},
            {"itemId": "BI-5FA409B3", "title": "Build Studio — execInSandbox maxBuffer raise (3/4)", "status": "done", "evidence_prs": [615], "source": "pr-615"},
            {"itemId": "BI-B8892CEC", "title": "Build Studio — execInSandbox maxBuffer raise (4/4)", "status": "done", "evidence_prs": [615], "source": "pr-615"},
            {"title": "Build Studio v2 persistent business brief editor", "status": "done", "evidence_prs": [437, 442, 446, 448, 451], "source": "pr-451"},
            {"title": "Build-specialist operator contract Slice 1", "status": "done", "evidence_spec": "2026-04-30-build-specialist-operator-contract.md"},
            {"title": "Build execution provider + agent runner Slice 1", "status": "done", "evidence_spec": "2026-05-09-build-execution-provider-design.md", "evidence_plan": "2026-05-10-build-provider-agent-runner-slice-1.md"},
            {"title": "Build Studio business intake innovation radar design", "status": "done", "evidence_spec": "2026-05-10-build-studio-business-intake-innovation-radar-design.md"},
            {"title": "Build Studio create_portal_pr crash fix", "status": "done", "evidence_prs": [647], "source": "pr-647"},
        ],
    },

    # ── CWS-AGENT-WORKSPACE (folded probe) ────────────────────────────────
    {
        "epicId": "EP-AGENT-WORKSPACE",
        "title": "Agent workspace pattern probe",
        "description": "Workspace pattern probe — possibly absorbed by CWS-COWORKER-RUNTIME.",
        "status": "open",
        "items": [
            {"title": "Workspace pattern probe (draft spec)", "status": "done", "evidence_prs": [514], "source": "pr-514"},
        ],
    },
]
