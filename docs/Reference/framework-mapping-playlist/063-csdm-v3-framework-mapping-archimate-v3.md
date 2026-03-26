# CSDM V3 Framework Mapping: Archimate V3

- Title: CSDM V3 Framework Mapping: Archimate V3
- Video URL: https://www.youtube.com/watch?v=kx8HJ1rumys
- Playlist position: 63
- Frameworks discussed: CSDM, ArchiMate, TOGAF
- Evidence basis: YouTube MCP playlist metadata, `yt-dlp` chapter metadata, and a local `faster-whisper` transcription recovered from the video audio after MCP transcript calls failed on 2026-03-26.

## Short summary
This session is a layer-by-layer crosswalk between ArchiMate 3.1 and CSDM v3. The speaker frames CSDM as a structure-and-dependency model and ArchiMate as a behavior-and-interaction model, then walks through business, application, and technology-layer mappings with repeated cautions about semantic differences behind apparently similar names.

## Key mapping concepts
- CSDM emphasizes structural dependency data; ArchiMate emphasizes behavior and interaction semantics
- Business architecture maps into company, hierarchy, location, and business-service related CSDM domains
- Application layer concepts map across business applications and application services, but not always one-to-one
- Technology layer concepts map into technical services, product models, configuration items, and service-mapping relationships
- Location hierarchy, equipment, system software, and technology service are presented as the clearest concrete bridge points

## Notable terminology used
- ArchiMate 3.1
- TOGAF
- Business architecture
- Application layer
- Technology layer
- Location hierarchy
- Equipment
- System software
- Technology service

## What still seems valid
The durable lesson is that enterprise architecture views and operational service-data models are not interchangeable, even when labels overlap. The talk is still useful for ontology work because it insists on mapping by semantic role and analysis purpose, especially when moving from business and application abstractions down into technical-service and CI realization layers.

## What appears outdated or version-specific
This is explicitly a CSDM v3 and ArchiMate 3.1-era walkthrough, and it reflects ServiceNow's 2018-era origin story for CSDM. Some mappings are clearly experience-based rather than normative, and any direct reuse should be re-validated against newer CSDM, newer ArchiMate guidance, and the stronger digital-product orientation expected in current ontology work.

## Transcript
Local transcript recovered on 2026-03-26 by downloading the audio and transcribing it after the YouTube MCP transcript path failed.

Cleaned transcript excerpt:
- `0:14-1:24`: The speaker introduces ArchiMate as an Open Group enterprise architecture standard and immediately contrasts it with CSDM: CSDM "focuses largely on the structure of data" while ArchiMate covers more of the "behavior and interaction between entities."
- `3:50-5:40`: Business architecture is mapped into company, hierarchy, location, and business-service oriented CSDM structures; application-layer concepts map to business applications and application services; the technology layer maps into technical services and the underlying CIs and stack components.
- `6:30-9:20`: The speaker warns that semantic and structural differences matter even when names look similar. Business service is not automatically one-to-one, application service is overloaded across models, and technology service maps well but does not naturally carry offering decomposition in the same way CSDM does.

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
High relevance. This is one of the clearest sources in the playlist for preserving precise bridge semantics between enterprise-architecture language and operational ontology classes. It is especially useful when defining analysis paths from Digital Product and service abstractions down to business/application/technology realization without collapsing everything into generic graph closure.
