# Trusted AI Agent Governance

## Executive Summary

This document is a position paper describing why the market now needs two complementary standards for AI agents: a runtime governance standard and an identity and assurance standard.

The key message of this document is simple. The market does not lack agent innovation. It lacks a cohesive trust architecture for that innovation.

Enterprises are already deploying AI agents to search code, read documents, invoke tools, route work, coordinate specialists, and act across internal and external systems. Yet most organizations still struggle to answer basic management questions with confidence:

- Which agents exist?
- Who authorized them?
- What tools, prompts, skills, and data can they reach?
- What human oversight applies?
- What evidence exists for what they actually did?
- What claims about fit-for-purpose, safety, bias, or tool use have been independently assessed?

Current standards and products address parts of this problem, but not the whole of it. `ISO/IEC 42001:2023` remains current, but it operates at the organization management-system level, not at the runtime identity and control-plane level required for agent operations. `MCP` and `A2A` are important and timely, but they address interoperability between agents, tools, and systems rather than trusted identity, assurance, and end-to-end runtime governance. Vendor frameworks from `OpenAI`, `Anthropic`, `Google`, and `Microsoft` make agent development more practical, but they do not establish a shared, globally usable trust model across platforms.

We therefore propose a standards family composed of:

- `TAK`, the `Trusted AI Kernel`, which defines the runtime control model for trustworthy agent operation
- `GAID`, the `Global AI Agent Identification and Governance Framework`, which defines stable identity, badging, assurance, issuer governance, and chain-of-custody for AI agents

The point is not to duplicate existing standards. The point is to connect the layers that are currently fragmented.

## 1. The Market Problem

Organizations are moving from simple assistant patterns to agentic patterns. This changes the management problem materially.

An assistant that only generates text can often be governed through policy, model selection, and human review. An agent that can invoke tools, route work to specialists, read sensitive context, maintain memory, and cross system boundaries creates a different class of operational concern. In practice, the enterprise problem becomes one of inventory, identity, authority, oversight, traceability, and accountability.

This is where current operating pain is most visible. Many organizations can describe their large language model strategy at a high level, but cannot yet maintain a trustworthy inventory of deployed agents. They often do not know, in a durable machine-readable way:

- which agents are public and which are private
- which are coordinators and which are specialists
- which tools and skills are exposed to each agent
- what immutable instructions govern them
- what human-in-the-loop (`HITL`) pattern applies
- what data sensitivity each agent is expected to handle
- how to trace a public action back through delegations and internal systems

This problem becomes more acute when agents are offered beyond a single team. The moment an agent is consumed across a large enterprise, across partners, or in public business-to-business or business-to-consumer channels, trust can no longer depend on undocumented local knowledge. Identity, capability claims, and chain-of-custody need to be structured, portable, and verifiable.

The problem is not merely technical. It is managerial. Without stronger standards, organizations cannot govern AI agents with the same discipline expected for software components, identities, certificates, regulated workflows, or high-consequence operational changes.

## 2. Why Current Standards and Protocols Fall Short

There are now several important standards and de facto standards in the market. The difficulty is that they are solving adjacent problems at different layers.

`ISO/IEC 42001:2023` is important because it gives organizations a formal management-system approach to AI governance. It is, however, not a runtime agent standard. It does not define agent identity documents, public issuer models, tool gating semantics, receipt chains, or immutable instruction governance. It is therefore relevant, but insufficient, for the problem addressed here.

`NIST AI RMF 1.0` is similarly valuable as a risk framing model, but it is not designed to function as a concrete cross-platform agent identity and runtime control specification.

The leading open agent protocols are also important, but differently scoped. `Anthropic` introduced the `Model Context Protocol` on November 25, 2024, to standardize how AI applications connect to tools and data sources. `Google` announced the `Agent2Agent Protocol` on April 9, 2025, and later donated `A2A` to the Linux Foundation on June 23, 2025, to improve interoperability between agents. These are significant advances. They do not, however, provide a complete answer to public identity, assurance badging, issuer accreditation, or runtime governance.

The large platform vendors are converging on agent frameworks rather than on a single trust architecture. `OpenAI` expanded its `Agents SDK` on April 15, 2026 with native harness and sandbox capabilities. `OpenAI`, `Anthropic`, and others are also moving standards work into neutral governance venues, including the `Agentic AI Foundation`, which `OpenAI` announced on December 9, 2025. `Microsoft` now positions `Agent Framework` as the next generation of `Semantic Kernel` and `AutoGen`, with workflow, checkpointing, and `HITL` support. `Google` continues to develop the `Agent Development Kit` and related agent infrastructure. This shows market momentum. It does not yet establish a coherent, interoperable governance answer.

