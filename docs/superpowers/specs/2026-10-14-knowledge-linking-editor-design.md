---
status: active
---

# Wiki editor: link autocomplete, dangling-link warning and preview (BI-2F7BE778)

Scope manifest for BI-2F7BE778. The design is §3.5 and §7 of the
[knowledge linking design](2026-10-14-knowledge-linking-design.md). The scope
rules R1, R4 and R7 apply. Depends on BI-825D3487 (corpus read grants) and
reuses the shared reader from BI-4EAFF7AC.

## Objectives and acceptance

**OBJ-KLE-1:** An author can link a page while writing, without remembering its slug or leaving the editor.

**OBJ-KLE-2:** Before saving, the author sees broken links and the rendered result, checked by the same rules that lint and the viewer use.

| Acceptance | Objectives | Statement |
|------------|------------|-----------|
| AC-KLE-1 | OBJ-KLE-1 | Typing `[[` and two characters lists up to 8 matching pages the author can read, within 200 ms at the 95th percentile on the dev install. Enter inserts `[[slug\|title]]`. |
| AC-KLE-2 | OBJ-KLE-1 | Suggestions respect scope direction: a profession page is never offered organization pages, and pages the author cannot read are never offered. |
| AC-KLE-3 | OBJ-KLE-2 | A dangling link is flagged before save, using the same resolver as `detectDanglingXrefs`, now moved to a shared module. |
| AC-KLE-4 | OBJ-KLE-2 | The preview renders with `WikiBodyRenderer` and matches the published viewer. The editor works from the keyboard, follows the theme, and its UX-fit review is recorded. |
