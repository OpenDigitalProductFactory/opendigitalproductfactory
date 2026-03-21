// apps/web/app/(shell)/platform/ai/operations/page.tsx
import { getAsyncOperations } from "@/lib/ai-provider-data";
import { AsyncOperationsTable } from "@/components/platform/AsyncOperationsTable";
import { AiTabNav } from "@/components/platform/AiTabNav";

export default async function OperationsPage() {
  const operations = await getAsyncOperations();

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "var(--dpf-text)", margin: 0 }}>
          Async Operations
        </h1>
        <p style={{ fontSize: 11, color: "var(--dpf-muted)", marginTop: 2 }}>
          {operations.length} operation{operations.length !== 1 ? "s" : ""} recorded
        </p>
      </div>

      <AiTabNav />

      <AsyncOperationsTable operations={operations} />
    </div>
  );
}
