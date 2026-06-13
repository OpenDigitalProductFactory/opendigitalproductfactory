---
title: ArchiMate — the three core layers
pageKind: summary
status: published
abstract: ArchiMate is an open enterprise-architecture modeling language that relates three core layers — Business, Application, Technology — through service-orientation, plus motivation, strategy, and implementation elements.
professionCompetencyLevel: foundational
sources:
  - opengroup/archimate-3-2
---

## What This Source Is

**ArchiMate** is an open, tool-independent enterprise-architecture modeling language for describing, analyzing, and visualizing relationships across business domains. Its defining structure is a set of layers related by **service-orientation**.

> Provenance/licensing note: the full ArchiMate 3.2 specification is OAuth-gated (The Open Group). This page records only the well-established layer structure from the public overview; element-level modeling guidance requires the licensed specification.

## The Three Core Layers

- **Business layer** — business services, processes, actors, and roles.
- **Application layer** — application services and components that support the business.
- **Technology layer** — infrastructure services, nodes, and platforms that run the applications.

Service-orientation and **realization** relationships link concrete elements to the more abstract services they provide, so each layer's services support the layer above. ArchiMate also spans Motivation, Strategy, and Implementation & Migration elements, plus stakeholders, viewpoints, and views.

## How DPF Coworkers Use It

- Before placing an element, decide **which layer** it belongs to — the most common modeling error is mixing layers.
- Map architecture work to the value streams of [[professions/enterprise-architecture/it4it-value-streams]] and the phases of [[professions/enterprise-architecture/togaf-adm-phases]].
- Capture significant modeling choices as [[professions/enterprise-architecture/record-decisions-as-adrs]].

## See Also

- [[professions/enterprise-architecture/togaf-adm-phases]]
- [[professions/enterprise-architecture/it4it-value-streams]]
- [[professions/enterprise-architecture/record-decisions-as-adrs]]
