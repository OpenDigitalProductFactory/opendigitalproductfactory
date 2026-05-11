---
title: Founder Kernel
pageKind: index
status: published
abstract: Top-level index for the founder kernel. Lists what's authored, what's planned, and how to navigate.
---

## What this is

The founder kernel is the wisdom layer that ships with DPF. It answers the question every user eventually asks: **&#34;what would Mark do?&#34;** Pages here are not summaries of external material; they are the platform's stance, organised by kind.

This index page exists to make the kernel navigable for humans. Agents discover pages via the wiki retrieval layer (`wiki_query` MCP tool, passive recall into Block 5) — they don't need this index. Humans do.

## Page kinds

Six kinds live under `wiki/`. Their roles are defined formally in [`SCHEMA.md`](../SCHEMA.md); briefly:

| Kind | Role |
|---|---|
| **stance** | A position. &#34;Mark's view on X.&#34; First-person, cited, opinionated. The judgment surface. |
| **heuristic** | An operational rule of thumb derived from a stance. Smaller, more specific, often quantitative. |
| **entity** | A canonical concept the platform refers to repeatedly (Digital Product, Portfolio, Value Stream, …). Neutral voice. |
| **decision** | A formal record of a choice with context, options considered, and consequences. `DEC-YYYY-…` slug. |
| **summary** | A distillation of external source material, with at least one extracted stance or heuristic. |
| **runbook** | Operational procedure for a specific task. Step-by-step. |
| **index** | Scaffolding — pages like this one that help navigate the kernel. |

Read [`AUTHORING.md`](../AUTHORING.md) to add a page in under 60 seconds.

## What's authored right now

Nothing. This index is the first kernel page seeded.

The platform plumbing is ready — schema, retrieval, lint, viewer, agent integration — and waiting for content. The fastest way to make the kernel useful is to author 3–5 stance pages on topics people already ask &#34;what would Mark do?&#34; about. Heuristics and entity pages can grow alongside.

## How to find your way around

Once content lands:

- **Browse**: `/wiki` lists every published page grouped by kind. Stances and heuristics surface at the top.
- **Search via the agent**: ask any coworker a question that touches a kernel concept. The wiki retrieval layer injects relevant pages into the system prompt automatically, and the agent can also call `wiki_query` directly for explicit lookup.
- **Author**: copy a template from [`_templates/`](../_templates/) into `wiki/&lt;kind&gt;s/&lt;slug&gt;.md`, fill it in, run the seed.
- **Audit**: `/admin/wiki/lint` shows findings (orphans, dangling refs, stale citations, summary pages missing extracted stances). The daily Inngest job populates this; the `wiki_lint` MCP tool triggers it on-demand.

## Org overlay

Customers will eventually be able to override or extend kernel pages with their own takes. That overlay UX is plumbed (Prisma schema, retrieval helpers) but the propose-edit UI is not yet shipped. Everything in `docs/founder-kernel/` is currently kernel-scoped — visible to every install equally.
