# TAK + GAID Standards Family Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Revise `TAK` and `GAID` into peer normative standards, add a new white paper that explains the market and policy need for both, and produce a first-pass `DPF` conformance assessment with materially improved diagram quality and source-of-truth authoring.

**Architecture:** Keep `TAK` and `GAID` as separate but cross-referential standards. Treat Markdown as the editable source of truth, generate polished `.docx` outputs from scripts, and use a shared diagram pipeline that emits archival vector outputs plus high-resolution raster images for Word embedding. Anchor the white paper’s tone and structure to Mark Bodman’s existing Open Group-style white papers, not generic AI-generated prose.

**Tech Stack:** Markdown, Mermaid, Node.js, `docx`, Mermaid CLI, existing TAK doc generator, PowerShell, optional Python for source extraction/QA

---

## Chunk 1: Source Consolidation and Style Baseline

### Task 1: Inventory the source documents and style references

**Files:**
- Modify: `D:/DPF/docs/architecture/trusted-ai-kernel.md`
- Create: `D:/DPF/docs/architecture/GAID.md`
- Create: `D:/DPF/docs/architecture/agent-standards-style-notes.md`
- Reference: `D:/DPF/docs/Reference/shift_to_digital_product.txt`
- Reference: `D:/DPF/docs/Reference/digital_product_portfolio_mgmt.txt`
- Reference: `D:/DPF/docs/architecture/GAID.docx`

- [ ] **Step 1: Capture the current source inputs**

Run:
```powershell
Get-Item `
  D:\DPF\docs\architecture\trusted-ai-kernel.md,
  D:\DPF\docs\architecture\GAID.docx,
  D:\DPF\docs\Reference\shift_to_digital_product.txt,
  D:\DPF\docs\Reference\digital_product_portfolio_mgmt.txt
```

Expected: all four files exist.

- [ ] **Step 2: Extract the current GAID text into a working outline**

Run:
```powershell
$env:PYTHONIOENCODING='utf-8'
@'
from pathlib import Path
from docx import Document
doc = Document(Path(r"D:\DPF\docs\architecture\GAID.docx"))
for p in doc.paragraphs:
    text = p.text.strip()
    if text:
        print(text)
'@ | & 'C:\Users\Mark Bodman\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -
```

Expected: a clean text extraction of the current GAID proposal.

- [ ] **Step 3: Write style notes from Mark’s prior white papers**

Create `D:/DPF/docs/architecture/agent-standards-style-notes.md` with:
- tone markers from `shift_to_digital_product.txt`
- tone markers from `digital_product_portfolio_mgmt.txt`
- structural patterns to mimic
- phrases or habits to avoid

- [ ] **Step 4: Commit the source-of-truth authoring decision into the working notes**

Document in the style notes that:
- Markdown is the editable source of truth
- generated `.docx` files are outputs
- the white paper must follow Mark’s established Open Group-style voice: declarative, formal, pragmatic, market-aware, and explicit about governance implications

### Task 2: Create the document scaffolds

**Files:**
- Create: `D:/DPF/docs/architecture/GAID.md`
- Create: `D:/DPF/docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md`
- Create: `D:/DPF/docs/architecture/agent-standards-dpf-conformance.md`

- [ ] **Step 1: Create the GAID Markdown scaffold**

Include top-level headings for:
- Scope
- Conformance
- Terms and definitions
- Namespace and issuer model
- Agent Identity Document
- Badge and assurance model
- Authorization classes
- Receipts and chain-of-custody
- Protocol profiles
- Security and privacy considerations

- [ ] **Step 2: Create the white paper scaffold**

Include top-level headings for:
- Executive Summary
- The Market Problem
- Why Current Standards Fall Short
- Evidence from Public Policy and Industry Activity
- The Case for TAK
- The Case for GAID
- DPF as a Proving Ground
- Recommendations for Governments, Standards Bodies, and Enterprises

- [ ] **Step 3: Create the DPF conformance scaffold**

Include tables for:
- `TAK` controls
- `GAID` controls
- current `DPF` status
- evidence path
- recommended next step

- [ ] **Step 4: Verify the scaffolds exist**

Run:
```powershell
Get-Item `
  D:\DPF\docs\architecture\GAID.md,
  D:\DPF\docs\architecture\2026-04-18-trusted-ai-agent-governance-white-paper.md,
  D:\DPF\docs\architecture\agent-standards-dpf-conformance.md
```

