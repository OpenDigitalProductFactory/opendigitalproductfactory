# EP-ECO-001: Best-of-Breed Ecosystem Alignment Research

**Status:** Research Complete | **Date:** 2026-04-04 | **Author:** Claude (research synthesis)

## Purpose

Evaluate 9 open-source projects from the Claude Code ecosystem for incorporation into the Digital Product Factory (DPF) platform, mapping capabilities to existing architecture gaps and identifying patterns that strengthen the AI Coworker, TAK governance, Build Studio orchestration, and knowledge management subsystems.

---

## Executive Summary

| # | Project | Stars | License | Verdict | Priority |
|---|---------|-------|---------|---------|----------|
| 1 | UI UX Pro Max | 58K | MIT | **Adopt** -- install as Claude Code skill for DPF development | High |
| 2 | n8n-MCP | 17K | MIT | **Integrate** -- bidirectional MCP bridge for workflow automation | Medium |
| 3 | Obsidian Skills | 19K | MIT | **Adopt patterns** -- Agent Skills spec (agentskills.io) for skill organization | High |
| 4 | LightRAG | 32K | MIT | **Integrate** -- graph-enhanced RAG using existing Neo4j + Qdrant | High |
| 5 | Everything Claude Code | 100K | MIT | **Adopt patterns** -- validated architecture patterns for TAK | High |
| 6 | Claude Mem | N/A | AGPL-3.0 | **Adopt patterns** -- progressive disclosure retrieval, observation memory | Medium |
| 7 | GSD (Get Shit Done) | 31K | MIT | **Adopt patterns** -- context rot prevention, state-machine orchestration | High |
| 8 | Awesome Claude Code | 36K | N/A | **Monitor** -- ecosystem radar, curated tool/skill discovery | Ongoing |
| 9 | Superpowers | 135K | MIT | **Already adopted** -- monitor for new skills, cross-platform portability | Ongoing |

---

## 1. UI UX Pro Max

**Repo:** https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
**What:** AI-powered design intelligence skill with 67 UI styles, 161 color palettes, 57 font pairings, 161 industry-specific reasoning rules, 99 UX guidelines, and anti-pattern prevention. Pure Python + CSV, no external dependencies.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| Industry-specific design reasoning | AI Coworker generates generic UI; no design system enforcement |
| Anti-pattern prevention (no "AI purple gradient") | Agent-built interfaces lack consistency |
| Stack-specific guidelines (Next.js + React + Tailwind + shadcn/ui) | Exactly our stack |
| Pre-delivery WCAG accessibility checklist | Enterprise compliance requirement |
| Design system persistence (Master + Overrides) | Multi-page visual coherence |

### Recommended Actions

1. **Immediate:** Install globally for DPF development: `uipro init --ai claude --global`
2. **Short-term:** Extract the CSV-as-knowledge-base pattern for building DPF-specific design rules
3. **Long-term:** Build a custom DPF design skill using the same architecture, encoding our product's visual identity

### Architecture Pattern to Adopt

**CSV-as-database for design knowledge** -- version-controllable, diffable, no runtime dependencies. The BM25 + regex hybrid search over structured CSVs is a lightweight alternative to vector search for domain-specific lookups.

---

## 2. n8n-MCP

**Repos:** https://github.com/czlonkowski/n8n-mcp (17.5K stars) + https://github.com/nerding-io/n8n-nodes-mcp (3K stars)
**What:** Bidirectional bridge between AI agents and n8n workflow automation via MCP.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| AI agent builds/manages n8n workflows | No visual workflow authoring for non-technical users |
| n8n workflows call MCP tools | No low-code orchestration layer |
| Progressive detail levels (minimal/standard/full) | Context budget optimization (EP-CTX-001) |
| Tool annotations (readOnlyHint, destructiveHint) | TAK tool governance metadata |
| Diff-based partial updates with validateOnly mode | Safe resource modification pattern |
| Self-documenting tools meta-endpoint | Runtime tool discovery without prompt bloat |

### Recommended Actions

