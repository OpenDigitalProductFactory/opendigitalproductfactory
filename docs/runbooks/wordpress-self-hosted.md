# WordPress (self-hosted) connector runbook

This runbook covers the native `wordpress-self-hosted` connector. The operator surface is **Platform > Tools > Native Integrations > WordPress (self-hosted)**.

## Security boundary

- DPF initiates outbound HTTPS only. No inbound WordPress webhook or public DPF URL is required.
- Only HTTPS URLs without embedded credentials, query strings, or fragments are accepted.
- The safe request layer blocks loopback, link-local, private, reserved, and DNS-rebinding targets before every hop.
- Credentials use a dedicated WordPress Application Password in the canonical encrypted connector store.
- Logs, UI state, staging evidence, and publication receipts must never contain the Application Password or Authorization header.

## Healthy connection

A healthy check shows the expected site name and hostname, authenticated WordPress identity, supported posts/pages/media, taxonomies, and effective permissions. `canCreateDrafts` is required for routine publication. `canPublishLive` does not enable public publication by itself.

## Authentication or permission failure

1. In WordPress, confirm the dedicated user still exists and is active.
2. Confirm its role can edit the intended posts or pages and upload media only when needed.
3. Revoke the old Application Password and create a replacement.
4. Open **Connection settings and advanced policy**, replace the connection, and run **Check connection**.
5. Confirm the UI shows no secret value after the form settles.

Do not widen the user to Administrator merely to clear a 403. Add only the missing WordPress capability or use the correct editor role.

## REST API unavailable

Confirm `/wp-json/`, `/wp-json/wp/v2/types?context=edit`, and the authenticated `/wp-json/wp/v2/users/me?context=edit` route are reachable from the DPF host over HTTPS. Check reverse-proxy rules and WordPress security plugins for REST API blocking. Do not bypass TLS validation or the DPF safe-network policy.

## Drift or ambiguous outcome

`drifted` means WordPress changed after the last known projection. `ambiguous` means DPF cannot prove whether a write completed. In either state:

1. Open the existing target from the projection/receipt link when available.
2. Compare it with the approved DPF source and decide which side should win.
3. Do not manually retry by creating another WordPress item.
4. Resolve the remote item or projection binding, then replay the approved source version.

The projection identity is `(connector, connection, source type, source ref, resource kind, locale)`. Replay must update that binding, not invent a new one.

## Disconnect and revoke

Choose **Disconnect WordPress** and confirm. Existing WordPress content is not deleted. Then, in WordPress, open **Users > Profile > Application Passwords** and revoke the password created for DPF. Disconnect stops new reads and writes; revocation removes the remote credential even if a stale encrypted backup exists.

## Evidence to capture

- connector status and last-checked timestamp;
- safe site identity and capability projection;
- affected projection state and external URL, if safe;
- immutable publication receipt and source version;
- exact error code/message with credentials redacted;
- recovery action and time of verification.

Never capture raw credential envelopes, Authorization headers, or full WordPress API responses.