Expected: all three files exist.

## Chunk 2: Diagram and Output Pipeline Upgrade

### Task 3: Upgrade the diagram pipeline for archival quality and Word output quality

**Files:**
- Modify: `D:/DPF/docs/architecture/generate-tak-docx.mjs`
- Create: `D:/DPF/docs/architecture/generate-gaid-docx.mjs`
- Create: `D:/DPF/docs/architecture/generate-agent-standards-white-paper-docx.mjs`
- Modify: `D:/DPF/docs/architecture/tak-diagrams/mermaid-config.json`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/png/`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/svg/`

- [ ] **Step 1: Define the new diagram rendering standard**

Write into the generator comments and usage notes:
- generate `svg` masters for every Mermaid diagram
- generate high-resolution `png` versions for Word embedding
- target at least `2400px` width for complex diagrams
- use consistent white background, larger scale, and legible caption sizing

- [ ] **Step 2: Update the TAK generator to emit higher-quality diagram assets**

Ensure the TAK generator:
- renders `svg` and `png`
- uses larger width and scale than the current output
- preserves aspect ratio instead of squeezing diagrams into blurry dimensions

- [ ] **Step 3: Create equivalent GAID and white paper generator scripts**

Use the TAK generator structure as the starting pattern, but split concerns so:
- TAK output is generated from `trusted-ai-kernel.md`
- GAID output is generated from `GAID.md`
- the white paper output is generated from `2026-04-18-trusted-ai-agent-governance-white-paper.md`

- [ ] **Step 4: Add diagram quality verification commands**

Run:
```powershell
Get-ChildItem D:\DPF\docs\architecture\tak-diagrams\png | Select-Object Name,Length
Get-ChildItem D:\DPF\docs\architecture\gaid-diagrams\png | Select-Object Name,Length
```

Expected: regenerated PNG files are materially larger than the previous low-resolution outputs.

## Chunk 3: Rewrite TAK as a Normative Standard

### Task 4: Convert TAK from architecture narrative to normative standard

**Files:**
- Modify: `D:/DPF/docs/architecture/trusted-ai-kernel.md`
- Reference: `D:/DPF/apps/web/lib/tak/agentic-loop.ts`
- Reference: `D:/DPF/apps/web/lib/tak/prompt-assembler.ts`
- Reference: `D:/DPF/apps/web/lib/tak/agent-grants.ts`
- Reference: `D:/DPF/apps/web/lib/tak/agent-routing.ts`
- Reference: `D:/DPF/apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Replace the current intro with standards-form opening sections**

Add:
- Scope
- Conformance
- Normative references
- Terms and definitions

- [ ] **Step 2: Rewrite the control model using `MUST / SHOULD / MAY`**

Core normative sections must include:
- authority mediation
- execution mode enforcement
- HITL requirements
- immutable directive handling
- audit requirements
- delegation narrowing

- [ ] **Step 3: Add the missing runtime topics called out in the spec**

Add normative sections for:
- memory retention and retrieval controls
- context-window management and truncation policies
- disclosure and governance of hidden instructions
- prompt, tool, skill, and context injection defenses
- runtime transparency to human supervisors
- specialist vs coordinator agent patterns

- [ ] **Step 4: Add a conformance model**

Define at least three profiles:
- `TAK-Basic`
- `TAK-Managed`
- `TAK-Assured`

- [ ] **Step 5: Update TAK diagrams to match the new normative framing**

Ensure TAK diagrams show:
- authority stack
- execution gating
- delegation narrowing
- audit surfaces
- memory/context controls where useful

- [ ] **Step 6: Generate the TAK `.docx` output**

Run:
```powershell
node D:\DPF\docs\architecture\generate-tak-docx.mjs
```

Expected: updated `Trusted-AI-Kernel-Architecture.docx` with sharper diagrams and refreshed section structure.

## Chunk 4: Rewrite GAID as a Normative Standard

### Task 5: Migrate GAID to Markdown and expand it into a full identity and badging standard

**Files:**
- Create: `D:/DPF/docs/architecture/GAID.md`
- Modify: `D:/DPF/docs/architecture/GAID.docx`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/01-gaid-namespace.mmd`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/02-aidoc-resolution.mmd`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/03-receipt-chain.mmd`
- Create: `D:/DPF/docs/architecture/gaid-diagrams/04-assurance-model.mmd`

