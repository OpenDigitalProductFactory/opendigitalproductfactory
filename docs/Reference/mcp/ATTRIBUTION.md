# Attribution & Refresh

## Source

These files are unmodified copies from the canonical Model Context Protocol repository.

| Field | Value |
| ----- | ----- |
| **Repo** | [github.com/modelcontextprotocol/modelcontextprotocol](https://github.com/modelcontextprotocol/modelcontextprotocol) |
| **Branch** | `main` |
| **Spec version** | `2025-11-25` |
| **Fetched** | 2026-04-25 |

Files under [spec/](./spec/) come from `docs/specification/2025-11-25/**/*.mdx` in the upstream repo.
Files under [schema/](./schema/) come from `schema/2025-11-25/{schema.json, schema.ts, schema.mdx}`.

## License

The Model Context Protocol is in the middle of a license transition (MIT → Apache-2.0). The upstream [LICENSE](./LICENSE) is preserved verbatim and explains the transition. Specifications and new code are under Apache-2.0; some legacy contributions remain under MIT.

Both licenses are permissive and allow redistribution with attribution. This README + the LICENSE file fulfil that requirement.

## Refresh procedure

When DPF MCP work needs to target a newer spec version (e.g. `2026-XX-XX`):

1. **Bump the version constant.** Pick the new spec version slug.

2. **Check the upstream tree.** Confirm the path layout is still `docs/specification/<version>/**/*.mdx` and `schema/<version>/{schema.json, schema.ts, schema.mdx}`:

   ```sh
   curl -sSL "https://api.github.com/repos/modelcontextprotocol/modelcontextprotocol/git/trees/main?recursive=1" \
     | python -c "import json,sys; [print(e['path']) for e in json.load(sys.stdin)['tree'] if 'specification/<version>/' in e['path'] or 'schema/<version>/' in e['path']]"
   ```

3. **Refetch.** Re-run the download script with the new version slug. The fetch list lives in this repo's git history under the commit that introduced this directory — copy the loop, swap the version, re-run.

4. **Diff against this snapshot.** `git diff` on the new vs old version is the protocol-change review. Read `spec/changelog.mdx` first to see the upstream's own summary.

5. **Audit DPF callers.** For every site in `apps/web/app/api/mcp/**` and any client code, walk the diff and confirm the implementation still complies. Pay particular attention to:

   - Capability negotiation in `initialize`
   - Tool annotations (`readOnlyHint` etc.) — new ones may have shipped
   - Authorization changes (the OAuth model has been moving fast)
   - Transport changes (SSE deprecations, Streamable HTTP additions)

6. **Update the README's `Spec version` and `Fetched` rows**, plus this file's `Spec version` / `Fetched` rows.

7. **Bump the version reference in implementation specs.** Search `docs/superpowers/specs/` for the old version string and update.

8. **Single PR.** "doc(mcp): refresh reference spec to `<new-version>`" — never mix this with implementation changes; the diff has to be readable in isolation.

## Modifications

**None.** Files in `spec/` and `schema/` are byte-identical to upstream at fetch time. Do not edit them. Any DPF-specific notes go in our own design specs (`docs/superpowers/specs/`) or in the README of this directory — never inline in the upstream files.

If a future version of MCP makes a breaking change we need to call out, add a `NOTES.md` at this level documenting our interpretation and any DPF-side mitigation, but leave the upstream files untouched.
