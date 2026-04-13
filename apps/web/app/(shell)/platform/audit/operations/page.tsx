// apps/web/app/(shell)/platform/audit/operations/page.tsx
import { getAsyncOperations } from "@/lib/ai-provider-data";
import { AsyncOperationsTable } from "@/components/platform/AsyncOperationsTable";

export default async function AuditOperationsPage() {
  const operations = await getAsyncOperations();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Long-running Operations
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {operations.length} operation{operations.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      <AsyncOperationsTable operations={operations} />
    </div>
  );
}
