# Discovery Fingerprint Catalog Changelog

## Unreleased — schemaVersion 2

- Bumped `schemaVersion` 1 → 2 for the new `ordered_list_prefix` comparator
  (DHCP Option 55 ordered parameter-request-list). Older installs whose engine
  predates this comparator skip rules that use it rather than crash
  (`ruleUsesUnsupportedComparator`; spec §10).
- `resolvedIdentity` may now carry optional `model` and `deviceClass` fields
  (spec §5.3); both are optional, so existing v1 rules remain valid.

## 0.1.0

- Added the initial observability fixture catalog with a safe Prometheus Node Exporter rule.
