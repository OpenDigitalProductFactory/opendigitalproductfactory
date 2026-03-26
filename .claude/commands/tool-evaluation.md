---
name: tool-evaluation
description: Use when evaluating any external tool, MCP server, npm package, API integration, or dependency for security, architecture fit, compliance, and integration before adoption
source: EP-GOVERN-002 Tool Evaluation Pipeline
---

# Tool & Dependency Evaluation

Evaluate external tools through a structured multi-perspective pipeline before adoption.

**Core principle:** No tool enters the platform without diverse expert review, evidence-based findings, and human approval.

## The Iron Law

```
NO TOOL ADOPTION WITHOUT COMPLETING THE EVALUATION PIPELINE
```

## The Pipeline

### Phase 1: Discovery (if needed)
If the user states a need rather than a specific tool:
1. Search registries (npm, Smithery, GitHub, vendor sites)
2. Identify 2-5 candidates matching the need
3. Present candidates with basic info (stars, maintenance, license)
4. User selects which to evaluate (or evaluate all)

### Phase 2: Security Audit (CoSAI 12-Category Checklist)
For each candidate, evaluate ALL 12 categories — no skipping:

| # | Category | What to Check |
|---|----------|--------------|
| 1 | Authentication | Auth mechanism, hardcoded credentials, key rotation |
| 2 | Access Control | RBAC, least privilege, permission model |
| 3 | Input Validation | Injection vectors, sanitization, malformed input handling |
| 4 | Data/Control Boundary | Prompt injection risk, tool poisoning, confused deputy |
| 5 | Data Protection | PII handling, encryption, secret logging |
| 6 | Integrity Controls | Signatures, checksums, immutable dependencies |
| 7 | Session/Transport | TLS, token management, session security |
| 8 | Network Isolation | Sandboxing, lateral movement, port exposure |
| 9 | Trust Boundary | LLM judgment reliance, human gates, privilege escalation |
| 10 | Resource Management | Rate limiting, timeouts, memory/CPU bounds |
| 11 | Operational Security | Audit logging, monitoring, alerting |
| 12 | Supply Chain | Dependency tree, known CVEs, maintainer trust, typosquatting |

Produce a finding for EVERY category (even "no issue found").

### Phase 3: Compliance Check (parallel with Phase 2)
- License compatibility (SPDX identifier, OSS-compatible?)
- Data residency (where does data flow? any exfiltration?)
- Regulatory (EU AI Act classification if AI-related)
- IP/Copyright concerns

### Phase 4: Architecture Review
- Data flow: what data enters/exits the tool?
- Trust boundaries: where does this tool sit in the architecture?
- Coupling: how tightly does this bind us to the tool?
- Existing patterns: does this fit how the platform works today?

### Phase 5: Integration Test (sandboxed)
Only if no critical blockers from Phases 2-4:
- Install in isolated environment
- Run smoke tests (basic operations)
- Check for dependency conflicts
- Measure performance baseline
- Verify clean rollback/removal

### Phase 6: Risk Adjudication
Weigh all findings and produce verdict:
- **APPROVE** — no critical/high findings, fits architecture, compliant
- **CONDITIONAL** — acceptable with documented conditions (e.g., sandbox-only, version-pinned)
- **REJECT** — critical unmitigatable risk, or fundamentally misfit

Include: risk level, confidence score, conditions (if conditional), re-evaluation date.

### Phase 7: Human Approval (HITL Gate)
Present complete findings to user for final decision:
- Summary of verdict with rationale
- All findings by category and severity
- Recommended conditions
- Re-evaluation schedule

## Early Termination

STOP the pipeline immediately if:
- Hardcoded credentials with no configuration alternative
- Known unpatched CVE with CVSS >= 9.0
- License incompatible with project (GPL in proprietary context, etc.)
- Tool is abandoned (no commits in 12+ months, unresponsive maintainer)

Present the blocking finding and recommend REJECT.

## Output Format

```markdown
## Tool Evaluation: [tool-name] v[version]

**Verdict:** APPROVE | CONDITIONAL | REJECT
**Risk Level:** low | medium | high | critical
**Confidence:** [0-1]

### Security Findings (CoSAI)
| # | Category | Severity | Finding | Mitigatable? |
|---|----------|----------|---------|-------------|
[one row per category]

### Compliance
- License: [result]
- Data residency: [result]
- Regulatory: [result]

### Architecture Fit
[2-3 sentences]

### Integration Test Results
[if run — install, smoke test, performance, rollback]

### Conditions (if CONDITIONAL)
- [condition 1]
- [condition 2]

### Re-evaluation
- Schedule: [date]
- Triggers: [CVE, behavioral change, version update]
```

## After Evaluation

- If APPROVED/CONDITIONAL: add to approved tools registry
- If REJECTED: document rationale for institutional memory
- In all cases: persist findings for future reference
