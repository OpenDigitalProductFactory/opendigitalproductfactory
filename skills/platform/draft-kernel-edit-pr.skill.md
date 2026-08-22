---
name: draft-kernel-edit-pr
description: "Draft a GitHub pull request that edits a founder-kernel page. Kernel pages under docs/founder-kernel/ are PR-only per spec §4 (never written by the runtime); this skill walks the user through reading the current markdown, applying the requested change, validating wikilinks + manifest counts, and opening a draft PR for review. Use for principles, stances, heuristics, entities, and the kernel index. Org-overlay edits use /wiki/edit/<slug> instead."
category: platform
assignTo: ["platform-engineer", "external-coding-agent"]
capability: null
taskType: "conversation"
triggerPattern: "edit kernel|update principle|edit principle|change kernel|kernel edit|propose kernel"
userInvocable: true
agentInvocable: false
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Draft a Kernel-Edit PR

Founder-kernel pages under `docs/founder-kernel/wiki/` are **PR-only** (spec §4 — kernel pages are the founder's voice, governed by code review, never written by the runtime). To change a kernel page, you draft a markdown edit and open a PR. This skill walks the user through that.

## When to use

Trigger when the user says any of:
- "Update `principles/<slug>` to add/remove/change <X>"
- "Edit the kernel principle on <topic>"
- "Propose a change to the founder kernel"
- "Open a PR to fix <kernel page>"

## Routing boundary — when NOT to use

| Situation | Use this skill? | Use what instead |
|---|---|---|
| The page header says **Kernel · v<x>** | **Yes — this skill** | n/a |
| The page header says **Org overlay** or **Org-original** | **No** | Click "Edit" on `/wiki/<slug>` — calls `saveWikiOverlayEdit` directly, lands a draft revision the user can flip to published |
| The change is a bulk rename of slugs | **No** | Open a manual PR — slug rename needs inbound-link migration logic this skill doesn't handle |
| The change is deleting a kernel page | **No** | Open a manual PR setting `status: "archived"` in frontmatter — deletion is non-trivial because of source citations |
| The user is editing an `EvidenceSource`, `KnowledgeArticle`, or anything outside `docs/founder-kernel/` | **No** | Different surface entirely — those are not kernel content |

## Read-first table

Before applying any edit, load these into context:

| Source | Path | What to extract |
|---|---|---|
| Target kernel page | `docs/founder-kernel/wiki/<slug>.md` | Frontmatter, body, current `[[wikilinks]]`, current `sources:` array |
| Schema contract | `docs/founder-kernel/SCHEMA.md` | Required sections for the page kind being edited; cross-link rules |
| Authoring guide | `docs/founder-kernel/AUTHORING.md` | Frontmatter shape, slug conventions, publish flow |
| Manifest | `docs/founder-kernel/manifest.json` | Current `kernelVersion`, `pageCount`, `sourceCount` (only edit when adding pages/sources) |
| Dimension registry (principle edits only) | `packages/db/src/wiki-taxonomy.ts` | `PRINCIPLE_DIMENSIONS` — every key in a `principleDimensionVector` must be in this list |
| Spec edit policy | `docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md` §4 | Kernel-PR-only rule + body-delta cap reasoning |

## Steps

1. **Locate the target page.** Ask the user which slug they're editing, or read it from context if a link to `/wiki/<slug>` was given. Confirm the file lives under `docs/founder-kernel/wiki/<slug>.md`.

2. **Read the current markdown.** Use the Read tool to load the file. Show the user the relevant section so they can confirm you're working on the right text.

3. **Apply the edit.** Use the Edit tool with `old_string` and `new_string` matching exactly. Preserve frontmatter unless the user explicitly asks to change a frontmatter field (e.g. `principleTier`, `status`, `sources`).
   - When editing `principle` pages, remember that `principleDimensionVector` validation runs against the dimension registry (`packages/db/src/wiki-taxonomy.ts`). Don't invent dimensions.
   - When editing `[[wikilinks]]`, verify the target slug resolves to an existing page (`ls docs/founder-kernel/wiki/<kind>s/`) before linking — dangling links block publish at lint time.

4. **Update the manifest if needed.**
   - If you ADDED a new page, increment `pageCount` in `docs/founder-kernel/manifest.json`.
   - If you ADDED a new raw source, increment `sourceCount`.
   - Bump `kernelVersion` per semver: patch for typo fixes, minor for content additions, major for schema-breaking changes.
   - `schemaVersion` bumps separately when a page-kind contract or lint rule changes — not for content edits.

5. **Run a quick local lint check.** Verify the edit didn't break wikilinks:
   ```
   grep -oE '\[\[[^]]+\]\]' docs/founder-kernel/wiki/<slug>.md | sort -u
   ```
   Cross-reference each `[[target]]` against the file tree. Any that don't resolve are dangling — fix before opening the PR.

6. **Create a branch + commit.**
   - Branch name: `kernel-edit/<short-description>` (e.g. `kernel-edit/do-the-work-add-staging-scope`).
   - Commit message follows the repo convention: `docs(wiki): <imperative summary> (<kernel-slug>)`.
   - Sign-off via `Signed-off-by:` trailer matching the commit author.

7. **Open the PR.** Use the GitHub MCP `create_pull_request` tool (available when the session has GitHub MCP wired):
   - Title: 50-72 chars, names the slug + the change. Example: `docs(wiki): tighten "reach" definition in do-the-work principle`.
   - Body must include:
     - **Why this edit is needed** (1-2 sentences naming the gap)
     - **What changed** (markdown diff or section-by-section summary)
     - **Verification** — wikilinks resolve; if a principle, dimension vector keys are in the registry; if a stance, sources still cite valid raw-source files
   - Open as DRAFT so Mark reviews before it merges.

8. **Link the PR back.** Reply to the user with the PR URL and a one-line summary of what landed. Don't claim "done" until the PR is open — that's the HITL gate (Mark reviews + merges + redeploys).

## Guardrails

- **Never** push to `main` directly. Always a branch + PR.
- **Never** edit `docs/founder-kernel/` files outside this skill's flow without an explicit PR — the seed runs at deploy time and silent edits look like deliberate kernel changes.
- **Refuse** if the user asks for a kernel edit that requires judgment beyond the explicit instruction (e.g. "rewrite this principle to be better" — ask them to be specific about what to change). This skill is a mechanic, not an editorial voice.
- **Refuse** if the file change would replace more than ~30% of the page body in one shot — same body-delta cap the proposal commit step enforces. Large rewrites should be staged across multiple PRs so each one is reviewable.
- **Don't bypass DCO.** Every commit needs a `Signed-off-by:` line.

## What this skill does NOT do

- Edit org-overlay pages (use the `/wiki/edit/<slug>` form — Phase 6b)
- Bulk-rename slugs (needs migration logic for inbound `[[wikilinks]]`)
- Delete kernel pages (use `status: "archived"` instead; deletion is non-trivial because of source citations and inbound links)
- Promote a kernel page from `draft` to `published` (that's a frontmatter status change but it's still a kernel edit — go through this same PR flow)

## Output template

When the PR is open, reply to the user with this exact shape so subsequent invocations produce the same audit trail:

```
**Kernel-edit PR drafted.**

- Page: `<slug>`
- Branch: `kernel-edit/<short-description>`
- PR: <URL>
- Change summary: <one sentence>
- Body-delta ratio: <new_length - old_length> / <old_length> = <pct>% (cap is 30%)
- Wikilinks resolved: <N validated, M skipped raw-source>
- Manifest bumped: kernelVersion <old> → <new>  (pageCount <old> → <new>, sourceCount <old> → <new>)

Reviewer: open the PR, verify the diff, merge when ready. The seed picks up the change on the next deploy.
```

If any check failed (dangling wikilink, body-delta over cap, missing frontmatter), the reply should be:

```
**Kernel-edit DRAFT — not yet opened as PR.**

Blocking issue(s):
- <issue 1>
- <issue 2>

Proposed resolution: <one sentence per issue>

Confirm the resolution and re-invoke this skill to proceed.
```

## See also

- Spec section 4: [Edit Policy](../../docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md)
- Authoring guide: [docs/founder-kernel/AUTHORING.md](../../docs/founder-kernel/AUTHORING.md)
- Schema contract: [docs/founder-kernel/SCHEMA.md](../../docs/founder-kernel/SCHEMA.md)
- Overlay edit path (the alternative): `/wiki/edit/<slug>` in the portal