1. **Short-term:** Add n8n to Docker Compose stack as optional workflow engine
2. **Short-term:** Adopt the tool annotation pattern (`readOnlyHint`, `destructiveHint`, `idempotentHint`) in `mcp-tools.ts` ToolDefinition type
3. **Medium-term:** Implement progressive detail levels on MCP tool responses (aligns with EP-CTX-001)
4. **Long-term:** Expose DPF platform tools as n8n-callable MCP endpoints for citizen automation

### Architecture Pattern to Adopt

**Progressive detail levels on tool responses** -- Let agents request minimal (~200 tokens), standard (~1-2K), or full (~3-8K) detail per tool call. Reduces token waste by ~80% for browsing/discovery calls.

**Self-documenting tool meta-endpoint** -- A `tools_documentation` tool that lets agents query how to use other tools at runtime, replacing static prompt injection of all tool docs.

---

## 3. Obsidian Skills (Agent Skills Spec)

**Repo:** https://github.com/kepano/obsidian-skills (19.5K stars)
**What:** Reference implementation of the agentskills.io open spec -- portable, agent-agnostic skill format.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| SKILL.md with YAML frontmatter + trigger descriptions | No standardized skill format; skills are code-embedded |
| Progressive disclosure via `references/` subdirectories | Token waste loading full tool docs upfront |
| Plugin manifest (plugin.json + marketplace.json) | No skill registry or catalog |
| Agent-agnostic portability (Claude, Codex, OpenCode) | Vendor lock-in risk |
| Validation checklists embedded in skills | No self-check pattern in agent capabilities |
| File-type / domain routing triggers | Skills don't auto-activate by context |

### Recommended Actions

1. **High priority:** Adopt the agentskills.io SKILL.md format for organizing DPF workforce agent capabilities
2. **High priority:** Implement a skill registry with `plugin.json`-style manifests for discoverability
3. **Short-term:** Add `description` field as natural-language routing trigger (replaces code-based routing tables)
4. **Medium-term:** Build a skill catalog UI in the admin panel showing all agent capabilities, their triggers, and activation conditions
5. **Long-term:** Publish DPF skills as portable agentskills.io packages

### Architecture Pattern to Adopt

**Skill-as-document with embedded routing** -- Each skill is a self-contained markdown file with a natural-language `description` that doubles as routing logic. This is simpler and more maintainable than code-based routing tables.

**Progressive disclosure through linked references** -- Core capability doc up front (~80% use case), detailed references loaded on demand. Directly aligns with Mark's US 8,635,592 patent.

---

## 4. LightRAG

**Repo:** https://github.com/HKUDS/LightRAG (32K stars, EMNLP 2025)
**What:** Graph-enhanced RAG combining knowledge graph traversal with vector similarity search.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| Automated knowledge graph construction from text | Manual knowledge structuring |
| Dual-level retrieval (local + global) | Single-level vector search in Qdrant |
| Multi-hop reasoning via graph edges | Flat vector search can't follow relationships |
| Native Neo4j + Qdrant backends | Zero new infrastructure -- uses existing stack |
| Incremental updates without re-indexing | Current platform-knowledge requires full re-index |
| Workspace-based multi-tenancy | Tenant isolation already needed |

### Recommended Actions

1. **High priority:** Deploy LightRAG server as Docker sidecar (REST API, Ollama-compatible)
2. **High priority:** Configure with existing Neo4j + Qdrant instances (dedicated workspace/collections)
3. **Short-term:** Index knowledge articles (EP-KM-001) through LightRAG for entity-aware retrieval
4. **Medium-term:** Index build specs, design docs, and operational runbooks for cross-document reasoning
5. **Long-term:** Replace simple `searchPlatformKnowledge()` with LightRAG hybrid queries for agent context assembly

### Architecture Pattern to Adopt

**Graph-enhanced retrieval** -- Extract entities and relationships during ingestion, store as graph nodes/edges, then combine graph traversal with vector similarity at query time. This enables multi-hop reasoning ("What services are affected if component X fails?") that flat vector search cannot answer.

### Integration Architecture

```
Document Ingestion:
  Knowledge Article / Spec / Runbook
    --> LightRAG ainsert()
    --> LLM extracts entities + relationships
    --> Entities -> Neo4j nodes (workspace-labeled)
    --> Embeddings -> Qdrant vectors (workspace-filtered)

Query Path:
  AI Coworker needs context
    --> LightRAG aquery(mode="hybrid")
    --> Vector search finds relevant entities
    --> Graph traversal follows relationships
    --> Structured context returned to prompt assembler
```

