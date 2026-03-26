# CSDM V3 Framework Mapping: BIAN V8

- Title: CSDM V3 Framework Mapping: BIAN V8
- Video URL: https://www.youtube.com/watch?v=LJINzbfxiQo
- Playlist position: 69
- Frameworks discussed: CSDM, BIAN
- Evidence basis: YouTube MCP playlist metadata, `yt-dlp` chapter metadata, and a local `faster-whisper` transcription recovered from the video audio after MCP transcript calls failed on 2026-03-26.

## Short summary
This session maps a banking-specific semantic service model into CSDM. The strongest points are capability-based planning, the split between BIAN's single application-service concept and CSDM's business-application/application-service distinction, business-service alignment, and the use of BIAN's service landscape as a domain taxonomy.

## Key mapping concepts
- BIAN as a banking SOA and semantic definition model shaped by M&A and interoperability needs
- Business capability mapping described as close to one-to-one
- BIAN application service aligned more closely to CSDM business application than to environment-specific application service
- Business service aligned to business service plus business service offering
- BIAN service landscape treated as a reusable banking-domain taxonomy

## Notable terminology used
- BIAN
- Banking Industry Architecture Network
- SOA
- Semantic definition model
- Business capability
- Application service
- Business service
- Service landscape

## What still seems valid
This remains highly useful for sector-specific ontology work. The durable ideas are the capability alignment, the explicit semantic handling of services in a banking domain, and the service landscape as a controlled vocabulary that can anchor domain taxonomies without losing the cross-domain CSDM bridge.

## What appears outdated or version-specific
The mapping is explicitly BIAN v8 to CSDM v3. The talk also notes that BIAN does not break offerings out the same way CSDM does, and its application-service semantics differ from CSDM's more operational split. Those differences are exactly what should be preserved during modernization rather than normalized away.

## Transcript
Local transcript recovered on 2026-03-26 by downloading the audio and transcribing it after the YouTube MCP transcript path failed.

Cleaned transcript excerpt:
- `0:15-1:20`: BIAN is introduced as the Banking Industry Architecture Network, formed to create common banking semantics in response to interoperability and M&A pressures, while CSDM is framed around digital products and services across the ServiceNow platform.
- `2:55-3:40`: The strongest design-side mapping is capability-based planning: business capabilities map closely to business capabilities, but BIAN's application service maps more closely to CSDM business application than to the operationally split application-service concept.
- `3:55-5:00`: Business service aligns well to CSDM business service plus business service offering, and the BIAN service landscape is presented as a reusable banking taxonomy covering both domain-specific banking services and generic enterprise services.

Chapter landmarks recovered from the YouTube page:
- `0:42` The main differences / similarities
- `2:22` BIAN mapping to CSDM meta-model
- `5:09` BIAN Service Landscape use in CSDM

## Relevance to current ontology work
Very high relevance for framework mappings that need both cross-domain anchors and industry-specific semantics. BIAN is especially useful where the ontology must keep a banking domain vocabulary, service landscape, and capability structure while still mapping cleanly into Digital Product, service, and application constructs.
