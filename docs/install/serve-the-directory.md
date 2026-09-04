# Serving the directory (LDAP)

DPF can be the directory for an installation — most installs have no Active
Directory, and an identity stack that only federates outward leaves them with
nothing. This page is how an operator turns that on.

It is **off by default**. An install does not start serving an identity protocol
because it was upgraded.

Design: [Directory Service — Identity Absorption](../superpowers/specs/2026-08-23-directory-service-identity-absorption-design.md) §9.1.

## What you get

A read-only LDAPS listener that publishes the `Principal` spine as a directory
tree: people, agents, services and groups. Clients bind and search. They cannot
write — add, modify and delete are refused, not merely unimplemented, because
the directory is authoritative for being *derived* from the spine, not for being
a second place to edit identity.

Group membership projects **organizational** structure. It is not an
authorization API, and nothing derives permission from it.

## Prerequisites

**The organization CA must be bootstrapped.** The listener serves LDAPS from the
organization's own PKI and there is no self-signed fallback. If you have not
already set up organization HTTPS:

```bash
bash scripts/bootstrap-organization-pki.sh --mode authority --hostname <your-host-name-or-IP>
```

That writes `authority.crt`, `authority.key` and `root_ca.crt` into
`DPF_PKI_DIR` (default `~/.dpf/pki`) and records the trust settings in `.env`.
The listener reuses that material — the same certificate the portal already
serves HTTPS with — so there is no second certificate to manage or renew.

**An `Organization` must exist.** The directory is the organization's namespace;
the base DN derives from it. A fresh install with no organization has nothing to
publish, and the listener will say so rather than binding an empty tree.

## Turning it on

Add to your install's `.env`:

```bash
DPF_LDAP_ENABLED=1
```

Then apply it through the governed upgrade path — `/ops/self-upgrade` in the
portal. That owns quiescence, recovery points and rollback; do not rebuild the
portal by hand.

Confirm at **Platform → Identity → Directory**. The "Directory listener" card
reads one of three things, and only one of them means clients can bind:

| Card reads | Meaning |
|---|---|
| **Serving LDAPS** | A client can bind right now, on the port shown. |
| **Not served** | `DPF_LDAP_ENABLED` is unset. Nothing is bound. |
| **Failed to start** | It was turned on and could not start. The reason is shown. |

"Failed to start" is deliberately not the same as "Not served". A directory that
was configured and died must not look like one nobody asked for.

## Checking it with a real client

```bash
ldapsearch -H ldaps://127.0.0.1:636 -x -D "uid=<principalId>,ou=people,<baseDn>" -W -b "<baseDn>" "(objectClass=*)"
```

The base DN is shown on the same Directory page. If your client does not already
trust the organization CA, point it at the root:

```bash
LDAPTLS_CACERT=~/.dpf/pki/root_ca.crt ldapsearch -H ldaps://127.0.0.1:636 -x -b "<baseDn>" "(objectClass=*)"
```

## Settings

| Variable | Default | What it does |
|---|---|---|
| `DPF_LDAP_ENABLED` | `0` | Serve the directory at all. |
| `DPF_LDAP_PORT` | `636` | Listen port. 636 is the standard LDAPS port. |
| `DPF_LDAP_BIND_ADDRESS` | `127.0.0.1` | Host interface the port is published on. |
| `DPF_LDAP_REQUIRE_CLIENT_CERTIFICATE` | `0` | Require mTLS. Stronger, but only for clients that can present a certificate. |
| `DPF_LDAP_TLS_CERT_PATH` | `/dpf-state/pki/authority.crt` | Server certificate. |
| `DPF_LDAP_TLS_KEY_PATH` | `/dpf-state/pki/authority.key` | Server key. |
| `DPF_LDAP_TLS_CA_PATH` | `/dpf-state/pki/root_ca.crt` | Org CA, used to verify client certificates. |

### Letting other hosts bind

The port is published on loopback by default, matching the `step-ca` overlay: a
directory other machines can reach is a deliberate choice, not a default. To
serve the LAN, set `DPF_LDAP_BIND_ADDRESS` to one private IP of this host — and
make sure the certificate's SANs actually cover the name clients will use, or
their TLS verification will fail.

### If you moved the PKI directory

The three TLS paths default to `/dpf-state/pki/…`, which resolves because
`DPF_PKI_DIR` defaults to `~/.dpf/pki` and `DPF_STATE_DIR` (`~/.dpf`) is already
mounted read-only into the portal. If you set `DPF_PKI_DIR` somewhere outside
`DPF_STATE_DIR`, set all three paths explicitly to a location the container can
read. The listener refuses to start rather than falling back to a self-signed
certificate, so a wrong path is loud, not silent.

## When it will not start

Every one of these shows on the Directory page as **Failed to start**, with the
reason:

- **Missing PKI material.** The CA was never bootstrapped, or the paths point
  somewhere the container cannot read. Fix the paths or run the bootstrap.
- **No `Organization`.** Nothing to publish, so no base DN can be derived.
- **Port already in use.** Something else holds the port; change
  `DPF_LDAP_PORT` or free it.
- **A malformed `DPF_LDAP_PORT`.** Refused rather than silently replaced by the
  default — serving the directory on a port you did not choose is worse than not
  serving it.

A listener that cannot start does not take the portal down. Everything else
keeps serving, and the failure is reported rather than fatal.

## What this does not do

SAML, OIDC and SCIM are each their own surface and their own decision, and are
deliberately not part of this. LDAP write operations are refused by design.
