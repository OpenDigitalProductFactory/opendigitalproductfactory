# Kickoff prompt - document-management capability

Paste this into a fresh Claude Code or Codex session to start the document-management capability work.

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

1. **Data model.** Probable shape: `Document` (id, title, contentRef, contentFormat, owner principal/org, currentVersionId, currentState, createdAt, updatedAt), `DocumentVersion` (id, documentId, version, content/contentRef, summary, createdById, createdAt), `DocumentReference` (sourceDocumentId, sourceVersionId, targetDocumentId, targetVersionId, refType, anchor), `DocumentTag`, `DocumentLifecycleEvent`. Audit DPF's existing schema first per AGENTS.md section 11. `Organization` is the canonical identity model; documents probably belong to a `Principal` or an `Organization`, not to a free-form `ownerType` string.
2. **Storage tier.** Decide whether content under roughly 10MB lives in Postgres (`bytea` or `content text`) and larger payloads go to a blob store with a content-addressable hash. Look at what already exists in DPF for assets/files before adding any new storage concept.
3. **Search.** Full-text through Postgres `tsvector`; semantic through the existing qdrant collection; metadata filters through Prisma queries. The reference graph should use existing neo4j capability if present. Verify and reuse; do not re-add.
4. **Lifecycle.** A small state machine. `draft`, `in-review`, `approved`, `published`, `archived` is a starting guess. Reflect on whether DPF needs more or fewer states based on the existing IT4IT-aligned epics. Transitions emit `DocumentLifecycleEvent` rows.
5. **MCP tool surface for AI coworkers.** Proposed tools: `mcp__dpf__doc_save`, `doc_load`, `doc_search`, `doc_link`, `doc_version_list`, `doc_state_change`, `doc_list_references`. Schema follows the existing `apps/web/lib/mcp-tools.ts` pattern. Each must be governed by `getToolGrantMapping()` per AGENTS.md section 8.
6. **Governance / audit.** Tool executions land in `ToolExecution` as usual. State-change events also write `DocumentLifecycleEvent` rows. Do not create a duplicate audit table.
7. **Migration strategy.** Decide what happens to existing `docs/superpowers/specs/*.md` and `docs/superpowers/audits/*.md` files. Two coherent answers: (a) they stay as-is, and doc management is for new documents only; (b) they get imported as documents with git history preserved as version history. Pick one and justify.
8. **Backup story.** A single `pg_dump` plus blob store plus qdrant snapshot must restore document state coherently. Document the procedure.
9. **Open questions list.** Name anything that cannot be decided on first principles so the next reviewer can decide.

Research and benchmarking section is mandatory per AGENTS.md section 10. Reference at least:

- Documentum's core data model.
- Notion's block model.
- Outline's document graph.
- MediaWiki's revision model.
- One open-source content-management leader.

For each reference, cite what to adopt, what to reject, and what gap DPF fills.

Operating rules:

- Read AGENTS.md at the repo root first. Follow it, especially section 1 (Never fabricate; research and use standards), section 6 (Live state over seed data), section 10 (Research and Benchmarking section required), and section 11 (Data Model Stewardship).
- This is a spec, not an implementation. No code changes. No new tables landed. The deliverable is the Markdown file.
- Keep the spec small enough to finish in one session. If a sub-question is too big, name it as out-of-scope and link to a follow-up.
- Cite specific files and line numbers in the existing codebase where the spec interacts with current implementations: Prisma schema, MCP tool registry, qdrant client, neo4j client.
- Do not propose a Documentum-equivalent feature surface in volume. The goal is the minimum capability that unblocks document workspaces for AI coworkers, with extension points for the larger surface later.
- When done, open a PR titled `spec(doc-mgmt): document-management capability - draft`. Include a short PR summary, the open questions list lifted from section 9 of the spec, and a clear note that this is a draft for review.

Start by reading AGENTS.md, then `docs/superpowers/drafts/2026-05-12-agent-workspace-pattern.md`, then the live database schema for any model that looks documentish. Search for `KnowledgeArticle`, `WikiPage`, `Spec`, and related names. Then design from there.
