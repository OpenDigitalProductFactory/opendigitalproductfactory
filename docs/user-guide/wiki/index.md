---
title: "Platform Wiki"
area: wiki
order: 1
---

## Use This Doc For

- `/wiki`
- `/wiki/[...slug]`
- `/admin/wiki/lint`
- `/coworker-decisions/decisions` and `/coworker-decisions/decisions/[interactionId]`
- Founder-kernel pages, platform principles, entity notes, stances, heuristics, and source-backed knowledge

## Workflow

1. Use the wiki to inspect the platform knowledge that coworkers can cite or retrieve.
2. Open a page to review its body, kind, lifecycle status, source citations, and related links.
3. Treat lint findings as stewardship work: fix broken links, missing citations, unsupported claims, or conflicting pages before relying on the content broadly.
4. Keep public-facing statements, user-guide procedures, and design-history notes separate from wiki pages that are meant to guide coworker reasoning.

## Authoritative State

The wiki is authoritative for governed platform knowledge that has been imported, authored, linted, and published. It is not a substitute for runtime state, backlog state, or source code when those are the current evidence source.

## AI Coworker Support

Coworkers can retrieve wiki context, propose edits, and use principles as governance context. They must keep source-backed knowledge separate from guesses and should surface missing citations as stewardship issues.

WWMD uses the same wiki substrate for decision support. It retrieves relevant principles, compares candidate options against multiple dimensions, and returns a recommendation, arbitration, escalation, or deferral with confidence and sources attached. See [Autonomy, WWMD, and trusted coworker decisions](../../architecture/autonomy-and-wwmd.md).

How much each coworker acts on its own — its proactivity — is set from your industry's risk posture and can be confirmed or adjusted per coworker. See [Coworker Proactivity](../ai-workforce/coworker-proactivity.md).

## Reading The Decision Log

The decision log at `/coworker-decisions/decisions` is the record of what your AI workforce actually decided, split into three tiers: **WWMD** (platform doctrine), **WWWD** (your business), and **WSID** (role craft). Open a row for the options weighed, the rationale, the principles that pulled which way, and whether a human still needs to resolve it.

Each row is filed under **the gate that made the decision**, not the doctrine it happened to consult. This distinction matters when you are judging coverage: a role-craft (WSID) decision falls back to platform doctrine whenever that profession's corpus has nothing to say about the question, and it is still a WSID decision. Rows decided that way are marked as having used a fallback — read them as "the role decided, but not from its own craft yet", which is a signal to grow that profession's corpus rather than evidence the tier is working well.

A tier reading **"never used"** means that gate has recorded nothing. Treat it as a question, not a conclusion: it can mean the gate genuinely is not exercised, or that nothing is wired to call it. Compare it against the **Consults by caller** panel on the same page — a coworker that never appears there has never consulted the kernel at all.

## Escalated And Deferred Decisions: What To Do

Rows marked **escalate** or **defer** carry an "awaiting review" chip until a human answers. Escalated means the AI stopped short of deciding alone — the call was high-risk, its confidence was low, two principles conflicted, or the consult carried no scoreable options. Deferred means it found no recorded guidance at all, so it declined to guess.

Neither outcome silently blocks work. The coworker that asked handled its own moment and moved on; the one exception is a Build Studio build paused at a decision gate, and that row says so. The log header totals what is waiting per tier, and each decision's drill-in now explains, in plain language, what its outcome means, whether anything is waiting on you, and the next steps with links.

Do not work the log line by line. Review & adjust groups the waiting rows into themes; answering a theme once — or adding a stance or craft guidance that covers it — teaches your AI so that question stops needing a human.

## Review & Adjust Findings

`/coworker-decisions/review` surfaces findings over the accumulating decision ledger so you can keep governance sharp without reading every row: conflicting principles, gaps where the doctrine has no settled answer yet, a canonical decision that quietly drifted under a doctrine change, and stale decision material.

**Weight-adjustment proposals** are a fifth finding type: when your recorded decisions in one class systematically separate from the kernel's recommendation on a specific axis (e.g. consistently favoring speed over long-term maintainability), the platform proposes adjusting how much that axis should weigh — never automatically. Each proposal shows the axis, direction, how many decisions it's based on, and how consistent the pattern is. Accept it to record it at the same `ruled` authority a real human ruling on stance material reaches, or reject it (with an optional reason) so it stops resurfacing. Accepting does not yet change any live decision score by itself — it is evidence the platform is confident enough to name, not an automatic rule change.

## What To Watch

- pages marked draft being cited as established policy
- useful imported content that has no source citation
- principle pages that conflict with current `AGENTS.md` or architecture standards
- wiki context being treated as a runtime database query