- [ ] **Step 1: Convert the existing GAID proposal into Markdown source**

Preserve the useful current ideas, but reorganize into a standards document structure.

- [ ] **Step 2: Expand the identifier model**

Add normative sections for:
- public namespace
- private namespace
- boundary mapping
- delegated prefixes
- issuer accreditation
- revocation and reassignment

- [ ] **Step 3: Expand the identity and badge model**

Add normative sections for:
- Agent Identity Document fields
- model, tool, prompt, and skill surface declarations
- assurance levels: self-asserted, org-attested, independently-certified
- badge categories: capability, governance, data sensitivity, action classes, fit-for-purpose, safety claims

- [ ] **Step 4: Add certificate and trust-chain requirements**

Specify:
- certificate-backed external validation
- signing keys and rotation
- verification expectations for public agents

- [ ] **Step 5: Add signed receipt and custody requirements**

Specify:
- minimum receipt fields
- trace context
- actor and delegate identities
- authorization class references
- content hashing and privacy-safe evidence

- [ ] **Step 6: Add protocol compatibility profiles**

Define how `GAID` claims map onto:
- `MCP`
- `A2A`
- HTTP/API transport
- async or queue-based systems

- [ ] **Step 7: Generate the GAID `.docx` output**

Run:
```powershell
node D:\DPF\docs\architecture\generate-gaid-docx.mjs
```

Expected: refreshed `GAID.docx` generated from `GAID.md`, not manually edited in Word.

## Chunk 5: Write the White Paper

### Task 6: Draft the supporting white paper in Mark’s established style

**Files:**
- Create: `D:/DPF/docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md`
- Reference: `D:/DPF/docs/Reference/shift_to_digital_product.txt`
- Reference: `D:/DPF/docs/Reference/digital_product_portfolio_mgmt.txt`
- Reference: `D:/DPF/docs/architecture/agent-standards-style-notes.md`

- [ ] **Step 1: Write the Executive Summary and framing sections**

Use the same high-level style markers seen in Mark’s prior papers:
- declarative thesis
- pragmatic business and governance framing
- explicit statement of what problem is being solved

- [ ] **Step 2: Write the standards gap analysis**

Compare `TAK` and `GAID` against:
- `ISO/IEC 42001`
- `NIST AI RMF`
- `MCP`
- `A2A`
- provenance and trace standards
- model/system card practices

- [ ] **Step 3: Add the public-policy and market evidence section**

Include dated, sourced references for:
- `NIST AI Agent Standards Initiative`
- `NCCoE` concept paper on agent identity and authorization
- `White House` AI Action Plan
- `OpenAI` public policy and compliance activity
- `Anthropic` public policy and evaluation activity

- [ ] **Step 4: Write the DPF proving-ground section**

Explain:
- what DPF already demonstrates
- where it aligns with TAK today
- where it partially aligns with GAID
- why exercising the standards on a live platform matters

- [ ] **Step 5: Add the adoption and submission section**

Target audiences:
- governments
- standards bodies
- enterprise buyers
- frontier AI vendors

- [ ] **Step 6: Generate the white paper `.docx` output**

