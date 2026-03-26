# CSDM V3 Framework Mapping: Archimate V3

- Title: CSDM V3 Framework Mapping: Archimate V3
- Video URL: https://www.youtube.com/watch?v=kx8HJ1rumys
- Playlist position: 63
- Frameworks discussed: CSDM, ArchiMate, TOGAF
- Evidence basis: YouTube MCP playlist metadata, `yt-dlp` chapter metadata, and a successful transcript-availability probe captured before YouTube later rate-limited bulk extraction.

## Short summary
This session is a direct CSDM v3 to ArchiMate mapping walkthrough. The chapter structure shows it moving from ArchiMate basics into similarities and differences, then into specific technology-layer mappings such as location hierarchy, equipment, system software, and technology services, with a brief TOGAF perspective included.

## Key mapping concepts
- ArchiMate 3.1 technology-layer concepts aligned to CSDM v3 constructs
- Similarities and differences between enterprise architecture abstractions and ServiceNow's service data model
- Location, equipment, system software, and technology service as concrete mapping anchors
- A lightweight TOGAF viewpoint used to position the ArchiMate crosswalk

## Notable terminology used
- CSDM
- ArchiMate 3.1
- TOGAF
- Technology layer
- Location hierarchy
- Equipment
- System software
- Technology service

## What still seems valid
The useful part is the discipline of mapping explicit EA concepts into a constrained operational meta-model instead of treating architecture views and service-model classes as interchangeable. The technology-layer focus is still relevant for ontology work that needs precise realization links from abstract product/service concepts down to managed assets and environments.

## What appears outdated or version-specific
This is explicitly a CSDM v3 and ArchiMate 3.1-era crosswalk. Any one-to-one mappings should be re-validated against later CSDM evolution and against current product-centric ontology goals, especially where CSDM 6 would likely elevate Digital Product semantics more strongly than the original material did.

## Transcript
Transcript availability was verified outside the failing MCP path before YouTube later started returning `429`/IP-throttle responses for bulk extraction.

Short verified excerpt:
> "discuss the archimate 3.1 mapping to cstm version 3"

Chapter landmarks recovered from the YouTube page:
- `0:21` About Archimate
- `0:45` Differences and Similarities
- `1:49` Origins of CSDM
- `3:07` High-Level TOGAF Perspective
- `4:22` Technology Layer
- `5:15` Location Hierarchy
- `7:18` Equipment
- `7:43` System Software
- `8:42` Technology Service

## Relevance to current ontology work
High relevance. This is one of the clearest signals in the playlist that framework mapping needs to connect enterprise-architecture language to operational ontology classes through precise analysis paths. It is especially useful for relating product/service abstractions to technology realization layers without collapsing everything into generic graph edges.
