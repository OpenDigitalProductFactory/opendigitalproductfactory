# Stable origin for a co-located host-upkeep agent

Backlog: BI-7EE97802. Workroom: WC-C41B707A.

## Problem and evidence

On served `3aa5e9e62fef644ced49d071e952995626c91ff5`, an enrolled Mac host-upkeep
agent remains running under launchd but cannot heartbeat after the host moves to
another network. Its saved API origin contains the former self-LAN address.
The existing local canonical HTTPS origin remains healthy. These observations
establish a stale self-address failure; they do not establish credential expiry,
revocation, a stopped process, or the state of another installation.

The macOS native installer chooses a LAN address and saves it as
`DPF_AUTHORITY_URL`. Windows has the same default selection. Linux already has
a loopback fallback, but still accepts the LAN-advertisement setting as the API
origin. The host-upkeep-only role does not advertise discovery, so its API
endpoint need not depend on a LAN address.

## Existing contract and alternatives

Extend the heartbeat and HTTPS transport contract in
`2026-05-09-dpf-edge-node-design.md` and the existing native host-upkeep carrier
BI-28EFE18A. That carrier's broader platform acceptance remains separate. The
new item covers an observed installer-address defect, not an alternate write
route for a foreign backlog mirror or a denied Workroom.

Reinstalling with a fresh credential would conceal the address defect. Updating
the saved address on every network change would keep recovery dependent on a
client. Select the configured canonical installation origin for the co-located
host-upkeep role instead. Keep full Edge and explicitly supplied remote authority
behavior intact. No new executor, table, capability, provider or authority is
introduced.

## Objective and acceptance

**OBJ-UPKEEP-STABLE-ORIGIN:** A co-located host-upkeep agent uses its installation's
configured stable API origin, independently of the host's incidental LAN address.

- **AC-UPKEEP-CANONICAL:** For host-upkeep, a configured canonical `PUBLIC_URL`
  is persisted as the API authority on macOS, Linux and Windows.
- **AC-UPKEEP-MOBILITY:** Changing the detected LAN address does not change that
  host-upkeep API endpoint. Tests use isolated fixtures, never host mutation.
- **AC-UPKEEP-EXPLICIT:** An explicit authority parameter or existing explicit
  API-origin selection retains its documented precedence. Full Edge discovery
  keeps its LAN authority selection and warnings.
- **AC-UPKEEP-COMPATIBILITY:** Without a canonical origin, host-upkeep uses the
  existing local loopback API fallback; no HTTPS origin is invented or claimed
  trusted. Invalid configured origins fail before replacing the supervised
  service rather than silently sending its credential elsewhere.
- **AC-UPKEEP-IDENTITY:** The normal installer/update path retains enrollment,
  trust state, credentials, signed action endpoints and action allowlists.
- **AC-UPKEEP-LIVE:** After protected delivery and supported host convergence,
  the same canonical node records a fresh successful heartbeat. Native Windows
  and Linux host acceptance must be labelled unrun until actually exercised.

## Authority, compatibility and rollback

Only endpoint selection changes. Certificate and hostname validation stay on.
Do not read or print credential values, mint enrollment tokens, change machine
membership, enable discovery, activate inference or restart the Docker VM.
Retain the installer's staged binary and configuration rollback. A service-start
failure stays a failure; it cannot become a successful heartbeat receipt.

Use the existing canonical-origin configuration and environment readers rather
than a second origin registry. An operator-supplied origin remains that
operator's network contract; this repair does not promise it stays reachable on
every network. No schema or data migration is needed.

## Delivery and evidence boundary

The implementation plan is
`../plans/2026-11-11-native-host-upkeep-stable-origin.md`. Source-local script
fixtures precede implementation, followed by applicable gates and independent
review, a signed protected PR, canonical delivery and measured convergence.
Current worktree readiness is source-only until the managed probe proves more.
The initial source diagnosis changed no running service. A subsequent explicitly
authorized configuration qualification changed only the existing native
service's saved authority to the verified canonical HTTPS origin and used its
normal graceful restart. The same trusted node then recorded a fresh heartbeat;
the pinned binary, controller, enrollment and all other configuration bytes were
preserved. This proves the configuration path, not the default installer repair.
The standalone remote-node preflight still reports its generic loopback warning;
that check is recorded as failed, not as a passing co-located qualification.
