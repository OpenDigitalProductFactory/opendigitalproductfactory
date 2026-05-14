---
title: "Platform"
area: platform
order: 1
lastUpdated: 2026-05-14
updatedBy: Codex
---

## Overview

Use the Platform area to supervise AI operations, Edge Nodes, integrations, identity, auditability, and estate-wide tooling. This section is for operators who need to understand how the platform is behaving, not just whether a single workflow succeeded.

## Route Coverage

- `/platform/ai/*` for workforce operations, routing, assignments, history, and authority
- `/platform/edge-nodes` for host-resident trust, discovery intake, and Edge Node freshness
- `/platform/identity/*` for directory, principals, groups, and authorization posture
- `/platform/audit/*` for operational audit flows and traceability
- `/platform/tools/*`, `/platform/services/*`, and `/platform/integrations/*` for tool servers, discovery, and connector operations

## Use The Specific Guides When

- you are changing provider, routing, or assignment behavior
- you are reviewing Edge Node trust, heartbeat, or discovery intake
- you are reviewing who can do what, and why
- you are validating audit coverage or governance evidence
- you are activating or troubleshooting discovery, services, or integrations

## Specific Guides

- [AI Operations](ai-operations) - operations map, capacity continuity, assignments, capability needs, and history.
- [Edge Nodes](edge-nodes) - Edge Node enrollment, trust, freshness, and host-level runbook links.
- [Tools and Integrations](tools-and-integrations) - tool catalog, native integrations, MCP surfaces, and service posture.
