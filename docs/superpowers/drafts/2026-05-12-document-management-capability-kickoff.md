# Kickoff prompt - document-management capability

Paste this into a fresh Claude Code or Codex session to start the document-management capability work.

**Revision note (2026-05-12, post chief-architect review):** three required additions over the original prompt — (a) audit must include `PromptTemplate`, `SkillDefinition`, and other existing long-form-text surfaces, not only "documentish" models; (b) hive-contribution stance must be stated for non-code documents; (c) migration question must include the external-reference option (Document with `contentRef` pointing at `path@commit`). Plus tightenings on owner identity, lifecycle-state count, branch/DCO process, and mutation atomicity. Changes are inline below.

---

## Prompt

**Task: design a document-management capability for the Digital Product Factory.**

The Digital Product Factory (https://github.com/OpenDigitalProductFactory/opendigitalproductfactory) needs a managed document store. Filesystem alone (workspace files, git-tracked specs) is insufficient because:

- Documents reference each other across workspaces, repos, and contexts. References must survive moves, renames, and version bumps.
- Documents have lifecycles: draft -> review -> published -> archived. Filesystem cannot natively express those states.
- Search needs to be cross-document: full-text for finding a phrase, semantic for finding a related concept, metadata for finding all draft briefs owned by the licensing coworker.
- Documents need version history independent of git. Not every doc lives in a git-tracked repo, and DPF needs a unified history surface for human and AI-coworker contributions.
- Documents need owner/access/governance metadata that is queryable.
- Backup/restore needs to be one coherent operation, not git repos here plus filesystem there plus sandbox volume over there.

Reference point: Mark has worked with Documentum and similar enterprise document-management systems. The capability should aim for Documentum-class semantics: versioning, references, lifecycle, search, audit, renditions. The implementation should stay DPF-light: Postgres plus existing qdrant for semantic search plus existing neo4j for reference graph. Do not add new infrastructure.

Why this matters now: the in-flight agent workspace pattern draft at `docs/superpowers/drafts/2026-05-12-agent-workspace-pattern.md` proposes a document workspace where AI coworkers such as Brand, Marketing, and Policy draft, refine, and persist non-code artifacts. Without a document-management capability, those coworkers can only write to workspace scratch. There is no place for outputs to land where they are searchable, referenceable, and version-tracked. This spec gates that one.

Deliverable: a spec document under `docs/superpowers/specs/<date>-document-management-capability.md` covering:

1. **Data model.** Probable shape: `Document` (id, title, contentRef, contentFormat, ownerPrincipalId, currentVersionId, currentState, kind, createdAt, updatedAt), `DocumentVersion` (id, documentId, version, content/contentRef, summary, createdByPrincipalId, createdAt), `DocumentReference` (sourceDocumentId, sourceVersionId, targetDocumentId, targetVersionId, refType, anchor), `DocumentTag`, `DocumentLifecycleEvent`. Audit DPF's existing schema first per AGENTS.md section 11. Per the §11 addendum (2026-05-09), ownership **must** resolve to a single `Principal` via `PrincipalAlias` — no `Organization`/`User`/`Agent` parallel ownership columns, no free-form `ownerType` string. Document the alias-kind mapping (`User`/`Agent`/`ServiceAccount` can all author documents; the owning Principal is the authorization subject).

   **Existing-surface audit (required).** Before proposing new tables, catalog every place DPF stores long-form text today and decide whether Document subsumes it, references it, or runs parallel. The audit must explicitly cover (not an exhaustive list — find more):
   - `PromptTemplate` — prompts are typed documents with content, versioning intent, and a lifecycle (seeded vs. user-edited). Decide whether Document subsumes `PromptTemplate` (refactor), Document references it as `kind: prompt`, or they remain parallel surfaces. The §11 stewardship rule disfavors leaving them parallel.
   - `SkillDefinition` — same question for skills.
   - `Epic.description`, `BacklogItem.description` — long-form fields embedded in non-document tables. Decide: stay embedded, or promote to Document and reference?
   - `KnowledgeArticle`, `WikiPage`, `Spec` (if present) — search before assuming names.
   - Markdown files under `docs/superpowers/specs/`, `docs/superpowers/plans/`, `docs/superpowers/audits/`, `docs/superpowers/drafts/` — git-tracked, not in DB today.
   - Coworker output artifacts (build design docs, brand briefs, policy drafts) currently written to workspace filesystems with no durable home.

   The audit's output is a one-paragraph stance per surface: subsume / reference / leave parallel + reason. A spec that adds Document without resolving `PromptTemplate` will quietly create a permanent second long-form-text surface — §11 explicitly forbids this.
2. **Storage tier.** Decide whether content under roughly 10MB lives in Postgres (`bytea` or `content text`) and larger payloads go to a blob store with a content-addressable hash. Look at what already exists in DPF for assets/files before adding any new storage concept.
3. **Search.** Full-text through Postgres `tsvector`; semantic through the existing qdrant collection; metadata filters through Prisma queries. The reference graph should use existing neo4j capability if present. Verify and reuse; do not re-add. Specify the **composition model** — how callers combine modes (AND/OR across full-text + semantic + metadata, ranking when results overlap). Notion, Outline, and Documentum all let you compose; pick a default and document the query shape.
4. **Lifecycle.** Start from the smallest plausible state set and defend every state added beyond it. The minimal viable set is probably `draft → published → archived` (three states cover ~80% of value: Notion ships with two + permissions). Five states (`draft → in-review → approved → published → archived`) is an upper bound that requires justification: which coworker workflow actually needs `in-review` and `approved` as distinct DB states rather than as permission/notification semantics? If review is a workflow on a `draft` document rather than its own state, fewer states is the right call. Whatever set you pick, justify each state with the coworker flow that requires it. Transitions emit `DocumentLifecycleEvent` rows.
5. **MCP tool surface for AI coworkers.** Proposed tools: `mcp__dpf__doc_save`, `doc_load`, `doc_search`, `doc_link`, `doc_version_list`, `doc_state_change`, `doc_list_references`. Schema follows the existing `apps/web/lib/mcp-tools.ts` pattern. Each must be governed by `getToolGrantMapping()` per AGENTS.md section 8.
6. **Governance / audit.** Tool executions land in `ToolExecution` as usual. State-change events also write `DocumentLifecycleEvent` rows. Do not create a duplicate audit table.
7. **Migration strategy.** Decide what happens to existing `docs/superpowers/specs/*.md`, `docs/superpowers/plans/*.md`, and `docs/superpowers/audits/*.md` files. Three coherent answers, pick one and justify:
   - (a) Stay as-is. Document management is for new documents only. Git-tracked specs remain the canonical surface for engineering documentation.
   - (b) Import as full documents with git history flattened into `DocumentVersion` rows. Heavy migration; engineering surface moves into DB.
   - (c) **External-reference mode** — Document row exists with `contentRef = "<repo-path>@<commit-sha>"`, no content copied into DB. Lifecycle, references, search-indexing, and lifecycle events all work; the bytes live in git. Often the right answer for git-tracked specs because you avoid two copies drifting and keep code-review as the editing surface for engineers.

   Pick one, justify, and name the migration tool path (or non-path).
8. **Backup story.** A single `pg_dump` plus blob store plus qdrant snapshot must restore document state coherently. Document the procedure. Respect AGENTS.md §1 *Live state over seed data*: the backup target is the live DB + blob + qdrant snapshot, not `packages/db/src/seed.ts` or `docs/superpowers/*.md`. Git-tracked spec files are bootstrap source if anything, not the backup target.
9. **Mutation atomicity.** A `doc_save` writes a `Document` row, a `DocumentVersion` row, a `DocumentLifecycleEvent`, a qdrant embedding, and possibly `DocumentReference` rows. Specify the atomicity model: (a) DB transaction wraps the Postgres side and the doc is *not visible to `doc_search`* until the qdrant embedding lands (eventually-consistent search), or (b) embedding is enqueued and search is staleness-tolerant by design, or (c) some other model. Pick one and document the staleness window callers should expect.
10. **Hive contribution stance for non-code documents.** Reusability-by-design is a stated DPF principle. A document store is high-value hive substrate (brand guidelines, policies, operator contracts, research artifacts) — potentially more so than build artifacts. State the v1 stance:
    - Which document `kind`s / states are eligible for `contribute_to_hive`?
    - What metadata gets stripped at contribution time (owner Principal id, internal references, install-specific tags)?
    - How do `DocumentReference` rows behave at the install boundary? Default recommendation: intra-install only; cross-install links are either content-addressable (target version hash) or dropped. Never assume target IDs survive across installs.
    - Acceptable answer: "v1 is local-only; contribution surface added in a follow-up." Stating the deferral explicitly is the requirement; not deciding is not.
11. **Open questions list.** Name anything that cannot be decided on first principles so the next reviewer can decide.

Research and benchmarking section is mandatory per AGENTS.md section 10. Reference at least:

- Documentum's core data model.
- Notion's block model.
- Outline's document graph.
- MediaWiki's revision model.
- One open-source content-management leader.

For each reference, cite what to adopt, what to reject, and what gap DPF fills.

Operating rules:

- Read AGENTS.md at the repo root first. Follow it, especially section 1 (Never fabricate; research and use standards), section 4 (Branching, Commits & PRs — DCO sign-off, `doc/<slug>` branch from main), section 6 (Live state over seed data), section 10 (Research and Benchmarking section required), and section 11 (Data Model Stewardship including the 2026-05-09 Principal-convergence addendum).
- This is a spec, not an implementation. No code changes. No new tables landed. The deliverable is the Markdown file.
- Keep the spec small enough to finish in one session. If a sub-question is too big, name it as out-of-scope and link to a follow-up.
- Cite specific files and line numbers in the existing codebase where the spec interacts with current implementations: Prisma schema, MCP tool registry, qdrant client, neo4j client.
- Do not propose a Documentum-equivalent feature surface in volume. The goal is the minimum capability that unblocks document workspaces for AI coworkers, with extension points for the larger surface later.
- Branch from `main` as `doc/document-management-capability` (per AGENTS.md §4). Every commit needs `git commit -s` (DCO). When done, open a PR titled `spec(doc-mgmt): document-management capability - draft`. Include a short PR summary, the open questions list lifted from section 11 of the spec, the existing-surface audit stance from section 1, and a clear note that this is a draft for review.

Start by reading AGENTS.md, then `docs/superpowers/drafts/2026-05-12-agent-workspace-pattern.md` (especially §4.1, §5.6, §5.8 — they describe how this capability is consumed), then the live database schema for any model that holds long-form text. Search the schema for `PromptTemplate`, `SkillDefinition`, `KnowledgeArticle`, `WikiPage`, `Spec`, and any other `*description`/`*content`/`*body` text columns. Then design from there.
