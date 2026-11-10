---
title: "System One decision models (Jev and open alternatives): landscape and applications"
date: 2026-09-26
backlog: BI-734E0C69
epic: EP-0AF96937
feeds: docs/superpowers/specs/2026-09-26-system-one-typed-decision-layer-design.md
---

# System One decision models: landscape and applications

Research note behind the [typed-decision layer design](../specs/2026-09-26-system-one-typed-decision-layer-design.md).
Vendor claims and independent evidence are kept apart on purpose. Figures come from the sources cited and have **not** been reproduced on DPF hardware or data. Reproducing them is what the design's Phase 0 is for.

## 1. What the model class is

A "System One" model gets a `state` (text, and for some builds one image) plus a set of typed **questions**. It returns a probability distribution for each question, not prose. There are three primitives ([TypeSafe docs](https://docs.typesafe.ai/)):

| Primitive | Question shape | Answer |
|---|---|---|
| `choice` | `criteria`: map of labels to descriptions (hosted: up to 255; OpenJev: 52 per pass, larger sets run as a tournament) | `choice`, `probabilities`, `confidence` |
| `score` | `criteria`: ordered array of 2–10 described levels | `score` = sum of level × probability, `probabilities`, `confidence`, `legend` |
| `noul` | Optional `true`/`false` descriptions | a single number in 0..1 |

Mechanism: the options are labelled with letters, and the scores of exactly those letter tokens are read at the **first output position**, then turned into probabilities with a fixed readout temperature ([OpenJev card](https://huggingface.co/openjev/openjev)). Every question over the same state runs in parallel. Because they share the state prefix, adding questions costs little latency ([fan-out pattern](https://docs.typesafe.ai/patterns/fan-out.md); the cookbook reports 13 questions at 0.27 s vs 2.71 s sequential). For a three-option Choice, confidence is `(3·p_max − 1)/2`; flatter distributions give lower confidence. TypeSafe suggests act above ~0.9, confirm between 0.5 and 0.9, escalate below 0.5, with **thresholds scaled to the consequence of being wrong** ([confidence](https://docs.typesafe.ai/confidence.md)).

This technique is not new. It is first-token logprob classification (Kadavath et al. 2022, arXiv 2207.05221). Its Score primitive is G-Eval-style probability-weighted rubric scoring (Liu et al. 2023, arXiv 2303.16634). The claimed product difference is a post-training objective TypeSafe calls RLCD, which rewards stated probabilities that match observed accuracy. **No paper or technical report on RLCD is published.**

## 2. Candidates

| Candidate | Weights / license | Fits the host 4090 (24 GB)? | Self-reported quality | Notes |
|---|---|---|---|---|
| Hosted **Jev** (`jev-1.13.0`) | Closed; API | n/a (US-hosted; also on Vercel AI Gateway and Cloudflare Workers AI) | 85.4% on OpenJev's 10k-question text benchmark | $0.042 per million input tokens, output free; 64k tokens per request (32k state); text only. Not used for training; zero retention is enterprise-only. Data leaves the install. |
| **OpenJev** 27B ([card](https://huggingface.co/openjev/openjev)) | **CC BY-NC 4.0** (helper Apache-2.0); independent of TypeSafe | Yes as GGUF: Q4_K_M 16.5 GB (82.8%, 96.6% agreement with 16-bit), Q5_K_M 19.2 GB; text only | 84.0% text; shuffle instability 2.3% (18.5% before tuning); MiniWoB 39/100; screenshots 88% (FP8/vLLM only) | Non-commercial: cannot ship. Commercial-licence enquiry unanswered (discussion #1). Discussion #2 questions whether the model is real. Would evict the resident 27B model. |
| **Open-Jev** (Zefan-Cai, [repo](https://github.com/Zefan-Cai/Open-Jev)) | MIT code, Apache-2.0 adapter | 9B fits in BF16; 27B adapter over a Qwen base | 85.28% vs Jev 86.58% on the 231-task JevBench | LoRA adapter plus a scalar decision head. The base model is named inconsistently (Qwen3.5-2B vs Qwen3.8-27B). **If it is the resident Qwen3.8-27B, the adapter may load onto the model already in VRAM.** Unverified. |
| **Laya** ([repo](https://github.com/NandhaKishorM/laya)) | Apache-2.0 | Trivially (322–421M encoder) | 0.766 vs Jev's 0.727 on its own 2,000-decision benchmark; ECE 0.081 after temperature fitting | ModernBERT encoder, 512–8k context. One independent test found it slow on CPU and saw outputs that differed from its docs ([Flowtivity](https://flowtivity.ai/blog/laya-open-source-jev-alternative/)). |
| **Kev 0.8B** (`jaredpalmer/kev-0.8b`) | License unchecked (BI-734E0C69) | Yes (~4.3 GB bf16) | none located | Speaks the System One wire API ([helix.ml](https://helix.ml/blog/one-ramjet-two-apis-kev-systemone)). |
| razorback16/openjev | Apache-2.0 | Needs at least 24 GB | none published | Wire-compatible server over DiffusionGemma 26B-A4B. |
| **Absorb**: logprob readout on the resident model | Already licensed | Already resident | Unknown; the untuned base shuffles far more (OpenJev's pre-tuning figure was 18.5%) | Needs `logprobs`/`top_logprobs` through the Docker Model Runner (llama.cpp) chat path. `chat-adapter.ts` requests none today. |

## 3. What independent observers found

- **Calibration is unmeasured by anyone outside the vendors.** No independent ECE or reliability curve exists for Jev or OpenJev ([eesel](https://www.eesel.ai/blog/typesafe-jev-review) explicitly did not test it). Calibration is the headline value, so DPF has to measure it on its own data. It also does not carry over between backends or quantisations.
- **"Never hallucinates" means the output is always a valid type, not a correct one.** It can put high confidence on a wrong valid answer; the CEO conceded this on [HN](https://news.ycombinator.com/item?id=49717558). Several commenters see the mechanism as equivalent to constrained decoding.
- **TypeSafe's own list of weaknesses** ([jaggedness](https://docs.typesafe.ai/model-jaggedness/jev-1.13.md)):
  - takes instructions literally;
  - weak at maths, counting and comparing numbers or dates;
  - trips on double negatives;
  - **accuracy falls as irrelevant state grows**;
  - can be steered by instructions injected into the state;
  - complementary questions need not sum consistently;
  - Score has "weak numerical calibration".
- **Real deployments:** eesel reports 93% triage accuracy and 100% spam catch on 284 chats and 100 tickets. [TechCrunch](https://techcrunch.com/2026/09/18/a-new-kind-of-ai-model-from-a-chatgpt-inventor-is-thrilling-developers/) quotes Vercel at 5–18× faster for safety classification, and one CTO who found it 10–20× *more* expensive than Gemini alternatives.
- **Browser agents** ([browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast), MIT):
  - Each step builds an indexed element table. One Choice call picks the operation (CLICK / TYPE_TEXT / SELECT / SCROLL / WAIT / DONE / BLOCKED) and the target.
  - A small LLM writes text only when the operation is TYPE_TEXT. There are no screenshots in the loop.
  - Zürich→London flight pick: median 9.45 s → 7.09 s, browser calls 1,092 → 101.
  - The repo calls it a single-profile result, not a reliability benchmark. It does not support shadow roots, frames, canvas, uploads or popups.

## 4. Applications raised in the Jev review video

Source: a founder-shared transcript (YouTube `4mTLpuQpB80`, interview with an OpenCode founding-team member), summarised rather than quoted. Each use is shown next to the DPF surface it maps to.

| Use shown or proposed | Mechanism | DPF counterpart |
|---|---|---|
| Triage of 1,700 emails: category, priority, spam probability, whether it warrants a reply. About $0.18 total for 4.2M input tokens. | One state, four parallel questions | Mailroom typed triage (`2026-09-09-mailroom-email-triage-and-dispatch-design.md`, AC-MAIL-TYPED-REASON: output already constrained to registry keys, which is a Choice question), `lib/mailroom` |
| Inbound lead quality from a contact form ("is good lead", 0..1) | Noul, with an escalation threshold | CRM lead triage, WWWD `evaluate_org_business_decision`; for the rescue org, adoption and foster application screening |
| Support routing to the right team | Choice over teams | Service-request routing, `find_coworker`, coworker dispatch |
| Instant quote / provider matching | Choice or Score over candidate providers | Service assignment (`service-assignment-proposal`), marketplace matching |
| Finding the best clip moments in a long transcript (17 moments in ~3 s) | Score per segment, fanned out | Document review: score every section of a spec or plan on each axis at once (design §4.4) |
| Browser control: a flight picked in 7.1 s | Choice over the element table each step | Coworker acting on the user's current screen through the Authorized Surface Contract (design §4.5) |
| "Traffic cop": decide what the input is, how important it is, and what happens next | Choice + Score + Noul fan-out, then a threshold route to human, LLM or ignore | The general DPF pattern: the typed layer decides the route and an LLM writes only where text is needed |
| Next-letter "typing" as a decision per keystroke | Choice over characters | Curiosity only; not a DPF use |
| Buy/hold/sell trading signal | Choice | **Explicitly poor in the demo; out of scope.** DPF forbids autonomous financial trades regardless. |

The interviewee's own caveat applies to DPF: use it as a heavily *advisory* layer for fast, well-posed decisions, not for tasks that need wider knowledge or reasoning.
