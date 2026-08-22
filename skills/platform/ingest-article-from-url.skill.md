---
name: ingest-article-from-url
description: "End-to-end skill that ingests a markdown article from a public URL into the org's wiki overlay as draft pages. Fetches the URL via fetch_public_website, writes a local raw-source file, runs wiki_ingest with the three-pass LLM extraction (claims + stances + heuristics), shows the structured proposal for review, and on user confirmation commits as draft overlay pages. Kernel pages stay PR-only; this skill writes overlays only. Use when the user pastes a URL and says 'ingest this' or 'add this article to the wiki'."
category: platform
assignTo: ["documentation-specialist", "platform-engineer", "external-coding-agent"]
capability: null
taskType: "conversation"
triggerPattern: "ingest.*article|ingest.*url|add.*article.*wiki|wiki.*from.*url|ingest.*linkedin|pull.*into.*wiki"
userInvocable: true
agentInvocable: false
allowedTools: ["fetch_public_website", "wiki_ingest"]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Ingest an article from a URL into the wiki overlay

Closes the user-facing loop on `wiki_ingest`. The user pastes a URL; the coworker does the rest — fetch, save to disk, run the three-pass extraction, show the proposal, commit on confirmation. Kernel pages stay PR-only; this skill only writes to the org's overlay (drafts that the user can publish later via `review-wiki-drafts`).

## When to use

Trigger when the user says any of:
- "Ingest [URL] into the wiki"
- "Add this article to our wiki: [URL]"
- "Pull [URL] into the kernel" (clarify scope: this skill creates an overlay draft, not a kernel page)
- "Use [LinkedIn URL] as a source"

## Routing boundary — when NOT to use

| Situation | Use this skill? | Use what instead |
|---|---|---|
| User pastes a URL and wants the content in the wiki | **Yes — this skill** | n/a |
| User wants a NEW kernel principle / stance / heuristic that ships with every install | **No** | `draft-kernel-edit-pr` skill — opens a GitHub PR against `docs/founder-kernel/` |
| User wants to review pending drafts you already ingested | **No** | `review-wiki-drafts` skill |
| User pasted a URL but only wants to summarise it (no wiki rows) | **No** | Use `fetch_public_website` directly + render the summary in chat |
| Source is a local markdown file already in `/workspace` | **No (skill is URL-only)** | Call `wiki_ingest` directly with `filePath` |

## Read-first table

| Source | Path | What to extract |
|---|---|---|
| URL the user pasted | (user message) | The URL itself; any context they gave about what to extract |
| Wiki schema | `docs/founder-kernel/SCHEMA.md` | Page-kind contract — claims become entities, positions become stances, rules become heuristics |
| Authoring guide | `docs/founder-kernel/AUTHORING.md` | Slug conventions; what the user expects to see in `/wiki?status=all` after ingest |

## Steps

1. **Confirm scope.** Echo the URL back to the user. Confirm overlay-only (default) — never kernel. If the user wants kernel content, redirect to `draft-kernel-edit-pr`.

2. **Fetch.** Call `fetch_public_website` with the URL. The tool returns the page's markdown-ified content. If the fetch fails (404, paywall, robots.txt block), stop and tell the user — do NOT fall back to fabricated content.

3. **Write a local raw-source file.** Save the fetched content as a markdown file under `/workspace/wiki-ingest-staging/<derived-slug>.md` with frontmatter:
   ```yaml
   ---
   title: <article title or h1 from the body>
   sourceType: article
   url: <the URL the user pasted>
   publishedAt: <ISO date if the page has one>
   authors:
     - <author name(s) if available>
   ---

   <fetched markdown body>
   ```
   Use the Write tool with an absolute path. Slug derivation: `<url-host-stem>/<url-path-slug>` — e.g. `linkedin/why-product-centricity-critical`.

4. **Propose.** Call `wiki_ingest` with:
   - `filePath`: the absolute path you just wrote
   - `mode`: "propose"
   - `sourceKey`: `articles/<derived-slug>` (so the wiki has a stable handle)
   - `sourceType`: "article"

   Render the proposal back to the user in chat. Use this output template:

   ```
   Proposal from <URL>:
   - <N> claim(s): <slug list>
   - <M> stance(s): <slug list>
   - <K> heuristic(s): <slug list>
   - Skipped (low confidence): <count>
   - Parse errors: <count, if any>

   Commit as draft overlay pages? (yes / no / edit-first)
   ```

5. **Commit on confirmation.** If user says "yes" (or equivalent affirmation):
   - Re-call `wiki_ingest` with the same args but `mode: "commit"`.
   - Reply with the committed-slug list and a pointer: "Drafts at /wiki?status=all. Run review-wiki-drafts when you're ready to publish."

   If user says "no" or "drop", confirm nothing was written and stop.

   If user says "edit first", offer to drop specific claims/stances/heuristics — pass a filtered subset to the next `wiki_ingest --commit` call (Phase 2.3c work: not built yet, so for now respond "the filter is not yet supported — for v1, commit then use review-wiki-drafts to drop individual drafts").

## Output template

```
**Ingested <URL> into the wiki overlay.**

Drafts created (in /wiki?status=all):
- <slug> (<page-kind>)
- ...

Audit event: <eventId>

When you're ready to publish, ask me to "review wiki drafts" and I'll walk you through each one.
```

If commit fails:
```
**Ingest of <URL> halted.**

Reason: <error message>

What you can do:
- Retry once (transient inference errors usually clear)
- Check provider health on /platform (inference catalog routing failure)
- Hand me a different URL
```

## Guardrails

- **Never** commit to kernel pages. `wiki_ingest` refuses kernel writes at the engine layer; this skill must not even try.
- **Never** invent content if `fetch_public_website` fails. Stop and report. Fabricated source material poisons the kernel.
- **Never** commit without explicit user confirmation. The proposal step exists exactly so the user signs off.
- **Don't** delete the raw-source file under `/workspace/wiki-ingest-staging/` after the commit — the audit trail references it via `RawSource.fullTextPath` for later spot-checks.
- **Refuse** if the user says "ingest this kernel-grade" — that needs the `draft-kernel-edit-pr` skill, not this one.

## What this skill does NOT do

- Fetch from auth-walled URLs (LinkedIn premium, paid newsletters). If `fetch_public_website` returns auth-wall content, surface the limitation to the user.
- Translate non-English sources (the LLM extraction prompts assume English).
- Promote drafts to published — use `review-wiki-drafts` afterward.
- Edit existing wiki pages — use `/wiki/edit/<slug>` or `saveWikiOverlayEdit` directly.

## See also

- `wiki_ingest` MCP tool (Phase 2.3b)
- `review-wiki-drafts` skill (the next step after a commit)
- `draft-kernel-edit-pr` skill (the kernel-content path, not overlay)
- Spec: [EP-WIKI-001 §6](../../docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md)
