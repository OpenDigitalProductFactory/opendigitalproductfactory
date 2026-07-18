---
title: "Platform Wiki"
area: wiki
order: 1
---

## Use This Doc For

- `/wiki`
- `/wiki/[...slug]`
- `/admin/wiki/lint`
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

## What To Watch

- pages marked draft being cited as established policy
- useful imported content that has no source citation
- principle pages that conflict with current `AGENTS.md` or architecture standards
- wiki context being treated as a runtime database query