### Caveats

- Python-only; integration via HTTP API, not in-process
- LLM extraction during ingestion is expensive (one call per chunk)
- Embedding model must remain consistent after initial indexing
- Recommend `nomic-embed-text` (already used by DPF) or `BAAI/bge-m3`

---

## 5. Everything Claude Code

**Repo:** https://github.com/affaan-m/everything-claude-code (100K stars)
**What:** Configuration framework + patterns revealed by the Claude Code source leak (March 2026).

### DPF Alignment -- Validated Architecture Patterns

| Claude Code Pattern | DPF Current State | Action |
|--------------------|-------------------|--------|
| Simple while-loop orchestration + rich harness | TAK agentic-loop.ts already follows this | **Validated** -- maintain simplicity |
| Per-tool permission gating (4 tiers) | executionMode (immediate/proposal) is 2 tiers | **Enhance** -- add Plan and Auto tiers |
| Dedicated tools over generic shells | mcp-tools.ts already does this | **Validated** |
| Cache-aware prompt architecture (static/dynamic boundary) | No explicit cache boundary in prompt-assembler | **Implement** -- add SYSTEM_PROMPT_DYNAMIC_BOUNDARY |
| Three-layer memory (index/topic/transcript) | Two-layer (Qdrant vectors + conversation) | **Implement** -- add index layer |
| Subagent isolation with output-only returns | Build orchestrator returns full context | **Fix** -- return summaries only |
| Hook-based workflow enforcement | No pre-tool-use hooks in TAK | **Implement** -- PreToolUse hook system |
| Context compaction (5 strategies, 3 tiers) | No compaction strategy | **Implement** -- critical for EP-CTX-001 |
| Tiered model routing for cost control | Performance-driven routing exists | **Enhance** -- add cheap-model pre-screening |
| Hallucination guard (zero-tool-call rejection) | shouldNudge() exists but doesn't reject | **Enhance** -- reject after nudge exhaustion |
| Anti-distillation / security attestation | Not applicable to DPF | Skip |
| KAIROS autonomous mode | Not needed currently | Monitor |

### Recommended Actions

1. **High priority:** Implement SYSTEM_PROMPT_DYNAMIC_BOUNDARY in prompt-assembler.ts for cache efficiency
2. **High priority:** Add context compaction strategies to EP-CTX-001 design
3. **Short-term:** Implement PreToolUse hook system in TAK for governance enforcement
4. **Short-term:** Change build orchestrator to return summaries, not full specialist context
5. **Medium-term:** Add index layer to memory architecture (lightweight pointers loaded always, full content on demand)

---

## 6. Claude Mem

**Repo:** https://github.com/thedotmack/claude-mem (AGPL-3.0)
**What:** Persistent memory with progressive disclosure retrieval, hybrid search (SQLite FTS5 + Chroma vectors), and experimental "Endless Mode" for long-running tasks.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| Progressive disclosure retrieval (3-layer) | Agent context floods with flat vector results |
| Observation-based memory (not transcripts) | Storing raw conversation, not structured decisions |
| Hybrid search (keyword + semantic) | Qdrant is semantic-only; misses exact matches |
| AI-powered compression over fixed chunking | Fixed chunking in current embedding pipeline |
| Session lifecycle hooks for memory capture | No structured memory capture points |
| Endless Mode (O(N) context, dual-tier memory) | Context grows unbounded in long builds |

### Recommended Actions

1. **High priority:** Implement 3-layer retrieval in semantic-memory.ts:
   - Layer 1: Compact index with IDs (~50-100 tokens per result)
   - Layer 2: Chronological timeline around filtered results
   - Layer 3: Full observation details only for selected IDs
2. **Short-term:** Add FTS5 keyword search alongside Qdrant vector search for hybrid retrieval
3. **Short-term:** Shift from storing raw messages to structured observations (tool usage, decisions, outcomes)
4. **Medium-term:** Implement biomimetic memory decay -- recent observations stay detailed, older ones progressively summarized
5. **Long-term:** Evaluate Endless Mode pattern for Build Studio long-running sessions (10-minute builds)

### Architecture Pattern to Adopt

