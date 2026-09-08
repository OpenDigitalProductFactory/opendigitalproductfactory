---
title: "Enterprise Architecture"
area: architecture
order: 1
---

## Overview

The EA Modeler is a canvas-based tool for building and maintaining your organization's enterprise architecture. Models are created in ArchiMate 4 (the default notation for enterprise structure), with BPMN 2.0 for process/workflow behaviour and SysML v2 for systems requirements, constraints, interfaces, and verification. They are intended to be implementable — not just decorative diagrams. They connect directly to the products, technology, and operations managed elsewhere in the platform.

## Key Concepts

- **ArchiMate 4** — The default open-standard notation for enterprise structure, across three layers: Business (capabilities, actors, roles), Application (services, components, interfaces), and Technology (infrastructure, platforms, networks). Best for cross-layer dependencies and strategy alignment.
- **BPMN 2.0** — For process and workflow behaviour: sequences, gateways, events, and swimlanes (who does what — human or AI coworker).
- **SysML v2** — For systems architecture: requirements, constraints, interfaces, allocations, verification cases, and traceability. An architect-facing viewpoint (see Views & Viewpoints), not a default end-user surface.
- **Views and Viewpoints** — A viewpoint defines which elements and relationships are relevant for a particular audience. A view is a specific diagram built from that viewpoint.
- **Reference Models** — Prebuilt architecture patterns (e.g., cloud-native application, integration hub) that can be adapted and incorporated into your own models.
- **Value Streams** — End-to-end sequences of activities that deliver value to a customer or stakeholder. Modelled in the business layer and traceable to the products and capabilities that enable them.
- **Workroom Definitions** — Reusable collaboration patterns attached to value streams. Each definition names its portfolio, shape, participants, queues, human triggers, linked process view, and associated running instances.

## Reference Models and your archetype

Some reference models are universal and some belong to one industry. IT4IT describes IT management for any organisation that runs IT, so every install gets its full criteria set. An industry model such as the BIAN Service Landscape serves banking, and its criteria are imported only on an install whose archetype is a banking one.

The catalogue entry is kept everywhere on purpose, so you can see that the standard exists and what it is for. On an install it does not serve, the model is listed as **not this archetype** with the reason, instead of showing a lifecycle status beside empty counts. Empty counts there are correct rather than incomplete: the criteria were never imported because the model is not your business.

If you change the archetype your install declares, the next seed imports the criteria for any industry model that now applies.

## Workroom Definitions

Open **Architecture > Workrooms** (`/ea/workrooms`) to see the rooms that are actually running and how they sit across the four portfolios. The page leads with a true count of open rooms — completed and archived rooms are excluded — and says plainly how many have no portfolio recorded. Those are reported as unclassified, never quietly filed under a portfolio nobody assigned. Where team plans exist, each is grouped under its owning portfolio with its shape, participants, queues, triggers and process view.

A team is placed in a portfolio from what the platform actually records: an explicit portfolio role on the team wins, and its portfolio slug or name are used only as weaker fallbacks. When none of those decides the question, the team is listed under **Not placed in a portfolio** with the reason, instead of being shown inside a portfolio nobody assigned it to. Those teams are counted separately, so a portfolio's total only ever counts teams that genuinely belong to it. Correct a placement by setting the team's portfolio role or linking it to the right portfolio.

The room count is a real total. The plan list and the Coordination list are each a bounded read; when more exist than are shown the page says so (**Partial read**, **More rooms exist**), so a bounded list is never mistaken for the whole estate. If no team plans are configured on your install, the page says exactly that rather than implying you forgot to set one up — there is currently no in-product way to create one, so an install with none is normal.

## What You Can Do

- Create and edit architecture views across business, application, and technology layers
- Apply standard ArchiMate, BPMN, or SysML viewpoints, or define custom ones for your audience
- Start from reference models and tailor them to your organization
- Map value streams to the products and capabilities that support them
- Use the AI coworker to generate a draft architecture view from a description
- Select an element to open its **Architecture context**, then follow the shortest
  available links to the same concern in related ArchiMate, BPMN, or SysML views
- For projected AI routing elements, open the matching operational evidence and
  inspect the safe decision inputs, possible outcomes, design version, evidence
  freshness, and implementation source
- Use **Refresh live projections** when you are authorized to rebuild governed
  BPMN, SysML, and ArchiMate views from their canonical sources

## AI Coworker Identity

Architecture views may still contain older `/ea/agents` links from governance
and route projections. Those links are compatibility paths. They now open
`/platform/identity/agents`, the canonical **AI Coworker Identity** page for
principal coverage, portable identity metadata, and authorization inspection.
Use the AI Workforce area for everyday coworker discovery and work assignment.

## Following a Concern Across Views

On **Workrooms**, expand **Coordination** to open an actual room. It shows open rooms from a bounded database read and
reports when more exist. A room with no team plan behind it says so explicitly.
Select a plan's room link to narrow the list to that operation first.

Inside the room, select a process step to inspect its reason, next action, owner
and evidence. **Operation** returns to the same architecture selection. Intended
process and observed records remain separate: a graph alone does not establish
BPMN execution or SysML conformance.

Select an element on an architecture canvas and open **Architecture context** in
the inspector. **Related viewpoints** lists the nearest views that explain the
same element or a directly linked concern. Each link names the notation, target
view, and link distance so you can see why it is being suggested.

AI routing elements can also offer **Open operational evidence**. This opens the
AI Operations Map in Compare mode, focused on the same routing stage. The
architecture remains the designed projection; the Operations Map supplies the
observed evidence and calls out gaps rather than treating missing evidence as
proof that the design ran.

The **Why this decision works this way** section deliberately shows only safe
metadata. It can include decision inputs such as sensitivity class or provider
eligibility, possible outcomes, the design version, implementation status, and
the latest evidence time. It never exposes prompt text or protected payload
values.