The gap can be summarized as follows:

| Current Artifact | What It Solves | What It Does Not Fully Solve |
|------------------|----------------|-------------------------------|
| `ISO/IEC 42001` | Organization-level AI management systems | Runtime control, agent identity, issuer governance, receipts |
| `NIST AI RMF` | AI risk framing and lifecycle considerations | Concrete runtime and identity specifications for agents |
| `MCP` | Tool and context interoperability | Public identity, badging, public trust chain |
| `A2A` | Agent-to-agent interoperability and discovery | Accredited identity, assurance portability, external validation |
| Vendor agent frameworks | Practical implementation patterns | Cross-vendor trust semantics and common public assurance model |
| `W3C VC`, `RFC 9421`, `SLSA`, `Trace Context`, `PURL` | Strong building blocks for credentials, signatures, provenance, tracing, and structured identifiers | A cohesive agent-specific standard that composes these patterns into an operational identity and governance model |

The consequence is that enterprises are left to integrate these concerns themselves. Some do this through internal registries, one-off profiler scripts, prompt conventions, or platform-specific metadata. Those measures are usually useful. They are rarely sufficient.

## 3. Public Policy and Industry Signals

The public policy environment is now clearly signaling that AI agents have become a standards problem, not merely a product feature.

On February 17, 2026, `NIST` launched the `AI Agent Standards Initiative`, explicitly framing interoperable and secure agent adoption as a national standards concern. The initiative called out industry-led standards, open protocols, agent identity infrastructure, and security evaluations as active areas of work. This matters because it confirms that the U.S. standards conversation has moved from general AI governance into agent-specific interoperability and trust.

The signal became even clearer with the `NCCoE` concept paper, "Accelerating the Adoption of Software and AI Agent Identity and Authorization", published on February 5, 2026. That paper specifically asked for input on use cases, identity, authorization, auditing, non-repudiation, and controls against prompt injection. In other words, the market problem described in this paper is now recognized in formal public-sector work.

There are also direct timing implications. The `CAISI` RFI on AI agent security closed on March 9, 2026, and the `NCCoE` concept paper comment period closed on April 2, 2026. Those specific windows have passed. The larger agenda has not. The initiative itself is new, active, and still forming. The conclusion is that we are not too late for standards work. We are at the point where credible proposals are needed.

The White House has also already established AI policy as a live federal agenda. Public comment on the U.S. `AI Action Plan` opened on February 25, 2025, and the Administration published `America's AI Action Plan` on July 23, 2025. Whether one agrees with every aspect of that plan is not the main point here. The main point is that the federal policy environment is already asking for concrete, implementable approaches rather than abstract concern.

Industry behavior reinforces this. `OpenAI` published its proposals for the U.S. AI Action Plan on March 13, 2025. `Anthropic` submitted its own March 2025 `OSTP` response and has continued to argue for stronger testing and evaluation approaches, including in its earlier essay on third-party testing and its later work with `CAISI` and the `UK AISI`. This is not evidence that the market has solved the problem. It is evidence that leading vendors understand the policy and assurance questions are becoming unavoidable.

The point is not that governments or frontier labs are waiting for one final regulatory answer before acting. The point is that both are operating in a fragmented environment and are now seeking more coherent structures for identity, assurance, interoperability, and runtime trust.

## 4. The Case for a Trusted AI Kernel (TAK)

`TAK` addresses the runtime half of the problem.

A trusted runtime for agents needs to do more than host model inference. It needs to mediate authority. It needs to govern tool execution. It needs to distinguish immutable directives from conversational input. It needs to define when a human must approve an action, when an action can execute directly, how delegation narrows authority, and how evidence is recorded.

This is particularly important because modern agent systems are not just single prompts followed by single outputs. They are increasingly composed of:

- generalist coordinators
- narrow, deeply skilled specialists
- persistent or retrieved memory
- hidden or immutable instructions
- external tools and connectors
- long-running tasks that can fail, retry, or be resumed