Run:
```powershell
node D:\DPF\docs\architecture\generate-agent-standards-white-paper-docx.mjs
```

Expected: a polished `.docx` white paper with readable diagrams and a tone consistent with Mark’s prior papers.

## Chunk 6: DPF Conformance Assessment and Final Verification

### Task 7: Write the DPF conformance matrix

**Files:**
- Create: `D:/DPF/docs/architecture/agent-standards-dpf-conformance.md`
- Reference: `D:/DPF/apps/web/lib/tak/agentic-loop.ts`
- Reference: `D:/DPF/apps/web/lib/tak/prompt-assembler.ts`
- Reference: `D:/DPF/apps/web/lib/tak/agent-grants.ts`
- Reference: `D:/DPF/apps/web/lib/tak/agent-routing.ts`
- Reference: `D:/DPF/apps/web/lib/mcp-tools.ts`

- [ ] **Step 1: Assess DPF against TAK controls**

For each control, mark:
- implemented
- partially implemented
- not implemented
- evidence path

- [ ] **Step 2: Assess DPF against GAID controls**

For each control, mark:
- implemented
- partially implemented
- not implemented
- evidence path

- [ ] **Step 3: Add a recommended roadmap section**

Group recommendations into:
- short-term
- medium-term
- submission-ready future work

### Task 8: Run final output verification

**Files:**
- Verify: `D:/DPF/docs/architecture/Trusted-AI-Kernel-Architecture.docx`
- Verify: `D:/DPF/docs/architecture/GAID.docx`
- Verify: `D:/DPF/docs/architecture/Trusted-AI-Agent-Governance-White-Paper.docx`

- [ ] **Step 1: Verify Markdown sources exist and are non-empty**

Run:
```powershell
Get-Item `
  D:\DPF\docs\architecture\trusted-ai-kernel.md,
  D:\DPF\docs\architecture\GAID.md,
  D:\DPF\docs\architecture\2026-04-18-trusted-ai-agent-governance-white-paper.md,
  D:\DPF\docs\architecture\agent-standards-dpf-conformance.md | Select-Object FullName,Length
```

Expected: all files exist and have meaningful size.

- [ ] **Step 2: Verify `.docx` outputs exist**

Run:
```powershell
Get-Item `
  D:\DPF\docs\architecture\Trusted-AI-Kernel-Architecture.docx,
  D:\DPF\docs\architecture\GAID.docx,
  D:\DPF\docs\architecture\Trusted-AI-Agent-Governance-White-Paper.docx | Select-Object FullName,Length,LastWriteTime
```

Expected: all outputs exist and were regenerated in the current working session.

- [ ] **Step 3: Spot-check diagram output sizes**

Run:
```powershell
Get-ChildItem D:\DPF\docs\architecture\tak-diagrams\png | Select-Object Name,Length
Get-ChildItem D:\DPF\docs\architecture\gaid-diagrams\png | Select-Object Name,Length
```

Expected: output sizes are consistent with high-resolution exports, not tiny blurry raster assets.

- [ ] **Step 4: Commit the documentation set**

Run:
```bash
git add \
  docs/architecture/trusted-ai-kernel.md \
  docs/architecture/GAID.md \
  docs/architecture/GAID.docx \
  docs/architecture/2026-04-18-trusted-ai-agent-governance-white-paper.md \
  docs/architecture/Trusted-AI-Agent-Governance-White-Paper.docx \
  docs/architecture/agent-standards-dpf-conformance.md \
  docs/architecture/generate-tak-docx.mjs \
  docs/architecture/generate-gaid-docx.mjs \
  docs/architecture/generate-agent-standards-white-paper-docx.mjs \
  docs/architecture/agent-standards-style-notes.md \
  docs/architecture/tak-diagrams \
  docs/architecture/gaid-diagrams
git commit -m "docs: establish TAK and GAID standards family"
```

Expected: a focused commit that contains the revised standards, new white paper, new conformance matrix, and improved document-generation pipeline.
