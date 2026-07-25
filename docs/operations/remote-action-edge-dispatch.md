# Machine-bound Edge action dispatch

DPF can ask an enrolled native Edge Node to run the read-only
`inventory.collect` action. The Edge Node still initiates every network
connection; the portal never opens an inbound management port on the host.

This channel is deliberately off by default. It is the machine-trust foundation
for guided organization joining, not a general remote shell.

## What the organization PKI bootstrap configures

Running the existing organization authority or join workflow now creates the
complete action trust bundle when the `DPF_ORGANIZATION_JOIN_V2` contract is
used:

- an organization-rooted client certificate whose only extended key usage is
  TLS client authentication;
- a private key generated into the native host's protected PKI directory;
- an encrypted Ed25519 authority signing key and the public key installed on
  the Edge host;
- a private Caddy-to-portal assertion secret;
- a dedicated Caddy listener on port `8443` that requires and verifies the
  client certificate before forwarding an Edge action route; and
- the `docker-compose.edge-actions.yml` lifecycle overlay, persisted so normal
  install start and repair paths do not silently lose the trust material.

The organization root remains the one trust authority. The bootstrap adds a
restricted `dpf-edge-client` provisioner/profile; it does not create another
root or distribute the root private key.

The action capability is advertised only when the URL, root, client
certificate, client private key, and signing public key are all present. A
partial bundle fails closed.

## Enabling the pilot

The bootstrap records that the trust bundle is configured, but it does not turn
execution on. `DPF_REMOTE_ACTION_DISPATCH_ENABLED=1` is the separate rollout
switch. In addition, the specific Edge Node must be trusted, its
`action.execute` capability must be enabled, and its scope policy must allow
`inventory.collect`.

All of those conditions are checked again when an action is claimed. Enabling
the environment switch alone grants no execution authority.

## Request and evidence flow

1. The native Edge Node connects to the dedicated HTTPS action URL using its
   client certificate and existing scoped bearer credential.
2. Caddy verifies the organization chain, removes caller-supplied identity
   headers, and injects the verified fingerprint, serial, and certificate.
3. The portal binds that certificate to the bearer-authenticated Edge Node and
   rechecks node trust, certificate lifecycle, capability, site/account scope,
   action type, and risk class.
4. The portal signs a short-lived, node-bound, single-use envelope.
5. The Edge Node verifies the signature, node, expiry, parameters digest, and
   durable replay journal before invoking the existing inventory collector.
6. It reports `running` before execution and then reports a sanitized terminal
   result. The portal accepts a result only from the node that claimed the
   action.

There is no script text, command line, executable path, or arbitrary parameter
surface in this pilot.

## Renewal, quarantine, and revocation

Re-running the organization PKI workflow renews the client certificate without
replacing the organization root. Registering the renewed certificate
atomically marks the prior active certificate `superseded`.

Use **Platform → Edge Nodes** for trust lifecycle decisions:

- **Quarantine** immediately makes the node and its active certificates
  ineligible. Restoring trust reactivates only unexpired quarantined
  certificates.
- **Revoke** clears the bearer credential and revokes every certificate bound
  to the node. Re-enrollment is required; approval cannot revive a revoked
  node.

An expired, unknown, superseded, quarantined, revoked, wrong-node, or
serial-mismatched certificate is rejected even when its organization chain is
cryptographically valid.

## Operational checks

Before enabling the pilot, confirm that:

- the native Edge service reports action dispatch configured;
- the authority hostname used in `DPF_EDGE_ACTION_URL` resolves from the Edge
  host and TCP `8443` is permitted on the private network;
- the Edge Node is trusted and `action.execute` is enabled only for the intended
  pilot node;
- `inventory.collect` is the only allowed action type; and
- quarantine and revocation are exercised before treating the channel as
  operational.

Keep the rollout switch off if any trust file is missing or if the certificate
cannot be renewed. Normal backlog, federation, and inventory operation remain
available while the action channel is off.
