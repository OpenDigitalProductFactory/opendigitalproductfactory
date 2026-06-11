# Zig Adoption Assessment — Research Note

- **Date:** 2026-06-10
- **Backlog item:** BI-982D28D4
- **Status:** Decided — do not adopt Zig as an application language. Two standing revisit triggers recorded (§6).
- **Question evaluated:** DPF runs on many fragmented open-source components. Could the cohesion and performance of the Zig programming language serve the platform better than the current stack, considering all existing functionality and where the platform is headed?

## 1. Verdict

**Do not adopt Zig as a DPF application language.** The premise mismatches on both sides: DPF's fragmentation is at the *service and dependency* level, which a language cannot consolidate, and Zig's strengths (systems infrastructure, cross-compilation, WASM) sit below the layer where DPF does its work. For an AI-native organization where Build Studio writes essentially all feature code, Zig's documented-weak and perpetually-stale LLM proficiency is disqualifying on its own.

The grounded path to Zig's performance dividend is **consuming Zig-built infrastructure** — most concretely the Bun runtime (written in Zig, owned by Anthropic since December 2025) — rather than writing Zig.

## 2. What the stack actually is (inventory, 2026-06-10)

Measured from the repo at assessment time:

| Surface | Facts |
| --- | --- |
| Authored application code | ~73k LOC TypeScript (apps/web ~17k, packages/* ~56k), Next.js 16 + React 19, Prisma 7 with **405 Postgres models** |
| Other languages already present | Go (~5k LOC, `services/edge-node-go` native discovery agent), Python (~1.5k LOC, `services/browser-use` FastAPI sidecar), shell/PowerShell automation |
| Runtime services (docker-compose) | 27 services: Postgres, Neo4j, Qdrant, Redis, Inngest, portal, sandbox stack, Prometheus/Grafana + exporters, STT/TTS sidecars, promoter, ADP MCP, browser-use |
| Direct deps | apps/web: 48 dependencies + 19 dev; packages/db: 11 + 9 |
| Native/compiled components | sharp (libvips C binding) — the only native node module; Go edge agent is statically linked, zero CGO |
| Compute-heavy work | Delegated to specialized services: vectors → Qdrant, graph traversal → Neo4j, inference → external LLMs/Docker Model Runner, speech → Whisper container, images → libvips via sharp |

**Key structural finding:** there is no performance-critical bottleneck currently implemented in TypeScript. The platform already follows the right pattern — orchestration in TS, heavy compute in purpose-built engines (most of which are themselves native code: Postgres/C, Neo4j/JVM, Qdrant/Rust, Redis/C, libvips/C). Any Zig adoption would be a rewrite for theoretical tightness, not a fix for observed slowness.

## 3. What Zig is in June 2026

- **Version/maturity:** 0.16.0 (April 2026), 0.17.0 imminent; ~2 releases/year, **each deliberately breaking**. The I/O layer was rewritten twice in 12 months ("Writergate" in 0.15, the new `std.Io` interface in 0.16, async backends still experimental). Andrew Kelley explicitly refuses a 1.0 date — "uncompromising perfection" first. Treat 1.0 as 1–3+ years out, unbounded.
- **Ecosystem:** package manager exists (`zig fetch` + `build.zig.zon`) but **no central registry**, no Dependabot/Renovate support, no SBOM/supply-chain tooling — low-thousands of packages vs ~3M npm. Web frameworks (http.zig, zap, jetzig, tokamak) are single-maintainer, hobby-to-small-production grade. Postgres driver exists (pg.zig, single maintainer); **no production-grade ORM or migration tooling** — against DPF's 405-model Prisma schema this alone ends the conversation for the data tier.
- **Who ships it:** TigerBeetle, Bun, Ghostty, Uber (`zig cc` toolchain only). The adopter profile is elite systems teams building databases, runtimes, and terminals — not application platforms. Turso evaluated and declined (ecosystem + memory safety).
- **Memory safety:** safer than C, but no compile-time guarantee against use-after-free or data races — a step *down* from both TypeScript (GC) and Rust.
- **Talent and AI proficiency:** 0.83% of Stack Overflow 2025 respondents; highest-paid language (scarcity premium). LLM coding assistants are documented-weak on Zig and — decisive for DPF — **stale by construction**: the breaking-change cadence invalidates training corpora every ~6 months, so assistants confidently emit deprecated APIs. The Zig project itself bans AI contributions ("invariably garbage"), so the canonical codebase produces no AI-era exemplars. TypeScript is the single best-served language by every coding assistant.

## 4. The consolidation thesis, examined fairly

**Steel-manning the idea first.** The instinct is sound: DPF runs 27 containers, ~70 direct dependencies, and 5 languages; each open-source component is a version-drift surface, a supply-chain surface, and an upgrade tax (the platform has lived this — vitest 4.1.6 silently breaking jest-dom, Turbopack NFT warning cascades, dev-portal polluting node_modules). Zig genuinely is the most cohesion-obsessed mainstream-adjacent language: one toolchain that is compiler + build system + package manager + cross-compiler + C compiler; single static binaries; no runtime. TigerBeetle proves a small team can build world-class infrastructure with it. If DPF were starting today to build *a database, a runtime, or an edge agent as the product*, Zig would be a serious candidate.

**Why it doesn't transfer to DPF:**

1. **The fragmentation is not language-shaped.** The component sprawl is Postgres + Neo4j + Qdrant + Redis + Inngest + Prometheus + Whisper — *services*, chosen for their data models and operational maturity. Rewriting the TypeScript orchestration layer in Zig consolidates none of them; every driver, every protocol, every container remains. DPF would go from 3 application languages to 4, with the new one the least-supported of all.
2. **The performance case is empty at present.** §2: no measured TS bottleneck exists. The expensive paths are LLM inference latency and database I/O — neither moves by changing the orchestration language. Next.js SSR/RSC, Prisma, Auth.js, Inngest durable execution, and the whole report-kit UI layer have no Zig equivalent; replacing them means rebuilding years of framework value by hand in a pre-1.0 language.
3. **It inverts the AI-native operating model.** DPF's standing rule is Build Studio writes all feature code, with LLM coworkers reviewing and verifying. Migrating to the language LLMs handle worst — and which resets assistant knowledge every 6 months — would degrade the platform's own production function. This is the single heaviest-weighted factor and it is decisive.
4. **Maintenance economics.** Twice-yearly breaking migrations across language, stdlib, and every dependency, absorbed by a team whose code is written by agents that don't know the new APIs yet, in a talent pool of <1% of developers. DPF's zero-tech-debt principle would be structurally violated by the substrate itself.
5. **Even the existing native niche is already filled.** The one place DPF needs a static native binary — the edge-node discovery agent — is Go, chosen for mature cross-platform syscall libraries and trivial cross-compilation. Zig would offer marginally smaller binaries at the cost of immature platform libraries (WMI, SNMP) and another toolchain. Not worth a rewrite.

## 5. Where Zig *does* intersect DPF's future credibly

- **Bun (the headline opportunity).** Bun v1.3.13 is a Node-compatible runtime written in Zig, acquired by Anthropic in Dec 2025, now underpinning Claude Code. It is the legitimate way to bank Zig's performance work with zero Zig written: `bun install` is a drop-in win today, and the Bun runtime reports material cold-start and throughput gains for Next.js-class workloads (validate per-project; JavaScriptCore vs V8 native-dep caveat applies — DPF's only native dep is sharp, which Bun supports). This deserves its own small evaluation BI when priorities allow.
- **napi-zig native addons.** If profiling ever surfaces a genuine TS hot path (e.g. large-scale parsing or scoring loops), Zig's cross-compilation makes multi-platform prebuilt `.node` addons genuinely easier than node-gyp. Narrow escape hatch, on-demand only.
- **WASM.** Zig's most mature story; relevant if DPF ever ships client-side or sandboxed compute plugins.

## 6. Revisit triggers

Re-open this assessment only when one of these becomes true:

1. **Zig tags 1.0** (or commits to a date) *and* a production ORM/migration story exists — re-score §3.
2. **A profiled, measured TS hot path** appears that a native addon would fix — scope a napi-zig spike instead of a migration.

Near-term actionable follow-up (separate BI, not this one): **evaluate Bun as the portal runtime/package manager** — that is where Zig's benefits are actually harvestable for DPF.

## 7. Sources

State of the language: [Zig downloads/releases](https://ziglang.org/download/) · [0.15.1 release notes ("extremely breaking")](https://ziglang.org/download/0.15.1/release-notes.html) · [0.16.0 release notes (std.Io)](https://ziglang.org/download/0.16.0/release-notes.html) · [Zig devlog 2026](https://ziglang.org/devlog/2026/) · [Kelley: no 1.0 date (The Register, 2026-05-28)](https://www.theregister.com/software/2026/05/28/zig-creator-seeks-uncompromising-perfection-before-blessing-10/5247916) · [JetBrains: Why Zig isn't 1.0 (2026-06-05)](https://blog.jetbrains.com/blog/2026/06/05/why-zig-isn-t-1-0-yet/) · [Andrew Kelley: new async I/O design](https://andrewkelley.me/post/zig-new-async-io-text-version.html) · [Loris Cro: new async I/O](https://kristoff.it/blog/zig-new-async-io/)

Migration pain & criticism: [0.15 migration roadblocks](https://sngeth.com/zig/systems-programming/breaking-changes/2025/10/24/zig-0-15-migration-roadblocks/) · [openmymind (http.zig author) on the new IO interface](https://www.openmymind.net/Im-Too-Dumb-For-Zigs-New-IO-Interface/) · [A year of Zig retrospective](https://strongly-typed-thoughts.net/blog/zig-2025) · [Turso: why not Zig yet](https://turso.tech/blog/why-i-am-not-yet-ready-to-switch-to-zig-from-rust) · [Zig supply-chain gap (Nesbitt, 2026-01)](https://nesbitt.io/2026/01/29/zig-and-the-mxn-supply-chain-problem.html) · [Zig bans AI contributions (Slashdot, 2026-05)](https://developers.slashdot.org/story/26/05/31/013213/zig-bans-ai-code-contributions-because-theyre-invariably-garbage)

Ecosystem: [http.zig](https://github.com/karlseguin/http.zig) · [zap](https://github.com/zigzap/zap) · [jetzig](https://github.com/jetzig-framework/jetzig) · [tokamak](https://github.com/cztomsik/tokamak) · [pg.zig](https://github.com/karlseguin/pg.zig) · [HEIG Zig web survey](https://pismice.github.io/HEIG_ZIG/docs/web/conclusion/) · [Zigistry](https://zigistry.dev/)

Adopters & Bun: [TigerBeetle + Synadia $512K pledge](https://tigerbeetle.com/blog/2025-10-25-synadia-and-tigerbeetle-pledge-512k-to-the-zig-software-foundation/) · [Anthropic acquires Bun (2025-12-02)](https://www.anthropic.com/news/anthropic-acquires-bun-as-claude-code-reaches-usd1b-milestone) · [Bun joins Anthropic](https://bun.com/blog/bun-joins-anthropic) · [Bun releases](https://github.com/oven-sh/bun/releases) · [Bun compatibility in 2026](https://dev.to/alexcloudstar/bun-compatibility-in-2026-what-actually-works-what-does-not-and-when-to-switch-23eb) · [Bun + Next.js guide](https://bun.com/docs/guides/ecosystem/nextjs) · [Bun runtime on Vercel Functions](https://vercel.com/blog/bun-runtime-on-vercel-functions) · [Companies using Zig](https://github.com/rofrol/zig-companies-and-organizations)

Interop & talent: [napi-zig](https://www.napi-zig.dev/) · [ChainSafe zapi](https://blog.chainsafe.io/zapi-zig-native-node-js-addons/) · [solarwinds/zig-build](https://github.com/solarwinds/zig-build) · [wazero: Zig WASM](https://wazero.io/languages/zig/) · [Stack Overflow 2025 survey](https://survey.stackoverflow.co/2025/technology) · [Zig highest-paid (InfoWorld)](https://www.infoworld.com/article/2336177/fast-growing-zig-tops-stack-overflow-survey-for-highest-paid-programming-language.html) · [Teaching recent Zig to your LLM (LoRA workaround)](https://akitaonrails.com/en/2025/05/03/teaching-recent-zig-to-your-llm-training-loras-sort-of/) · [Zig vs unsafe Rust](https://zackoverflow.dev/writing/unsafe-rust-vs-zig/) · [Rust Magazine rebuttal](https://rustmagazine.org/issue-3/is-zig-safer-than-unsafe-rust/)
