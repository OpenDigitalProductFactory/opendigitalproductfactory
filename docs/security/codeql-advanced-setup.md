# CodeQL Advanced Setup + Sanitiser Model Pack

This directory holds the **advanced-setup** CodeQL configuration plus a custom
**data-extensions model pack** (`.github/codeql/dpf-sanitizers/`) that declares
DPF's security helpers as sanitisers.

> **Important — the model pack does NOT take effect in GitHub code scanning.**
> It is usable only from the local CodeQL CLI. JS/TS false positives in code
> scanning are handled by **dismissal with justification** (see below). The
> earlier revision of this doc claimed the pack would suppress alerts after a
> repo-settings toggle — that was wrong; the two walls below explain why.

## Why the pack exists

DPF's security helpers — `assertSafeOutboundUrl`, `assertAllowedBinary`,
`assertAllowedPublicUrl`, `sanitizeForLog`, `prepareMediaBlobContentForStorage`,
`isSafeKey`/`assertSafeKey` — are correct sanitisers. They validate scheme,
private-network membership, binary allowlists, strip CR/LF/control characters,
enforce media type + size, and so on. CodeQL's default ruleset doesn't know them
by name, so every caller looks like a tainted-flow vulnerability (CWE-117
log injection, CWE-918 SSRF, CWE-78 command injection, CWE-434/912 file upload,
prototype pollution).

The data-extension rows in `dpf-sanitizers.model.yml` tell CodeQL "this function
takes a tainted value and returns a sanitised one." This works when you run the
CodeQL **CLI** locally. It does **not** work in GitHub code scanning.

## Why it can't load in code scanning (two independent walls)

1. **`packs:` only accepts published packs.** The code-scanning config key
   `packs:` resolves `scope/name[@version]` references from the registry. A
   repository-local path such as `./.github/codeql/dpf-sanitizers` is rejected
   at scan time and silently ignored. The `Analyze (javascript-typescript)` job
   log shows:

   ```
   WARNING: Invalid CodeQL pack specification: './.github/codeql/dpf-sanitizers'. Ignoring.
   ```

2. **JS/TS model packs are unsupported in code scanning.** Even a *published*
   model pack would not help: GitHub code scanning honours data-extension model
   packs only for **C/C++, C#, Java/Kotlin, Python, Ruby, and Rust**.
   JavaScript/TypeScript is excluded.
   See [Workflow configuration options for code scanning](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options).

Because every DPF helper targets `codeql/javascript-all`, the pack is inert in
code scanning regardless of how it is referenced.

## What's here

| File | Purpose |
|---|---|
| `.github/workflows/codeql.yml` | Advanced-setup workflow (security-extended suite, per-language build modes, weekly re-scan) |
| `.github/codeql/codeql-config.yml` | Top-level config; query suite only (no `packs:` — see the note inside) |
| `.github/codeql/dpf-sanitizers/qlpack.yml` | Model pack manifest (local CLI use only) |
| `.github/codeql/dpf-sanitizers/dpf-sanitizers.model.yml` | Sanitiser declarations (local CLI use only) |

## How JS/TS false positives are actually dispositioned

Dismissal with justification in the **Security → Code scanning** tab (or via the
REST API), citing the in-code sanitiser. This is GitHub's documented disposition
for a confirmed false positive, and it is the established DPF pattern — e.g.
alerts #255/#256 (`js/log-injection`, cited `sanitizeForLog`) and #273
(`js/http-to-file-access`) were dismissed this way.

Dismissals are durable: a re-scan that re-detects the same alert keeps the
dismissal. A genuinely new call site produces a new alert, which is the desired
signal — review it, and if it routes the tainted value through the right helper,
dismiss it the same way.

When dismissing, use a precise reason, e.g.:

> False positive. The value is wrapped in `sanitizeForLog(...)`
> (`apps/web/lib/security/safe-log.ts`), which strips C0 control characters
> (U+0000–U+001F) and DEL (U+007F) — including CR/LF — so it cannot forge a
> downstream log line (CWE-117).

## Using the pack locally (where it DOES work)

```bash
codeql database create db --language=javascript-typescript --source-root .
codeql database analyze db \
  --additional-packs .github/codeql/dpf-sanitizers \
  --model-packs dpf/sanitizers \
  --format=sarif-latest --output=results.sarif \
  codeql/javascript-queries
```

Here the data extensions are applied and the sanitiser declarations break taint
flow, so the helpers' callers do not appear as false positives.

## Adding a new sanitiser

1. Add the helper as usual (`apps/web/lib/security/safe-X.ts` + tests).
2. Add an entry to `dpf-sanitizers.model.yml` (helps local CLI runs and documents
   intent):
   ```yaml
   - addsTo:
       pack: codeql/javascript-all
       extensible: summaryModel
     data:
       - ["safe-X", "Module", "Member[assertSafeX]", "Argument[0]", "ReturnValue", "taint", "manual"]
   ```
3. In code scanning, the helper's callers will still be flagged. Dismiss each
   with a justification as above until GitHub adds JS/TS model-pack support to
   code scanning.

## Reference

- Workflow configuration options (model-pack language support):
  https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options
- Customizing library models for JavaScript (CLI):
  https://docs.github.com/en/code-security/codeql-cli/using-the-advanced-functionality-of-the-codeql-cli/customizing-library-models-for-javascript
- Kernel principle that motivates the helpers:
  `docs/founder-kernel/wiki/principles/security-fix-needs-regression-test-first.md`
