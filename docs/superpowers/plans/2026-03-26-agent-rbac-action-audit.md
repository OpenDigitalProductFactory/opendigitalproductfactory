# Agent RBAC, Action Audit & Authority Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make agent tool_grants enforceable at runtime, record every tool call for audit, and give humans a dashboard to understand authority.

**Architecture:** ToolExecution Prisma model for audit, agent-grants.ts for grant loading/mapping, agent-scoped filtering in getAvailableTools(), Authority tab at /platform/ai/authority with execution log and effective permissions views.

**Tech Stack:** Next.js 16 (App Router, Server Components), Prisma 7.x, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-03-26-agent-rbac-action-audit-design.md`

**Status:** Executing
