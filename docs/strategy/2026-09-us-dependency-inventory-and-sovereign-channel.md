# US-vendor dependency inventory & the sovereign open-source channel (Sept 2026)

| Field | Value |
| --- | --- |
| Date | 2026-09-25 |
| Status | Research — inventory + gap map; no backlog rows filed by this document |
| Companion to | [CADA strategy briefing](2026-09-cada-cloud-sovereignty-architects-forum.md) (§5 partner strategy, §6 caveats) |
| Trigger | Operator meeting with the TAPPaaS founders; question "what does DPF depend on from US companies, and is the EU sovereign-open-source ecosystem a path to market?" |
| Evidence base | Source files at `main` @ `bfd63709`; web sources cited inline |

The CADA briefing argues DPF is *sovereign by construction* at the application layer. This document tests that claim against the **software supply chain and install path**: every place DPF, as shipped today, relies on a product or service controlled by a US-headquartered company. It then maps each dependency onto the epic that already owns it and names the gaps no existing epic covers.

---

## 1. Classification

The three classes matter differently under CADA. The Level 4 test is whether a third country holds *effective control over software design, development, maintenance, or evolution* (see the [briefing §1.3](2026-09-cada-cloud-sovereignty-architects-forum.md)).

| Class | Meaning | CADA weight |
| --- | --- | --- |
| **RUNTIME-SVC** | A US company hosts or controls a service DPF calls at runtime. | High when the service is required. Low when it is operator opt-in. |
| **DIST** | A US company controls how DPF's own bytes reach the customer: registries, installers, update checks, CI. | High. The customer cannot install, update or rebuild if it is withdrawn. |
| **OSS-US** | Open-source software that originated at a US company and can be self-hosted, audited and forked. | Low. The right to fork answers the "effective control" test. Disclose it in the SBOM; don't try to eliminate it. |

---

## 2. Inventory

### 2.1 Required on the supported install path (the ones that matter)

| # | Dependency | Class | Evidence | Why it matters |
| --- | --- | --- | --- | --- |
| D1 | **Docker Desktop** (Docker Inc.). Proprietary; paid for larger companies. | RUNTIME-SVC / DIST | [`docs/install/platform-support-watchlist.md`](../install/platform-support-watchlist.md) target table: Windows GA and macOS early access both require it. `install-dpf.ps1:1047` downloads it from `desktop.docker.com`. | The only GA platform depends on a proprietary US product. The watchlist marks "WSL2 without Docker Desktop" and "Podman/containerd" as out of scope. |
| D2 | **Docker Model Runner**, the default local LLM on Windows/macOS. Model weights come from Docker Hub's `ai/` namespace. | RUNTIME-SVC | `docker-compose.yml` `LLM_BASE_URL=http://model-runner.docker.internal/v1`; `install-dpf.ps1` default model `ai/gemma3`. | Inference runs locally (good), but the runtime is a Docker Desktop feature and the weights come from a US registry. |
| D3 | **GHCR** (GitHub/Microsoft), the registry for every release image. | DIST | `docker-compose.release.yml:27-59` (`ghcr.io/${GHCR_OWNER}/…`, host hard-coded); `.github/workflows/publish-image.yml`. | Install, update and reinstall all pull from GHCR. |
| D4 | **Docker Hub** (Docker Inc.) and **gcr.io** (Google) for upstream base images: `node`, `python`, `pgvector`, `redis`, `prom/*`, `grafana/*`, `caddy`, `smallstep`, `inngest`, `ollama`, `cadvisor`. | DIST | `Dockerfile:3`, `docker/postgres/Dockerfile`, `docker-compose.yml`, `docker-compose.linux.yml:38`. | The images are open source, but there is no configured mirror. |
| D5 | **GitHub** (Microsoft) for source, the install-time commit check, self-upgrade release checks, the upstream contribution flow, and 40 Actions workflows. | DIST | `install-dpf.sh:81` and `install-dpf.ps1:144` call `api.github.com`; `apps/web/lib/forge/` has only `github-adapter.ts`; `.github/workflows/`. | Updating, contributing upstream, and rebuilding releases are all single-vendor. |
| D6 | **WSL2** (Microsoft). | RUNTIME-SVC | `install-dpf.ps1:884-947`. | Inherent to the Windows host. It becomes irrelevant once a Linux substrate is the sovereign reference. |

