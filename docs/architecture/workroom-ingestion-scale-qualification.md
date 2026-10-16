# Workroom ingestion scale qualification

The existing CI workflow can run the opt-in PostgreSQL data-path qualification
on its own fresh service database. It does not connect to an installed or shared
database and does not need a local preview server, local lease or service credential.

After the source is committed, independently assessed and published normally,
dispatch `.github/workflows/ci.yml` on that exact branch with the boolean input
`workroom_ingestion_scale=true`. Omit the input for ordinary CI. Only web shard 1
runs the extra qualification, after normal Prisma generation and migration deployment.
The explicit ingestion URL is the job's own PostgreSQL service URL.

The test seeds 10,000 inert rooms and 100,000 activities, including a busy room,
and exercises the real SQL reader and Prisma cursor/output transaction adapter.
It checks 200-event pages, 1,000-event cycles, sparse turns, persisted output row
identity, rollback, store reconstruction, exact replay and late arrivals. The
experimental test deadline is 30 minutes; the CI step ends after 35 minutes.
One Vitest worker and a 4 GiB Node heap bound this qualification process.

Download `workroom-ingestion-scale-<run-id>-<attempt>` from the dispatched run.
It retains the source SHA/tree and declared bounds, the Vitest JSON report and
the full process log. A skipped PostgreSQL case, missing result or failed test
cannot qualify scale even if the pure output-auditor tests pass. A failed command
fails the job; artifact retention does not convert it to a passing result.

Successful tests remove only their own inert fixture records after checking for
executor bindings. Failed or uncertain tests preserve their fixture identifiers
in the log; the job-owned service is destroyed when the job ends. The retained
log and report are the evidence after that ephemeral database is gone.

This is cloud-owned data-path qualification, not native scheduler, native host
lease, independent executor/reviewer replacement, tenant authorization or served
feature acceptance. The 30-minute experimental workload deadline also does not
establish the production analyzer's candidate or analysis budgets. Those cases
retain their separate acceptance protocols and evidence.