These are precisely the conditions in which weak governance becomes expensive and dangerous. Fabrication, hallucination, unauthorized action, prompt injection, hidden-instruction leakage, and misplaced autonomy are not separate issues. They are different symptoms of the same missing control plane.

`TAK` therefore proposes that a trustworthy runtime `MUST` provide a clear authority model, execution gating, `HITL` semantics, immutable instruction governance, memory and context-window control, audit logging, delegation narrowing, and runtime transparency to supervisors. A key message of this document is that these are not optional implementation preferences. They are part of the minimum structure required for trustworthy agency.

## 5. The Case for a Global AI Agent Identification and Governance Framework (GAID)

`GAID` addresses the identity and assurance half of the problem.

Enterprises do not only need to know that an agent exists. They need to know what the agent is, what evidence exists about it, what claims it can legitimately carry, and how that identity can be traced across boundaries.

This is why `GAID` is more than a naming convention. It combines:

- a stable identifier
- a resolvable `Agent Identity Document`
- structured badging for capability, governance, safety, sensitivity, and fit-for-purpose
- portable authorization classes
- signed action receipts and chain-of-custody
- a governance model for private and public issuance

The need for a stronger badging model is especially acute. In practice, organizations want to know not only whether an agent exists, but whether it is fit for a particular purpose, whether it uses tools, whether it retains memory, what kind of model it uses, whether training-data or model-card references exist, whether bias or evaluation evidence exists, what context limits apply, and what kind of human oversight is expected. Today these answers are often incomplete, inconsistent, or hidden behind vendor-specific interfaces.

This is also where public trust enters the picture. Internal identifiers are useful, but public agents need stronger validation. The closest analogies are not only application user accounts. They are also `DNS`, `ISBN`, `PKI`, and supply-chain provenance systems. Public trust works when syntax, governance, accreditation, status, and verification all exist together. That is the role `GAID` is intended to play.

## 6. Why These Standards Belong Together

The two proposed standards are deliberately separate, but they are not independent in the practical sense.

`TAK` without `GAID` gives an organization a runtime governance model, but not a portable answer to identity, public validation, or assurance disclosure.

`GAID` without `TAK` gives an organization a way to name and describe agents, but not a reliable answer to how those agents are controlled in operation.

The two together create a more complete trust architecture:

- `TAK` governs action
- `GAID` governs identity and claims
- receipts join the two through evidence

This is important for both internal and external use. Internally, organizations need inventory, role and tool governance, and reliable audit. Externally, they need verifiable identity, clear public claims, and accountable cross-boundary interaction. A cohesive answer requires both layers.

## 7. DPF as a Proving Ground

The value of a standard increases materially when it can be exercised in a real platform rather than described only in the abstract.

`DPF` is a useful proving ground because it already contains several runtime patterns that align with `TAK`:

- route-specific specialist agents rather than one generic agent everywhere
- capability and agent-grant intersection for tool access
- proposal-mode behavior for higher-risk actions
- explicit prompt assembly blocks that separate identity, authority, sensitivity, and context
- audit logging for tool execution
- differentiated sensitivity and role context

It also contains early identity-related structures that are relevant to `GAID`, including a registry of agent identities, model bindings, tool grants, supervisor assignments, default `HITL` tiers, delegation relationships, and memory declarations.

This makes `DPF` especially valuable for conformance work. It is not a blank sheet. It already demonstrates that many `TAK` controls are implementable in a practical system. At the same time, it exposes what is still missing for a fuller `GAID` posture: federated issuance, public verification, standardized badges, external certificates, public status and revocation, and portable action receipts.

In other words, `DPF` is credible as a first implementation case because it shows both existing strengths and remaining work.

## 8. Recommendations for Governments, Standards Bodies, and Enterprises

The recommendations are straightforward.

Governments and standards bodies should:

- treat runtime governance and agent identity as separate but complementary standards layers
- build on existing work such as `MCP`, `A2A`, `VC`, `SLSA`, `Trace Context`, and `HTTP Message Signatures` rather than starting from zero
- recognize accredited issuer governance as a critical dependency for public agent identity
- prioritize chain-of-custody, non-repudiation, and `HITL` disclosure as first-class concerns

Enterprises should:

- stop treating agent inventory as a prompt catalog problem
- adopt structured identity, tool-surface, and oversight metadata now, even before public standards fully mature
- distinguish self-asserted claims from independently evidenced claims
- require runtime evidence for consequential actions

Platform vendors should:

- expose stronger structured metadata for tools, skills, prompts, memory, and approval posture
- make badging and assurance claims machine-readable
- support portable identity and receipt semantics across frameworks

The point is not to wait for a perfect end-state. The point is to move from ad hoc local conventions toward interoperable trust infrastructure.

## 9. Conclusion

AI agents are now mature enough to create a standards problem and immature enough that the standards answer is still forming.

That combination is exactly why action is needed now.

The market already has meaningful building blocks. It has organization-level governance frameworks. It has interoperability protocols. It has vendor frameworks. It has credential, signature, provenance, and traceability standards. What it does not yet have is a cohesive answer to the combined problem of trusted runtime control and trusted agent identity.

This paper therefore proposes a practical direction:

- `TAK` for runtime governance
- `GAID` for identity, assurance, and traceability
- `DPF` as an early proving ground for conformance and refinement

We propose these not as final answers to every policy or platform question, but as a concrete starting point for the standards work that now needs to happen.

## References

- [ISO/IEC 42001:2023 Artificial intelligence management system](https://www.iso.org/standard/81230.html)
- [NIST AI RMF 1.0](https://doi.org/10.6028/NIST.AI.100-1)
- [NIST AI Agent Standards Initiative, February 17, 2026](https://www.nist.gov/caisi/ai-agent-standards-initiative)
- [NIST press release: Announcing the AI Agent Standards Initiative, February 17, 2026](https://www.nist.gov/node/1906621)
- [NCCoE concept paper: Accelerating the Adoption of Software and AI Agent Identity and Authorization, February 5, 2026](https://csrc.nist.gov/pubs/other/2026/02/05/accelerating-the-adoption-of-software-and-ai-agent/ipd)
- [CAISI RFI on Securing AI Agent Systems, January 12, 2026](https://www.nist.gov/news-events/news/2026/01/caisi-issues-request-information-about-securing-ai-agent-systems)
- [White House: Public Comment Invited on Artificial Intelligence Action Plan, February 25, 2025](https://www.whitehouse.gov/briefings-statements/2025/02/public-comment-invited-on-artificial-intelligence-action-plan/)
- [White House: America's AI Action Plan, July 23, 2025](https://www.whitehouse.gov/articles/2025/07/white-house-unveils-americas-ai-action-plan/)
- [OpenAI: OpenAI's proposals for the U.S. AI Action Plan, March 13, 2025](https://openai.com/global-affairs/openai-proposals-for-the-us-ai-action-plan/)
- [OpenAI: The next evolution of the Agents SDK, April 15, 2026](https://openai.com/index/the-next-evolution-of-the-agents-sdk)
- [OpenAI: OpenAI co-founds the Agentic AI Foundation under the Linux Foundation, December 9, 2025](https://openai.com/index/agentic-ai-foundation/)
- [Anthropic: Introducing the Model Context Protocol, November 25, 2024](https://www.anthropic.com/news/model-context-protocol)
- [Anthropic: Third-party testing as a key ingredient of AI policy](https://www.anthropic.com/news/third-party-testing/)
- [Anthropic: Strengthening our safeguards through collaboration with US CAISI and UK AISI, September 12, 2025](https://www.anthropic.com/news/strengthening-our-safeguards-through-collaboration-with-us-caisi-and-uk-aisi)
- [Google Developers Blog: Announcing the Agent2Agent Protocol, April 9, 2025](https://developers.googleblog.com/es/a2a-a-new-era-of-agent-interoperability/)
- [Google Developers Blog: Google Cloud donates A2A to Linux Foundation, June 23, 2025](https://developers.googleblog.com/google-cloud-donates-a2a-to-linux-foundation/)
- [Agent2Agent Protocol specification](https://google-a2a.github.io/A2A/specification/)
- [Google Cloud: Agent Development Kit overview](https://cloud.google.com/agent-builder/agent-development-kit/overview)
- [Microsoft Agent Framework Overview, updated February 20, 2026](https://learn.microsoft.com/en-us/agent-framework/overview/)
- [W3C Verifiable Credentials Data Model v2.0](https://www.w3.org/TR/vc-data-model/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [RFC 9421 HTTP Message Signatures](https://www.rfc-editor.org/info/rfc9421)
- [SLSA Provenance v1.1](https://slsa.dev/spec/v1.1/provenance)
- [Package URL / ECMA-427](https://www.packageurl.org/)