**Progressive disclosure retrieval** -- Never dump all memory into context. Search broadly (cheap, small tokens), then drill into specific observations on demand. This is the retrieval-side complement to progressive disclosure in skill loading.

### Caution

AGPL-3.0 license -- adopt patterns, not code. For enterprise needs, consider Mem0 (SOC 2, $24.5M funding) or build internal equivalent.

---

## 7. GSD (Get Shit Done)

**Repos:** https://github.com/gsd-build/get-shit-done (v1) + https://github.com/gsd-build/gsd-2 (v2, 31K stars)
**What:** Meta-prompting and spec-driven development with state-machine orchestration, context rot prevention, and fresh-context-per-task execution.

### DPF Alignment

| Capability | DPF Gap It Fills |
|------------|-----------------|
| Fresh context per task (prevents quality degradation) | Long build sessions degrade past 50% context | 
| Milestone > Slice > Task hierarchy | Epic > BacklogItem exists but no atomic task enforcement |
| State externalization to disk (.gsd/ files) | Build state lives in LLM memory, lost on crash |
| Hallucination guard (reject zero-tool-call completions) | shouldNudge() nudges but doesn't reject |
| Wave-based parallel execution | Build orchestrator runs phases sequentially |
| Model complexity routing | Basic performance routing exists |
| Per-unit cost tracking | No per-build cost attribution |
| Verification + auto-fix retry loop | No post-build verification with auto-remediation |
| Stuck loop detection (sliding window) | Tool repetition check (3x same call) is basic |
| Lock files + crash recovery | No build resumption after interruption |

### Recommended Actions

1. **High priority:** Implement fresh-context isolation for Build Studio specialist dispatches -- each specialist gets a clean context with pre-inlined knowledge, not accumulated conversation
2. **High priority:** Externalize build state to structured files (not LLM memory) for crash recovery and audit
3. **Short-term:** Implement wave-based parallel execution in build orchestrator (dependency-aware waves)
4. **Short-term:** Add per-build cost tracking and budget ceiling enforcement
5. **Medium-term:** Implement verification + auto-fix retry loop at phase boundaries
6. **Medium-term:** Add sliding-window stuck detection (replace simple 3x repetition check)
7. **Long-term:** Implement full state-machine orchestration for the build lifecycle

### Architecture Pattern to Adopt

**Context rot prevention through task isolation** -- Quality degrades predictably past 50% context utilization. Each task gets a fresh context window with pre-inlined knowledge (task plan, prior summaries, dependencies). The main orchestrator stays lean.

**State-machine-driven orchestration** -- Control the session programmatically through deterministic state transitions. Don't rely on the LLM to self-manage long-running work.

---

## 8. Awesome Claude Code

**Repo:** https://github.com/hesreallyhim/awesome-claude-code (36K stars)
**What:** Curated ecosystem list of skills, agents, plugins, hooks, slash commands, and orchestrators.

### Notable Discoveries for DPF

| Project | Relevance |
|---------|-----------|
| **Trail of Bits Security Skills** | CodeQL/Semgrep auditing for TAK governance (EP-GOVERN-003) |
| **VoltAgent Subagents** (16K stars) | 130+ pre-built specialist agent definitions (DBA, SRE, security) |
| **Container Use (Dagger)** | Sandboxed agent environments for build isolation |
| **agnix** | Linter for CLAUDE.md/AGENTS.md/SKILL.md configuration files |
| **claude-devtools** | Session observability with compaction visualization |
| **Dippy** | AST-based auto-approve for safe bash commands |
| **parry** | Prompt injection scanner (hook-based) |
| **TDD Guard** | Blocks non-TDD code changes via hooks |
| **Claude Squad / TSK** | Multi-agent parallel orchestration patterns |
| **Ruflo** | Swarm orchestration with vector memory + guardrails |

### Recommended Actions

1. **Ongoing:** Monitor this list quarterly for new tools relevant to DPF
2. **Short-term:** Evaluate Trail of Bits Security Skills for TAK governance
3. **Short-term:** Review VoltAgent subagent definitions for workforce agent inspiration
4. **Medium-term:** Evaluate agnix for validating DPF agent configuration files

### Ecosystem Trends to Track

