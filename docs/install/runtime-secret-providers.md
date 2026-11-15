# Runtime secret providers

DPF can resolve its portal root secrets immediately before migrations and
application startup. The default remains the existing environment-based setup.
An optional 1Password Connect adapter keeps the same secret values under
external custody and fetches them once per portal start.

This integration changes custody, not authority. 1Password does not replace
DPF's Principal model, authentication policy, authorization, LDAP directory,
Step CA PKI, connector credential store, encryption, or audit receipts.

## Default environment provider

Existing installations need no change. With `DPF_SECRET_PROVIDER` unset or set
to `environment`, the startup boundary requires `AUTH_SECRET` and
`CREDENTIAL_ENCRYPTION_KEY` in the portal environment and passes their exact
values to the existing migration and server command. It makes no network call.

`DPF_RUNTIME_SECRET_NAMES` may select a comma-separated subset of the supported
logical names: `AUTH_SECRET`, `CREDENTIAL_ENCRYPTION_KEY`, and `DATABASE_URL`.
The default selection is the two application root secrets.

## 1Password Connect setup

The operator owns the external account, vault, token, and recovery process.
Agents and DPF do not create, display, or persist those credentials.

1. Operate a private 1Password Connect service using 1Password's supported
   deployment instructions.
2. Create a dedicated vault and one item for this installation. Do not use a
   personal or broadly shared vault.
3. Add item fields whose labels exactly match the selected logical names. For
   the default selection, use `AUTH_SECRET` and `CREDENTIAL_ENCRYPTION_KEY`.
4. Create a token limited to reading that dedicated vault. The adapter never
   lists vaults/items and never writes.
5. Prefer a protected token file mounted read-only into the portal container.
   An inline token is supported only for deployment wrappers without a secret
   file mechanism.
6. Configure the portal environment:

   ```text
   DPF_SECRET_PROVIDER=onepassword-connect
   DPF_ONEPASSWORD_CONNECT_HOST=https://connect.internal
   DPF_ONEPASSWORD_CONNECT_TOKEN_FILE=/run/secrets/dpf-connect-token
   DPF_ONEPASSWORD_VAULT_ID=<dedicated-vault-id>
   DPF_ONEPASSWORD_ITEM_ID=<runtime-secret-item-id>
   DPF_RUNTIME_SECRET_NAMES=AUTH_SECRET,CREDENTIAL_ENCRYPTION_KEY
   DPF_SECRET_PROVIDER_TIMEOUT_MS=5000
   ```

   The token-file path is inside the container. Add a deployment-specific
   read-only secret mount that maps the operator-managed host secret to that
   path for both `portal-init` and `portal`. Do not commit the token or put it
   in the base Compose file.

Supplying both token forms is an error. The host must be an absolute HTTP(S)
URL. The timeout defaults to 5 seconds and cannot exceed 30 seconds.

## Startup and failure behavior

The adapter performs exactly one authenticated item request per bootstrap
process. A full Compose start resolves once before the one-shot migration/init
process and once before the portal process; a portal-only restart resolves once.
Each process extracts only the selected allow-listed fields and overlays them
in its child environment. It does not write resolved values to a file, database,
or log.

Invalid configuration, unavailable Connect, timeout, non-success response,
malformed data, or a missing, duplicate, empty, or non-string field stops the
portal before migrations. Errors contain only a stable category, provider, and
logical field name; they never include token or secret values. A running portal
does not depend on Connect after startup.

There is no silent fallback from `onepassword-connect` to `environment`.

## Recovery and rollback

Restore the Connect service or deliberately return to the environment provider:

1. Place the same logical values into the protected environment mechanism.
2. Set `DPF_SECRET_PROVIDER=environment`.
3. Restart the portal and verify health.

Custody migration is not key rotation. Changing `AUTH_SECRET` invalidates
sessions and signed tokens. Changing `CREDENTIAL_ENCRYPTION_KEY` can make stored
credential ciphertext unreadable until a separately governed key-lifecycle
procedure exists. Rollback therefore restores the same values; it does not
generate replacements.

Revoke a suspected token in 1Password, create a new least-privilege token, and
update only the protected deployment secret. Vendor audit events are custody
evidence; DPF action receipts remain the authority and action record.

## Acceptance boundary

DPF's automated acceptance uses an injected HTTP seam to verify successful
resolution, least-privilege request shape, timeout/refusal behavior, redaction,
and no command execution on failure. A real Connect deployment can only be
verified when an operator supplies and authorizes its external account and
credential configuration; source delivery does not claim that optional live
account acceptance.
