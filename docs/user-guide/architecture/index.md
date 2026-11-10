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

Within Coordination, **Owner and links** shows the accountable person and whether
that responsibility is explicit, inherited from a room, or recorded for the
organization. Conflicting or incomplete ownership remains a setup gap. Recorded
parent, child and dependency links lead to the related room while keeping your
filters. A dependency alone does not prove the work is waiting. An incomplete
read is labeled; no links observed is not proof that no links exist.

Open **Architecture > Workrooms** (`/ea/workrooms`) to see the rooms that are actually running and how they sit across the four portfolios. The page leads with a true count of open rooms — completed and archived rooms are excluded — and says plainly how many have no portfolio recorded. Those are reported as unclassified, never quietly filed under a portfolio nobody assigned. Where team plans exist, each is grouped under its owning portfolio with its shape, participants, queues, triggers and process view.

A team is placed in a portfolio from what the platform actually records: an explicit portfolio role on the team wins, and its portfolio slug or name are used only as weaker fallbacks. When none of those decides the question, the team is listed under **Not placed in a portfolio** with the reason, instead of being shown inside a portfolio nobody assigned it to. Those teams are counted separately, so a portfolio's total only ever counts teams that genuinely belong to it. Correct a placement by setting the team's portfolio role or linking it to the right portfolio.

The overview room count is a real total. The plan list and the Coordination list are each a bounded read. **More plans exist** identifies a truncated plan list; **Next rooms** continues through matching open rooms in Coordination. Its count describes the displayed page. If no team plans are configured on your install, the page says exactly that rather than implying you forgot to set one up — there is currently no in-product way to create one, so an install with none is normal.

## What You Can Do

- Create and edit architecture views across business, application, and technology layers
- Apply standard ArchiMate, BPMN, or SysML viewpoints, or define custom ones for your audience
- Start from reference models and tailor them to your organization
- Map value streams to the products and capabilities that support them
- Use the AI coworker to generate a draft architecture view from a description
- Export a view as a Draw (.odg), SVG, PDF or PNG drawing (see below)
- Import a Visio or Draw diagram as candidate elements and relationships to review
- Select an element to open its **Architecture context**, then follow the shortest
  available links to the same concern in related ArchiMate, BPMN, or SysML views
- For projected AI routing elements, open the matching operational evidence and
  inspect the safe decision inputs, possible outcomes, design version, evidence
  freshness, and implementation source
- Use **Refresh live projections** when you are authorized to rebuild governed
  BPMN, SysML, and ArchiMate views from their canonical sources

## Exporting a view as a drawing

Open a view and choose **Export / Import** at the top right of the canvas to
download it as a drawing that people can open without DPF:

- **Draw (.odg)** opens in LibreOffice Draw with one shape per element and a
  connector for each relationship, so it can still be edited there.
- **SVG (.svg)** is a scalable image for web pages and documents.
- **PDF (.pdf)** is for printing and sharing.
- **PNG (.png)** is a picture for slides and chat.

The drawing uses the view's saved layout and the same layer colours as the
canvas (business yellow, application blue, technology green). Relationship lines
and label text use your organization's brand colours. Duplicate relationships
are drawn once, as on the canvas. A single drawing holds up to 500 elements.

The export runs on the platform's document engine. If the engine is not set up
on your install, Export says so and nothing is downloaded.

You can also ask the Enterprise Architect coworker to export a view. It saves the
drawing as a document (the .odg, with its PDF and SVG kept alongside) and gives
you the link. This is a picture of the view, not a model exchange: to move the
model itself into another ArchiMate tool, use the ArchiMate exchange export.

## Importing a Visio or Draw diagram

If your organization already keeps architecture diagrams in Visio (.vsd, .vsdx)
or LibreOffice Draw (.odg), you can bring what they show into review. Open any
view, choose **Export / Import**, then **Import a diagram…**:

1. Choose the file and select **Import diagram**. Files up to 900 KB are accepted.
2. The platform's document engine reads the drawing. Each labelled shape becomes
   a candidate element, and each connector that joins two shapes becomes a
   candidate relationship, with the connector's label if it has one.
3. Open the import to see a picture of the diagram beside the candidates. Accept
   or reject each one.

Nothing is added to your model by an import or by accepting a candidate. Accepting
records that the candidate is right; adding it to a view is still done on the
canvas. Shapes with no text and connectors whose ends do not reach two shapes are
not listed; the import says how many connectors were left out. A diagram DPF
exported (see above) imports with its layer shown for each shape.

Importing the same file twice shows the first import again instead of making
duplicates. You need permission to edit the architecture model to import or
review; anyone who can see the views can see the candidates. If the document
engine is not set up on your install, the import says so and nothing is saved.

## AI Coworker Identity

Architecture views may still contain older `/ea/agents` links from governance
and route projections. Those links are compatibility paths. They now open
`/platform/identity/agents`, the canonical **AI Coworker Identity** page for
principal coverage, portable identity metadata, and authorization inspection.
Use the AI Workforce area for everyday coworker discovery and work assignment.

## Following a Concern Across Views

On **Workrooms**, open **Initiatives** to find a named initiative and see its
recorded purpose, scope and open rooms. Search by name or ID, then select its
link to narrow Coordination. Partial or unavailable reads are labeled. Initiative
membership does not establish a value-stream link, capability link or reporting
relationship. The selected initiative and search stay with you through a room
and its process, including the **Operation** return link.

On **Workrooms**, expand **Coordination** to open an actual room. Use **Find a room**
to search by title or room ID and filter by operation or status. **Next rooms**
continues the bounded list; changing filters starts a new first page. A room with
no team plan behind it says so explicitly. Select a plan's room link to narrow
the list to that operation first. Recorded stage waits name the responsible role
when the execution source records it.

Inside the room, select a process step to inspect its reason, next action, owner
and evidence. **Operation** returns to the same operation, filters and page. Intended
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
