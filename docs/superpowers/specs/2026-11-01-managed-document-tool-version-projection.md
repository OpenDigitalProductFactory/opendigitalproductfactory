---
status: active
---

# Managed document tools: return the selected version

Backlog: BI-CAP-3D434086. Workroom: WC-BB3ABC42.

## Problem and evidence

On canonical production7396, loading the repair handoff at version49 returns
915789 characters because the response includes the bodies of every historical
version. The tool response is truncated, so a coworker cannot read the selected
version reliably. Listing its49 versions returns896531 characters, including
their bodies, despite the tool promising version metadata. A one-version control
document loads successfully. Saving the handoff also repeats its complete history.

At main5a0bf6794ed4d1fea2fa128ee199f53fc9604a67,
`apps/web/lib/mcp/packs/document-pack.ts` serializes the full store projection.
`loadManagedDocument` already selects the requested version correctly; the extra
history defeats that selection at the response boundary.

## Existing design and boundary

Reuse the [managed document design](2026-05-12-document-management-capability.md)
and [enforced document permissions](2026-10-14-document-permissions-and-files-design.md).
Postgres remains authoritative. The existing store and human version-history UI
keep their complete data. Existing MCP names, grants, acting-user viewer lookup,
access checks, audit, saved versions and export/rendition paths remain authoritative.

The defect is in the MCP projection, so the repair belongs in the existing tool
pack. It does not change store queries or the shared store's return contract.

## Intended behavior

- Document results emitted by this pack contain document metadata and the selected
  `currentVersion`, without the full `versions` collection. Read another body by
  calling `doc_load` with its version number.
- `doc_version_list` returns existing version metadata without `contentText`.
- Selected text is exact and is not silently shortened. Historical text no longer
  multiplies the selected read, save confirmation, search or state-change response.
- Selected-version identity, renditions, export version and not-found behavior
  remain unchanged. Projection does not mutate the store result.

## Acceptance and verification

1. An actual failing regression demonstrates that large old bodies overwhelm a
   small selected-version result before the repair, and are absent afterward.
2. Current and pinned reads preserve the exact selected body and version. The
   existing export tests still bind the file to that version.
3. Version listings preserve identifiers, titles, hashes and dates without bodies.
4. Save, search and state-change results use the same document projection.
5. Existing acting-user isolation and unreadable-document tests continue to pass.
6. Run all graph-linked and colocated pack tests, both web typechecks and the
   normal canonical gate; obtain an independent assessment before publication.
7. After governed deployment, load DOC-C108E048 at a known version through DPF and
   verify that its selected content is readable without a truncated history.

This is one backend tool-contract repair. No UI controls, schema, migration,
permission, provider, converter configuration or customer action is introduced.
It does not solve arbitrarily large selected bodies or add history pagination.
Deployment and the final DPF read are separate from source qualification.
