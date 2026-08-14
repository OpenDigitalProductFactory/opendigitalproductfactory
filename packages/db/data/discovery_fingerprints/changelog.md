# Discovery Fingerprint Catalog Changelog

## 0.2.0 — estate device seed (schemaVersion 2)

- Seeded the operator's estate device identifications as catalog rules
  (`rules/estate-foundational-devices.json`): OUI-vendor → device class →
  Foundational sub-portfolio nodeId, crystallized so re-discovery reproduces
  them with zero SQL. Covers Reolink / Hui-Zhou-Gaoshengda → Security &
  Surveillance; Nest → Climate; Chamberlain → Access; TP-Link Kasa → Lighting
  & Energy; LG / Whirlpool → Connected Appliances; Amazon → Voice; Ubiquiti →
  Network Connectivity; Apple / MSI / Intel / Samsung → Client Compute.
- Rule files may now hold an array of rules, and fixtures may be inlined
  (string path OR inline observation), keeping the device seed compact.
- Day-one scope (spec §3c): rules match on OUI vendor only, the signal captured
  today (ARP + embedded IEEE OUI). Single-vendor multi-class brands (TP-Link
  makes routers AND Kasa plugs; Apple/Samsung make many device types) are
  placed per the operator's observed estate and carry slightly lower
  identityConfidence; the corroborating-signal path (DHCP-55, hostname, the
  layer-1 coworker) disambiguates them once richer capture lands.
- Extended safe coverage for Google clients, Roku, Sonos, Ring, Wyze, Synology,
  and Raspberry Pi. Espressif and LG Innotek remain module-vendor evidence that
  requires corroboration instead of being promoted to finished-product rules.

## Unreleased — schemaVersion 2

- Bumped `schemaVersion` 1 → 2 for the new `ordered_list_prefix` comparator
  (DHCP Option 55 ordered parameter-request-list). Older installs whose engine
  predates this comparator skip rules that use it rather than crash
  (`ruleUsesUnsupportedComparator`; spec §10).
- `resolvedIdentity` may now carry optional `model` and `deviceClass` fields
  (spec §5.3); both are optional, so existing v1 rules remain valid.

## 0.1.0

- Added the initial observability fixture catalog with a safe Prometheus Node Exporter rule.
