// Legacy compatibility shim. Hive Scout is now scheduled canonically through
// the seeded ScheduledAgentTask substrate, not a standalone queue cron.
export async function hiveScoutIngest() {
  const { runHiveScoutIngest } = await import(
    "@/lib/actions/hive-scout/ingest-500-agents"
  );
  return runHiveScoutIngest();
}