- **Skills API maturation** -- Anthropic's official `/v1/skills` endpoint and progressive disclosure architecture
- **Hook-driven governance** -- declarative policy enforcement on agent actions
- **Multi-agent orchestration convergence** -- Claude Squad, TSK, Ruflo patterns
- **Agent file linting** -- agnix and claude-rules-doctor for config validation
- **Plugin marketplace** -- private marketplace features for enterprise skill distribution

---

## 9. Superpowers

**Repo:** https://github.com/obra/superpowers (135K stars, v5.0.7)
**What:** Agentic skills framework with structured development methodology. DPF already uses Superpowers output conventions (`docs/superpowers/specs/`, `docs/superpowers/plans/`).

### What's New Since Last Review

| Version | Key Changes |
|---------|-------------|
| v5.0.0 | Directory restructuring, mandatory subagent-driven development, visual brainstorming, automated document review |
| v5.0.6 | Inline self-review replaces subagent review loops (30s vs 25min) |
| v5.0.7 | GitHub Copilot CLI support, cross-platform tool mapping, OpenCode token fix |

### New Patterns to Adopt

| Pattern | DPF Application |
|---------|----------------|
| **Inline self-review** (v5.0.6) | Replace subagent review loops with inline checks -- 50x faster |
| **Structured status protocol** (DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT) | Standardize specialist agent outcome reporting in build orchestrator |
| **Persuasion testing** | Stress-test TAK policy adherence under adversarial pressure scenarios |
| **Cross-platform tool mapping** (v5.0.7) | Reduce vendor lock-in; execution adapter pattern for provider changes |
| **Dual-stage review gates** (spec compliance then code quality) | Quality gates at promotion boundaries |

### Recommended Actions

1. **Short-term:** Adopt the 4-status outcome protocol for build orchestrator specialist responses
2. **Short-term:** Replace any subagent review loops with inline self-review pattern
3. **Medium-term:** Implement persuasion testing for TAK governance policies
4. **Ongoing:** Track Superpowers releases for new skills and methodology improvements

---

## Cross-Cutting Patterns Summary

These patterns appear across multiple projects and represent ecosystem consensus:

### 1. Progressive Disclosure (appears in 5/9 projects)
**Projects:** Obsidian Skills, n8n-MCP, Claude Mem, Everything Claude Code, UI UX Pro Max
**Pattern:** Never load everything upfront. Use tiered access: minimal metadata first, detailed content on demand.
**DPF Action:** Implement across skill loading, tool responses, memory retrieval, and context assembly.

### 2. Fresh Context Isolation (appears in 4/9 projects)
**Projects:** GSD, Everything Claude Code, Superpowers, Claude Mem
**Pattern:** Each task/specialist gets a clean context with pre-inlined knowledge. Prevents context rot.
**DPF Action:** Build Studio specialists must receive isolated contexts, not accumulated conversation.

### 3. State Externalization (appears in 3/9 projects)
**Projects:** GSD, Everything Claude Code, Claude Mem
**Pattern:** All state on disk in structured files. LLM memory is ephemeral; disk state is authoritative.
**DPF Action:** Build state, agent decisions, and orchestration progress persisted to files for crash recovery.

### 4. Hybrid Search (appears in 3/9 projects)
**Projects:** LightRAG, Claude Mem, UI UX Pro Max
**Pattern:** Combine keyword/exact-match search with semantic vector search.
**DPF Action:** Add FTS alongside Qdrant for hybrid retrieval in semantic-memory.ts.

### 5. Structured Skill Format (appears in 3/9 projects)
**Projects:** Obsidian Skills, Superpowers, Everything Claude Code
**Pattern:** Skills as markdown documents with YAML metadata, trigger descriptions, and progressive references.
**DPF Action:** Adopt agentskills.io format for workforce agent capability definitions.

### 6. Hook-Based Governance (appears in 3/9 projects)
**Projects:** Everything Claude Code, Awesome Claude Code ecosystem, Claude Mem
**Pattern:** PreToolUse/PostToolUse hooks intercept and validate agent actions before execution.
**DPF Action:** Implement hook system in TAK for tool-grant enforcement and audit trail.

---

## Implementation Roadmap

### Phase 1 -- Quick Wins (This Sprint)

