---
name: requesting-code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
source: superpowers v5.0.5
---

# Requesting Code Review

Dispatch code-reviewer subagent to catch issues before they cascade.

**Core principle:** Review early, review often.

## When to Request Review

**Mandatory:** After each task in subagent-driven development, after major feature, before merge.

**Optional:** When stuck, before refactoring, after fixing complex bug.

## How to Request

1. Get git SHAs (BASE_SHA, HEAD_SHA)
2. Dispatch code-reviewer subagent with: what was implemented, plan/requirements, SHAs, description
3. Act on feedback: fix Critical immediately, Important before proceeding, note Minor for later

## Red Flags — Never:
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:** Push back with technical reasoning.