### 2.2 Operator opt-in (not structural; disclose, don't remove)

- **Cloud AI providers** in `packages/db/data/providers-registry.json`: Anthropic, OpenAI/Codex, Azure OpenAI, Gemini, Bedrock, xAI, Groq, Together, Fireworks, OpenRouter, Portkey and Martian are US. Mistral is EU. Nothing needs a cloud key: the `local_only` residency policy excludes every non-local provider and fails loudly (briefing §2). OpenRouter is pinned to `eu.openrouter.ai` (`apps/web/lib/routing/provider-suitability/openrouter-policy.ts`).
- **Business connectors** under `apps/web/lib/integrations/`: Stripe, QuickBooks/Mailchimp (Intuit), Microsoft 365/Entra/LinkedIn, Google Business Profile and marketing, Meta, HubSpot, Greenhouse, ADP and Postmark. All use operator credentials (conduit, not broker). Email defaults to generic SMTP.
- **Social login**: Google and Apple, active only when client IDs are configured (`apps/web/lib/govern/auth.ts`).
- **Address validation**: Smarty and Mapbox are US. Nominatim/OSM is available as the open alternative.

### 2.3 Required only for a specific feature

- **Mobile push** is relayed through Expo's hosted service (`exp.host`, US), which forwards to Apple APNs and Google FCM (`apps/web/lib/communications/expo-push.ts:9`). This only matters if the mobile companion app is used. APNs and FCM cannot be avoided on stock iOS and Android; the Expo relay can be.
- **Build Studio sandbox**: `Dockerfile.sandbox` bakes in `@openai/codex`, `@anthropic-ai/claude-code` (proprietary), the xAI `grok` CLI (via `curl x.ai/cli/install.sh`) and `opencode`. These are opt-in executors. The `dpf-native` executor already honours `LLM_BASE_URL` and routes through the portal's inference layer ([build-execution-provider spec](../superpowers/specs/2026-05-09-build-execution-provider-design.md)), so a sovereign Build Studio is possible today. The image still ships the US CLIs.
- **Linux local LLM**: Ollama (MIT, OSS-US) runs in compose (`docker-compose.linux.yml`). Its default model pulls come from Ollama's hosted registry, a US-operated service. That is a distribution dependency for model weights, parallel to D2.

### 2.4 OSS-US (low risk; SBOM disclosure only)

Next.js and next-auth (Vercel), React and React Native (Meta), Ollama, Grafana, Loki and Alloy (Grafana Labs), the Inngest server (self-hosted), browser-use, and Expo SDK. Prometheus, OpenTelemetry and cAdvisor are CNCF/Google-originated. Prisma is German. There is no Google Fonts, no SaaS analytics, and no outbound telemetry. Observability sits entirely behind the self-hosted `runtime-deep-observability` profile. DPF itself is Apache-2.0.

**Silicon.** NVIDIA GPU dependence is out of scope here and is already disclosed as a caveat in the briefing §6.

---

## 3. Mapping onto work that already exists

Most of the remediation already has a home. Extend these epics rather than opening parallel ones.

