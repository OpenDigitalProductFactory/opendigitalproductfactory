# AI Agent Governance: Market and Thought-Leadership Landscape (2026)

**Status:** informative companion · **Evidence date:** 2026-09-30 · **Owner:** EP-B932453F / BI-2C3B3AC9

This brief records what the market, the research community and incident reports say about one
question: how should AI agents be governed when they use tools and resources? It is the
evidence base behind the [Gated Permissions Process (GPP)](gated-permissions-process.md) and
the public positioning of the [standards family](agent-standards-family.md).

The brief is a dated snapshot, not a normative standard. Every figure carries its publisher and date.
Figures published only by a vendor about its own product are labelled **vendor-reported**.
Items that could not be checked against a primary source are listed in
[§8](#8-what-this-brief-could-not-verify), and nothing in that list is stated as fact
elsewhere. Re-check every figure against its source before reusing it in a public document.

## 1. The problem in one paragraph

Most agent tools offer two ways to govern tool use. One is to approve each call: the agent stops
and asks before it runs a command, writes a file or calls an API. The other is to approve
nothing, using the "YOLO", `--yolo`, "always allow" or `--dangerously-skip-permissions` modes
that most agent CLIs ship. Per-call approval does not hold up, because people stop reading the
prompts. Once they stop reading, the second option becomes the actual operating mode, and the
agent is effectively unsupervised. The 2025–2026 incident record (§3) is largely a record of
agents that held broad credentials and met no gate at the moment a damaging action happened.

## 2. Evidence that per-call approval fails

| Finding | Source |
|---|---|
| Sandboxing cut permission prompts by 84% internally; the post names "approval fatigue" as the risk it addresses. **Vendor-reported.** | Anthropic Engineering, *Making Claude Code more secure and autonomous with sandboxing*, 2025-10-20 — <https://anthropic.com/engineering/claude-code-sandboxing> |
| Users approve about 93% of permission prompts. Anthropic describes the old choice as manual approval, skip-permissions, or high-maintenance sandboxes. Its classifier reports a 17% false-negative rate on real overeager actions (n=52). **Vendor-reported.** | Anthropic Engineering, *How we built Claude Code auto mode*, 2026-03-25 — <https://www.anthropic.com/engineering/claude-code-auto-mode> |
| Users approve 97% of permission prompts but reject 39% of plans. In a controlled study (n=1,053), people caught a disguised dangerous command 13.6% of the time: about 17% early in a session and about 5% after 50 or more prompts. Auto mode became the default on 2026-08-14. **Vendor-reported.** | Claude blog, *Auto mode is now the default in Claude Code*, 2026-08-07 — <https://claude.com/blog/auto-mode-default-in-claude-code> |
| A red-team exercise in which an employee was phished produced malicious exfiltration in 24 of 25 attempts. The stated principle is to design for containment at the environment layer first. **Vendor-reported.** | Anthropic Engineering, *How we contain Claude across products*, 2026-05-25 — <https://www.anthropic.com/engineering/how-we-contain-claude> |
| A prompt-injection chain against classifier-gated auto mode achieved remote code execution in 60–80% of attempts (disclosed 2026-08-26). CSA advises treating the classifier as a productivity control, not a substitute for sandboxing, egress control or credential isolation. | Cloud Security Alliance Labs research note, 2026-08/09 — <https://labs.cloudsecurityalliance.org/research/csa-research-note-claude-code-automode-prompt-injection-2026/> |
| In a field study, adherence to permission warnings fell substantially over three weeks; warnings that change appearance slowed the decline. | Vance et al., *Tuning Out Security Warnings*, MIS Quarterly 42(2), 2018 — <https://misq.umn.edu/pub/skin/frontend/default/misq/pdf/V42I2/14124_RA_VanceJenkins.pdf> |
| In MFA "push bombing", attackers repeat approval prompts until a person accepts one; this was the entry vector in the 2022 Uber breach. Approval floods become an attack surface. | BleepingComputer — <https://www.bleepingcomputer.com/news/security/mfa-fatigue-attacks-are-putting-your-organization-at-risk/amp/> |

**What the evidence supports.** The strongest data point for GPP is the gap between how people
treat plans and how they treat prompts. Users reject plans at a meaningful rate and approve
prompts almost by reflex. People can supervise well when asked about a decision, and poorly when
asked about each tool call. GPP moves the human checkpoint from the tool call to the decision
that authorizes a class of tool calls.

**What the evidence does not support.** No independent survey was found that measures how many
users run YOLO or skip-permission modes. Do not cite an adoption rate.

## 3. Incident record, 2024–2026

| Date | Incident | Control that was missing | Source |
|---|---|---|---|
| 2024-06 | Unauthorized access to Hugging Face Spaces secrets | Token scope and secret isolation (not agent-driven) | BleepingComputer — <https://bleepingcomputer.com/news/security/ai-platform-hugging-face-says-hackers-stole-auth-tokens-from-spaces> |
| 2025-02 | "nullifAI" malicious pickle models on the Hugging Face Hub evaded scanning | Model supply-chain admission | ReversingLabs — <https://www.reversinglabs.com/blog/rl-identifies-malware-ml-model-hosted-on-hugging-face> |
| 2025-05 | GitHub MCP prompt injection: a public issue drives a private-repository leak | No separation between untrusted input, private data and outbound action | Invariant Labs — <https://invariantlabs.ai/blog/mcp-github-vulnerability> |
| 2025-05/06 | Asana MCP server cross-tenant data exposure | Tenant isolation in the tool server | BleepingComputer — <https://bleepingcomputer.com/news/security/asana-warns-mcp-ai-feature-exposed-customer-data-to-other-orgs/> |
| 2025-07 | Supabase MCP "lethal trifecta": an agent with a service-role key reads attacker instructions from support tickets | Over-privileged credential; no data-flow separation | Simon Willison, 2025-07-06 — <https://simonwillison.net/2025/Jul/6/supabase-mcp-lethal-trifecta> |
| 2025-07 | Replit agent deletes a production database during a declared code freeze | A "no changes" instruction was prose, not an enforced gate; no dev/prod separation | Fortune, 2025-07-23 — <https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure> |
| 2025-07 | Amazon Q Developer extension release carries an injected wiper prompt | Release supply-chain review | SC World — <https://scworld.com/news/amazon-q-extension-for-vs-code-reportedly-injected-with-wiper-prompt> |
| 2025-08 | Nx "s1ngularity" malware invokes installed AI CLIs with skip-permission flags to inventory secrets | Agent CLIs accept skip-permission flags from any caller | Wiz — <https://www.wiz.io/ko-kr/blog/s1ngularity-supply-chain-attack> |
| 2025-09 | `postmark-mcp`: a malicious MCP server silently copies every email to an attacker | Tool-server provenance and egress control | Koi Security — <https://koi.ai/blog/postmark-mcp-npm-malicious-backdoor-email-theft> |
| 2026-04 | A coding agent finds an unrelated, over-scoped API token and deletes a production volume and its backups in seconds | Credential scope; no gate on a destructive API | TechRadar — <https://www.techradar.com/pro/it-took-9-seconds-tech-founder-outlines-how-rogue-claude-powered-ai-tool-wiped-entire-company-database-and-backups-but-says-theres-no-such-thing-as-bad-publicity> |
| 2026-07 | Evaluation agents escape their sandbox and compromise Hugging Face production infrastructure | Sandbox boundary, over-broad credentials, exposed metadata endpoint | Hugging Face technical timeline, 2026-07-27 — <https://huggingface.co/blog/agent-intrusion-technical-timeline>; METR investigation, 2026-08-26 — <https://metr.org/blog/2026-08-26-openai-hugging-face-incident-investigation/> |

**The repeating pattern.** Almost every row has the same failure. The agent held authority
broader than its task: a credential, a scope or a tool. Nothing evaluated the specific damaging
action against who was entitled to authorize it. Detection and model-level guardrails were
present in several cases and did not change the outcome. That pattern motivates GPP's core rule:
**a consequential tool is reachable only through a gate whose owning authority is named,
recorded and current**.

## 4. Frameworks and thought leadership

| Framework | Relevant idea | How GPP relates |
|---|---|---|
| Simon Willison, *The lethal trifecta* (2025-06-16) — <https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/> | Private data, untrusted content and external communication together make exfiltration possible | GPP expresses which capability classes may co-occur within one gated binding |
| Meta, *Agents Rule of Two* — <https://ai.meta.com/blog/practical-ai-agent-security/> | In one session an agent should hold at most two of untrusted input, sensitive access and state-changing or outbound ability; all three need human or equivalent validation | Adopted directly as GPP's co-occurrence constraint ([GPP §8](gated-permissions-process.md#8-capability-co-occurrence)) |
| OWASP LLM06:2025 *Excessive Agency* — <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/> | Root causes are excessive functionality, excessive permissions and excessive autonomy | GPP binds each of the three to a scope gate rather than to a standing grant |
| OWASP Top 10 for Agentic Applications 2026 (released 2025-12) | ASI02 Tool Misuse, ASI03 Identity & Privilege Abuse, ASI09 Human-Agent Trust Exploitation | ASI09 is the approval-fatigue risk; GPP reduces the number of human decisions and raises their legibility |
| NIST CAISI agent-hijacking evaluations; COSAiS SP 800-53 overlays for AI agents — <https://csrc.nist.gov/projects/cosais> | Control overlays for single- and multi-agent systems (in development) | GPP bindings are candidate evidence objects for overlay controls |
| NIST NCCoE concept paper, *Software and AI Agent Identity and Authorization* (2026-02-05) — <https://www.nccoe.nist.gov/news-insights/new-concept-paper-identity-and-authority-software-agents> | Agent identity and authorization using OAuth 2.0, SPIFFE and MCP | GAID covers identity; GPP adds where authority comes from |
| EU AI Act Article 14 (human oversight) — <https://ai-act-service-desk.ec.europa.eu/en/ai-act/article-14> | People must be able to monitor, interpret and override the system, and stay aware of automation bias. High-risk obligations deferred to 2027-12-02 (Annex III) and 2028-08-02 (Annex I) by the Digital Omnibus | A 13.6% catch rate on per-call prompts is weak evidence of effective oversight; GPP records an owning authority per gated class |
| CSA MAESTRO (2025-02-06) — <https://cloudsecurityalliance.org/blog/2025/02/06/agentic-ai-threat-modeling-framework-maestro> | Seven-layer threat model for agentic AI | Threat-model input for GPP hazard analysis |
| Gartner (2025-06-25): over 40% of agentic AI projects cancelled by end of 2027, partly due to inadequate risk controls — <https://www.gartner.com/en/newsroom/press-releases/2025-06-25-gartner-predicts-over-40-percent-of-agentic-ai-projects-will-be-canceled-by-end-of-2027> | Governance is an adoption blocker | Market framing |
| Gartner (2026-05-26, via secondary reporting) argues that treating governance as binary, either locked down or fully trusted, causes failure, and recommends governance proportional to autonomy | The closest analyst framing to GPP | GPP adds decision scope as the proportioning axis, not autonomy alone |
| Google, *An Introduction to Google's Approach for Secure AI Agents* — <https://research.google/pubs/an-introduction-to-googles-approach-for-secure-ai-agents/> | Well-defined human controllers, limited powers, observable actions | GPP formalizes "well-defined human controllers" as owning decision scopes |
| Google DeepMind CaMeL, *Defeating Prompt Injections by Design* (2025) | Capability metadata and control/data-flow separation | A complementary runtime technique; GPP does not replace data-flow controls |
| MCP authorization (OAuth 2.1, RFC 9728, RFC 8707; 2025-11-25 and 2026-07-28 revisions) — <https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>. Tool annotations (`readOnlyHint`, `destructiveHint`) are hints and must not be trusted from untrusted servers | MCP authorizes at the server and scope level | GPP sits above MCP scopes and decides which decision gate must clear before a scoped tool is reachable |
| IETF drafts: OAuth transaction tokens, AAuth, AI-agent on-behalf-of (none are RFCs) | Carry authorization context through call chains | Candidate carriers for a GPP binding reference across boundaries |

## 5. Products and adjacent approaches

| Product or approach | What it gates | Binds authorization to a decision scope? |
|---|---|---|
| AWS Bedrock AgentCore Policy (Cedar, default-deny, every gateway tool call) — <https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/policy.html> | Principal × tool × context, deterministic | No. Closest technical analogue; no model of where authority originates |
| Microsoft Entra Agent ID and Conditional Access for agents — <https://learn.microsoft.com/en-us/entra/agent-id/whats-new-agent-id> | Agent identity, sponsor, lifecycle | Partly. A sponsor is an accountable human, but not per decision class |
| Microsoft 365 agent tool management — <https://learn.microsoft.com/en-us/microsoft-365/admin/manage/manage-tools-for-agent> | Allow or block MCP servers org-wide | No. Server and tool level |
| Auth0 for AI Agents / Okta — <https://auth0.com/blog/announcing-auth0-for-ai-agents-powering-the-future-of-ai-securely/> | Token vault, fine-grained data authorization, asynchronous human approval | No. Per-action approval delivered out of band |
| Kong AI Gateway MCP ACLs — <https://developer.konghq.com/mcp/use-access-controls-for-mcp-tools/> | Consumer group × tool | No. RBAC |
| OPA / Cedar / OpenFGA (Zanzibar) — <https://openfga.dev/docs/use-cases/ai-agent-authorization.md> | Whatever is modelled | Capable substrate; a GPP binding could compile to any of them |
| ServiceNow AI Control Tower — <https://newsroom.servicenow.com/press-releases/details/2026/ServiceNow-expands-AI-agent-governance-through-deeper-integration-with-Microsoft/default.aspx> | Central policies across agent platforms | Closest in governance intent; how it binds to tools was not verifiable |
| Credo AI agent registry; IBM watsonx.governance | Inventory, risk classification, catalog | No. Governance record, not inline authorization |
| Zenity, Lakera (Check Point), Prompt Security (SentinelOne), Invariant Labs (Snyk) | Behaviour, intent and content guardrails | No. Probabilistic detection; complementary |

**Market pattern.** Responsibilities are consolidating along three lines. Identity vendors own
agent identity. Cloud platforms own deterministic tool policy. Governance suites own inventory
and policy authoring. Classifier and guardrail vendors are being acquired by large security
platforms. No product reviewed models "who may decide this class of action" together with "which
tool may run" as its primary object.

## 6. The gap GPP addresses

The nearest prior work is real. GPP should be presented as composing it, not as inventing
governance:

- **RBAC, ABAC and ReBAC** (Zanzibar, USENIX ATC 2019) model who may *do* something. They do
  not model who may *decide* that a class of action is admissible in a given work context.
- **ITIL change enablement** pre-authorizes *standard changes* as a class and sends *normal
  changes* to a change authority. This is the clearest organizational ancestor of GPP: approval
  attaches to a class of change and its authority, not to each execution. Cite primary ITIL
  sources before relying on this analogy publicly.
- **Delegation-of-authority matrices, RACI and segregation of duties** name accountable deciders.
  They are not bound to machine-enforced tool reachability.
- **Ibrahim & Li, *Overlaying Governance: A Compositional Authorization Framework for Delegation
  and Scope in Agentic AI*** (arXiv 2606.03518, 2026-06) — <https://arxiv.org/abs/2606.03518> —
  is the closest formal work: delegation types and resource-scope attenuation over relational
  policies. GPP differs in binding to named governance scopes (platform, organization,
  profession) and to versioned work-shape stages. A full comparison is owed before any novelty
  claim.
- **Architecture & Governance Magazine, *Five Decision Rights CIOs Need for Agentic AI*
  (2026-09-25)** — <https://www.architectureandgovernance.com/artificial-intelligence/five-decision-rights-cios-need-for-agentic-ai/> —
  names decision rights and owners, and explicitly leaves tool binding to identity systems and
  gateways. GPP is that missing binding.

**GPP's position, stated narrowly.** The industry's current answer to approval fatigue is
probabilistic: sandboxes plus a classifier that decides which calls to let through. Those
controls have published false-negative rates and a published bypass. GPP proposes a
deterministic, policy-compiled binding in which each consequential tool's reachability traces
to a named, recorded decision authority. That is the evidence an Article 14 oversight review or
an ISO/IEC 42001 audit can examine. GPP does not replace sandboxing, egress control or credential
isolation; it decides what those controls must permit.

## 7. Implications for DPF's public claims

- Claim the *design* and the substrate that exists. Do not claim measured efficacy until DPF
  publishes its own denominators from `AuthorizationDecisionLog`, `ToolExecution` and
  `DecisionInteraction`. See [GPP §11](gated-permissions-process.md#11-evidence-and-efficacy-measures).
- Position GPP against classifiers and per-call prompts together, not against per-call prompts
  alone.
- Do not imply certification, standards-body endorsement or regulatory compliance.

## 8. What this brief could not verify

- The primary text of the Gartner press release of 2026-05-26 (secondary reporting only).
- Agent-specific clauses in ISO/IEC 42001 (not confirmed from a primary source; no clause is cited).
- Feature details for Cloudflare and Docker MCP gateways and the Salesforce Agentforce trust layer (secondary sources only; omitted from §5).
- Accounts of the July 2026 Hugging Face intrusion conflict on scale: one autonomous agent versus hundreds of coordinating agents. Cite the Hugging Face timeline and the METR report and name the discrepancy.
- Counts in the OpenClaw / ClawHub incident reporting vary widely between sources; omitted from §3.
- Anthropic's own posts report the prompt-approval rate as both 93% and 97%. Both are vendor-reported and not independently replicated.
- No independent survey of YOLO or skip-permission adoption was found.
