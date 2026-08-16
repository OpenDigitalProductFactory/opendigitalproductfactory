# Populated Performance live acceptance

Use this fixture only after the restaurant demo loader has populated the target owner's current organization. It refuses to write unless the exact storefront belongs to that organization, contains `demo-` bookings, and the named owner currently belongs to the same organization.

```text
pnpm --filter web demo:performance-acceptance -- --owner-email <seeded-owner-email>
```

The command is idempotent. It writes two daily periods for the seven restaurant metrics and one accepted watched-analysis plan. Sales, average check, and labor percentage intentionally remain unavailable because the demo substrate does not provide authoritative inputs.

After a governed deployment, authenticate as the same seeded owner and verify `/performance`:

- the owner brief reports the covers change and keeps evidence limits neutral;
- aggregate freshness reflects the oldest current metric watermark;
- the accepted covers plan is inspectable and the material change carries evidence;
- quiet, clarification/refusal, and stale-source behavior remain available through their existing deterministic contracts;
- another organization's owner cannot read or operate this fixture.

This command is an acceptance-data tool, not a production-data repair path. It has no organization override and must not be run against a real operating tenant.