| Dep | Existing owner | State (from the docs, not live DB) | Residual gap |
| --- | --- | --- | --- |
| D1, D2, D6 | [macOS/Linux native-support plan](../superpowers/plans/2026-05-09-macos-linux-native-support.md); [deployment contracts](../superpowers/specs/2026-05-09-deployment-contracts.md) capability matrix (Linux default LLM = Ollama in compose) | Linux native is **early access** | **G1**: no decision to make a Docker-Desktop-free Linux substrate the *sovereign reference* and take it to GA. Podman/rootless are refused by preflight. |
| D3, D4 | [Dependency-sovereignty roadmap](../superpowers/plans/2026-07-22-ep-dep-sovereignty-remaining-roadmap.md) Phase E (`BI-57731D5D`, Verdaccio-class npm proxy) | Planned; **npm only** | **G2**: no container-image mirror or relocatable registry. The `ghcr.io` host is hard-coded in `docker-compose.release.yml`. |
| D5 | [Forge-neutral offline integration](../superpowers/specs/2026-07-11-forge-neutral-offline-integration-design.md) (`EP-5410E8EA`): `BI-FC29F7AB` contracts, `BI-058F7AA8` self-upgrade on forge-neutral refs, `BI-72C751B9` optional Forgejo/Gitea provider | Ratified; early phases landed | **G3**: `BI-72C751B9` is scoped as an *evaluation*. There is no Codeberg/Forgejo **public mirror** of the source and releases. The spec says remote cutover or mirroring needs its own operator decision. |
| TAPPaaS packaging | [Cloud deployment spec](../superpowers/specs/2026-05-09-cloud-deployment-design.md) "TAPPaaS module"; [rollout plan](../superpowers/plans/2026-05-09-deployment-architecture-and-rollout.md) Epic E | Spec shipped; Tool Evaluation not yet run; depends on multi-arch GHCR + `--headless` | **G4**: the Tool Evaluation and `deploy/tappaas/` module slice are not started. The facts that answer its "project maturity" open question are now verified (§4). |
| Sovereignty posture | [Estate sovereignty governance](../superpowers/specs/2026-06-19-estate-sovereignty-governance-design.md) (`EP-ESTATE-SOVEREIGNTY`); `computeInstallCadaReadiness()` | Phase 1 landed; `targetAssuranceLevel` persistence and signed SBOM open | **G5**: the readiness assessment scores inference residency and jurisdiction but not the **distribution/host dependencies** above (D1–D5). An install on Docker Desktop pulling from GHCR scores the same as a Proxmox VM pulling from an EU mirror. |
| Build Studio sandbox | Build execution provider spec (`dpf-native` honours `LLM_BASE_URL`) | `dpf-native` exists | **G6**: no sandbox image variant without the baked-in US vendor CLIs, for installs that must not ship them. |
| Mobile push | [Mobile companion spec](../superpowers/specs/2026-03-19-mobile-companion-app-design.md) | Expo relay hard-coded | **G7**: no self-hosted/EU push relay option (direct APNs/FCM from the portal, or UnifiedPush on Android). |
| Model weights | Deployment contracts Contract 9 (LLM provider) | Weights from Docker Hub `ai/` or the Ollama registry | **G8**: no documented offline/EU source for model weights (pre-seeded weights, a customer-held model store, or the TAPPaaS AI Stack per the cloud spec). |

---

## 4. TAPPaaS: verified facts (Sept 2026)

These close the cloud-deployment spec's open question on project maturity. They are public facts only; nothing here records the content of the operator's meeting.

