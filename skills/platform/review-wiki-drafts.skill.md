---
name: review-wiki-drafts
description: "Walks the user through every pending draft in the org's wiki overlay one at a time — title + abstract + body preview + source citations — and acts on each decision (keep → publish, drop → archive, edit → open the in-portal editor). Calls list_wiki_overlay_drafts to enumerate, then batches the user's 'keep' decisions into publish_wiki_overlay_pages for a single round-trip. Use when the user asks to review pending drafts, after an ingest run, or when /wiki?status=all looks crowded."
category: platform
assignTo: ["documentation-specialist", "platform-engineer"]
capability: null
taskType: "conversation"
triggerPattern: "review.*drafts|review.*wiki|publish.*drafts|walk.*through.*drafts|wiki.*drafts.*pending"
userInvocable: true
agentInvocable: true
allowedTools: ["list_wiki_overlay_drafts", "publish_wiki_overlay_pages"]
composesFrom: []
contextRequirements: []
riskBand: medium
---

# Review and publish wiki overlay drafts

After an ingest run (or any other path that produces overlay drafts), this skill walks the user through them one at a time and acts on each decision. No file-system clicks; no per-page status flips. The coworker does the work; the user gives one-word answers.

## When to use

Trigger when the user says:
- "Review the wiki drafts"
- "Walk me through pending drafts"
- "Publish the drafts that look good"
- "What's at /wiki?status=all?"
- "Clean up the wiki review queue"

## Routing boundary — when NOT to use

| Situation | Use this skill? | Use what instead |
|---|---|---|
| User wants to review and publish overlay drafts | **Yes — this skill** | n/a |
| User wants to ingest a new article first | **No** | `ingest-article-from-url` skill, then this skill |
| User wants to edit a specific draft's body | **No** | Send them to `/wiki/edit/<slug>` (Phase 6b form) |
| User wants to edit a KERNEL page | **No** | `draft-kernel-edit-pr` skill (kernel is PR-only) |
| User wants to bulk-publish without reviewing | **No** | Call `publish_wiki_overlay_pages` directly with the id list |

## Read-first table

| Source | Path | What to extract |
|---|---|---|
| Pending drafts | `list_wiki_overlay_drafts` MCP tool | Every draft in the current org's overlay; slug, kind, body preview, source citations, kernel-override pointer |
| Wiki schema (when proposing edits) | `docs/founder-kernel/SCHEMA.md` | Required sections per page kind — used to spot drafts that are structurally incomplete |

## Steps

1. **Enumerate.** Call `list_wiki_overlay_drafts`. If the result is empty, reply *"No pending drafts in your overlay — `/wiki?status=all` is clean."* and stop. Don't loop on emptiness.

2. **Summarise.** Render a one-screen overview before walking through individual drafts:
   ```
   You have <N> pending drafts:
   - <N_e> entities, <N_s> stances, <N_h> heuristics, <N_p> principles, <N_d> decisions, <N_other> other
   - <N_overrides> override existing kernel pages; <N_originals> are org-original

   Want me to walk you through them, batch-publish all, or filter (e.g. 'only the stances')?
   ```

3. **Walk one at a time.** For each draft, render:
   ```
   Draft <i> of <N>: <slug>
   - Kind: <pageKind>
   - <override of kernel page <kernelSlug>, derived from kernel v<derivedFromKernelVersion>>  [only if kernelPageId is set]
   - Cites: <sourceSlugs joined>  [only if sources is non-empty]
   - Abstract: <abstract or "(none)">
   - Body preview (first 800 chars):
     <bodyPreview>
   ```
   Then ask: *"Keep, edit, or drop?"* Accept synonyms ("publish", "yes" → keep; "skip", "discard" → drop; "fix", "tweak", "polish" → edit).

4. **Track decisions.** Maintain three lists internally as the user answers: `keepIds[]`, `editSlugs[]`, `dropIds[]`. Don't call any MCP tool yet.

5. **Confirm before writing.** When the user has answered for every draft (or said "publish all the keepers"), summarise:
   ```
   Ready to commit:
   - Publish (<N_keep>): <slug list>
   - Edit later (<N_edit>): <slug list>  → I'll send /wiki/edit/<slug> links after
   - Drop (<N_drop>): <slug list>  → I'll archive these so they don't clutter /wiki?status=all

   Proceed?
   ```

6. **Execute.** On user confirmation:
   - Call `publish_wiki_overlay_pages` with `pageIds: keepIds`, `targetStatus: "published"`. Use `changeSummary: "Approved via review-wiki-drafts batch"`.
   - Call `publish_wiki_overlay_pages` with `pageIds: dropIds`, `targetStatus: "archived"`, `changeSummary: "Discarded via review-wiki-drafts batch"`.
   - For each slug in `editSlugs`, render a clickable line: `/wiki/edit/<slug>` so the user can open the editor.

7. **Report.** Render the result using the output template below.

## Output template

After execution:

```
**Review complete.**

Published <N_pub> draft(s): <slug list>
Archived <N_arch> draft(s): <slug list>
Open in editor: <slug list with /wiki/edit/<slug> links>

Rejected by the publish action (if any):
- <slug> — <reason>  (reasons: kernel | cross-org | not-found | already-target-status)
```

If the user said "batch publish all" without walking through:
```
**Batch-published <N> draft(s):** <first 6 slugs>...

I skipped the walkthrough as requested. Run me again with "review" if you want me to surface anything later.
```

If `list_wiki_overlay_drafts` returns empty:
```
No pending drafts in your overlay. `/wiki?status=all` is clean.

If you just ingested something and expected drafts here, check the ingest output for parse errors or commit errors — the drafts may have been rejected by the body-delta cap or the confidence threshold.
```

## Guardrails

- **Never** publish without explicit user confirmation (the "Proceed?" step). The skill is a UX wrapper, not an auto-approver.
- **Never** call `publish_wiki_overlay_pages` with `targetStatus: "draft"` — that would un-publish published pages, which is not the user's intent here.
- **Don't** invoke this skill in a loop on empty results. One empty check, then stop.
- **Refuse** if the user asks to "publish everything in the kernel" — kernel content is PR-only and not reachable from this skill. Redirect to `draft-kernel-edit-pr`.
- **Show the override pointer** when a draft has `kernelPageId` set. The user should know they're about to publish an override that masks the kernel content for their org.

## What this skill does NOT do

- Edit draft body content — use `/wiki/edit/<slug>` (Phase 6b form) for that.
- Promote a draft to a kernel page — kernel is PR-only.
- Ingest new sources — use `ingest-article-from-url` first.
- Run lint — use `wiki_lint` for that.

## See also

- `list_wiki_overlay_drafts` MCP tool (the enumerator this skill drives)
- `publish_wiki_overlay_pages` MCP tool (the batch publisher)
- `ingest-article-from-url` skill (the upstream producer of drafts)
- `wiki_ingest` MCP tool (Phase 2.3b)
- Spec: [EP-WIKI-001 §6](../../docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md)