| Action | Source Project | Effort |
|--------|---------------|--------|
| Install UI UX Pro Max as global Claude Code skill | UI UX Pro Max | 10 min |
| Add tool annotations (readOnlyHint, destructiveHint) to ToolDefinition | n8n-MCP | 2 hours |
| Adopt 4-status outcome protocol for specialist responses | Superpowers | 1 hour |
| Add SYSTEM_PROMPT_DYNAMIC_BOUNDARY to prompt-assembler | Everything Claude Code | 2 hours |

### Phase 2 -- Architecture Enhancements (Next 2 Sprints)

| Action | Source Project | Effort |
|--------|---------------|--------|
| Implement 3-layer progressive retrieval in semantic-memory.ts | Claude Mem | 1 day |
| Fresh context isolation for Build Studio specialists | GSD | 2 days |
| Externalize build state to structured files | GSD | 1 day |
| Add FTS5 hybrid search alongside Qdrant | Claude Mem / LightRAG | 2 days |
| Implement PreToolUse hook system in TAK | Everything Claude Code | 2 days |
| Context compaction strategies (MicroCompact, AutoCompact) | Everything Claude Code | 3 days |

### Phase 3 -- Major Integrations (Next Month)

| Action | Source Project | Effort |
|--------|---------------|--------|
| Deploy LightRAG server as Docker sidecar | LightRAG | 2 days |
| Index knowledge articles through LightRAG | LightRAG | 3 days |
| Implement agentskills.io skill format for workforce agents | Obsidian Skills | 3 days |
| Build skill registry/catalog UI | Obsidian Skills | 3 days |
| Wave-based parallel execution in build orchestrator | GSD | 3 days |
| Per-build cost tracking and budget enforcement | GSD | 2 days |

### Phase 4 -- Strategic (Next Quarter)

| Action | Source Project | Effort |
|--------|---------------|--------|
| Add n8n to Docker Compose as optional workflow engine | n8n-MCP | 3 days |
| Custom DPF design skill using CSV-based architecture | UI UX Pro Max | 1 week |
| Full state-machine orchestration for build lifecycle | GSD | 1 week |
| Publish DPF skills as portable agentskills.io packages | Obsidian Skills | 3 days |
| Evaluate Trail of Bits Security Skills for TAK | Awesome Claude Code | 2 days |

---

## Continuous Monitoring List

| Project | Watch For | Check Frequency |
|---------|-----------|----------------|
| Superpowers | New skills, methodology changes, cross-platform updates | Each release |
| Awesome Claude Code | New tools, ecosystem trends | Monthly |
| LightRAG | Performance improvements, new backends, API changes | Monthly |
| GSD | v2 stability, new orchestration patterns | Monthly |
| Everything Claude Code | New subagents, security skills | Monthly |
| n8n-MCP | Enterprise features, new tool annotations | Quarterly |
| Obsidian Skills / agentskills.io | Spec evolution, enterprise features | Quarterly |
| Claude Mem | Endless Mode production validation, Mem0 maturity | Quarterly |
| UI UX Pro Max | New styles, stack guidelines, accessibility rules | Quarterly |

---

## License Compatibility

| Project | License | Compatible with DPF? |
|---------|---------|---------------------|
| UI UX Pro Max | MIT | Yes -- unrestricted |
| n8n-MCP (czlonkowski) | MIT | Yes -- unrestricted |
| Obsidian Skills | MIT | Yes -- unrestricted |
| LightRAG | MIT | Yes -- unrestricted |
| Everything Claude Code | MIT | Yes -- unrestricted |
| Claude Mem | **AGPL-3.0** | **Patterns only** -- do not incorporate code |
| GSD | MIT | Yes -- unrestricted |
| Superpowers | MIT | Yes -- unrestricted |

---

## References

- EP-CTX-001: Context Budget Layer
- EP-GOVERN-003: Agent Tool Grant Audit Trail
- EP-MEMORY-001: Shared Memory Vector DB Design
- EP-AGENT-CAP-001: Knowledge-Driven Agent Capabilities
- EP-KM-001: Knowledge Management
- EP-BUILD-ORCHESTRATOR: Build Process Orchestrator Design
- US 8,635,592: Progressive Disclosure of Software Complexity (Bodman)
- agentskills.io: Agent Skills Specification (Anthropic)