- **What it is:** "an open-source, self-hosted platform for digital sovereignty", offering enterprise-class identity, updates, backup and security on hardware the customer owns. Target users are "small businesses, governments, NGOs, communities and capable households". ([tappaas.org](https://tappaas.org/))
- **Who:** founded by Lars Rossen and Erik van Busschbach. Decisions are "made through community discussion and consensus". ([About TAPPaaS](https://tappaas.org/about/))
- **Forge:** developed on **Codeberg**, a German non-profit. It has a documented module template ("Develop a Module"). ([About TAPPaaS](https://tappaas.org/about/))
- **License:** MPL-2.0, which is compatible with DPF's Apache-2.0 for a module that wraps DPF without copying TAPPaaS source into DPF.
- **Stack:** Proxmox (Austria) and OPNsense (Netherlands); the catalogue includes Nextcloud, OpenWebUI, n8n, Home Assistant and Vaultwarden. The AI Stack (OpenWebUI / LiteLLM / Ollama / vLLM) and Authentik SSO are already captured in the cloud-deployment spec.
- **Positioning:** FOSDEM 2026 talk, "TAPPaaS: A Sovereign PaaS Blueprint for Europe's Public and Civic Sector". It explicitly invites "consumers, operators or contributors". ([FOSDEM 2026](https://archive.fosdem.org/2026/schedule/event/SDVZGB-tappaas_a_sovereign_paas_blueprint_for_europes_public_and_civic_sector/))
- **Still unknown:** funding, legal entity, release cadence, and module-catalogue vetting process. The Tool Evaluation Pipeline must still run before any hard dependency.

**Fit.** TAPPaaS is infrastructure (L0–L2 of the stack). DPF is the application and AI operations layer that runs on it. The v1 module shape already recommended in the cloud-deployment spec is a dedicated VM running the Single VM substrate via `install-dpf.sh --headless`, using the TAPPaaS AI Stack as the external LLM. On Linux, that module shape removes D1, D2 and D6 without new architecture.

---

## 5. Is the sovereign open-source ecosystem a valid path to market?

**Yes, as a channel, not a certification.** CADA certifies the *operator of a cloud service*, not software. DPF therefore reaches public-sector and NIS2 buyers through **EU operators**: integrators, sovereign IaaS providers, and platforms like TAPPaaS that run it. The Apache-2.0 licence and self-hosting are what make DPF eligible. The operator relationship is what makes it procurable.

### 5.1 Parties plausibly interested (to qualify, not claims of interest)

| Party | What they are | Why DPF is relevant |
| --- | --- | --- |
| **TAPPaaS** | Sovereign FOSS PaaS for SMB, public and civic users ([site](https://tappaas.org/)) | Needs applications for its catalogue; DPF is an ITSM/ops/AI layer that fits its audience. |
| **ZenDiS / openDesk** | German federal centre for digital sovereignty; openDesk is an integrated FOSS workplace ([openDesk](https://www.opendesk.eu/en/about)) | openDesk combines existing FOSS projects behind shared authentication, the same integration pattern DPF uses. It has no operations or AI-governance layer. |
| **EuroStack** | Initiative promoting European open solutions ([euro-stack.com](https://euro-stack.com/)) | A catalogue and advocacy channel. |
| **Open Source Business Alliance (OSBA)** | German open-source industry association | Reaches integrators that serve the public sector. |
| **Sovereign Tech Agency; NLnet / NGI** | Public funders of open digital infrastructure ([STA](https://en.wikipedia.org/wiki/Sovereign_Tech_Agency)) | Possible funding for G2/G3-class work (EU distribution and forge neutrality). Check current calls before applying; this document does not claim an open call exists. |
| **EU IaaS providers**: OVHcloud, Scaleway, STACKIT, IONOS, Hetzner | Sovereign infrastructure | Already named in briefing §5 as reference deploy targets; they want application workloads. |
| **Mistral** | EU model vendor, open weights | Already named in briefing §5 as the sovereign AI partner. |

### 5.2 Caveats (don't overclaim)

1. **CADA is a proposal.** Published 2026-06-03, with application estimated around 2029 ([activeMind.legal](https://www.activemind.legal/guides/cada/)). Procurement is already embedding its criteria ([Lawfare](https://www.lawfaremedia.org/article/the-eu-cloud-and-ai-development-act); [BISI](https://bisi.org.uk/reports/eu-cloud-and-ai-development-act-sovereignty-ai-and-us-tech-dependence)).
2. **The GA story contradicts the pitch.** The only GA platform is Windows + Docker Desktop (D1). A sovereignty buyer will expect a Linux or Proxmox reference install. G1 and G4 are prerequisites for credibly entering this channel, not follow-ups.
3. **Distribution is single-vendor.** Until G2 and G3 land, a buyer can fairly say that DPF's supply chain runs entirely through Microsoft (GitHub/GHCR) and Docker Inc. The briefing §6 already flags the L4 "control over software evolution" governance gap (EU steward entity, reproducible builds, signed SBOM). G2 and G3 are its engineering half.
4. **The development process uses US AI tools** (Claude Code, Codex, Grok as delivery surfaces). This does not affect the shipped product's runtime, but disclose it if a buyer asks about "control over software development".

---

## 6. Recommended next steps

1. File G1–G8 as backlog items under the owning epics in §3. Extend those epics; don't open parallel ones.
2. Run the TAPPaaS Tool Evaluation (Epic E first slice) using §4 as input.
3. Put the operator decisions to the operator explicitly, in two places:
   - G1: whether Linux/Proxmox becomes the sovereign reference, and its GA criteria.
   - G3: whether to publish a Codeberg public mirror. This needs a remote-mirroring decision per the forge-neutral spec §1.
4. Qualify the §5.1 parties through the operator's own outreach. Record partners as CRM/org data, not in this document.
