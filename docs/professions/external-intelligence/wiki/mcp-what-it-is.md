---
title: Model Context Protocol (MCP) — what it is
pageKind: entity
status: published
abstract: MCP is an open standard for connecting AI applications to external systems via servers that expose tools, resources, and prompts. A scouting target is a tool/resource surface an LLM client can mount, not a UI.
professionCompetencyLevel: foundational
sources:
  - mcp/intro
  - mcp/architecture
---

## Definition

The **Model Context Protocol (MCP)** is "an open-source standard for connecting AI applications to external systems" — described as "like a USB-C port for AI applications," one standardized connection interface.

## Architecture

MCP is **client-server**: a host application runs one client per server, and an "MCP Server: A program that provides context to MCP clients." Servers expose three primitives, which clients discover via list methods:

- **Tools** — executable actions.
- **Resources** — context data.
- **Prompts** — reusable templates.

Two transports: **stdio** (local process) and **Streamable HTTP** (remote — MCP recommends OAuth for auth tokens).

## Why It Matters for Scouting

For the external-intelligence coworker, a reconnaissance target is therefore **not a UI** but a **tool/resource surface** an LLM client can mount. Understanding the MCP shape (local vs remote, what primitives a server exposes) is the foundation for evaluating an external capability.

## See Also

- [[professions/external-intelligence/external-tool-catalog-reconnaissance]]
- [[professions/external-intelligence/server-health-assessment]]
- [[professions/external-intelligence/vet-before-adopting-external-tools]]
