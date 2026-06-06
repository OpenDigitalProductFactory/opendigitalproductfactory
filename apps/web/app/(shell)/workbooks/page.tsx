import Link from "next/link";
import { redirect } from "next/navigation";
import { Table2, Database } from "lucide-react";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { listWorkbooks } from "@/lib/workbooks/workbook-service";
import { listPlatformTablesForUser } from "@/lib/workbooks/platform-tables";
import { LocalTime } from "@/components/ui/LocalTime";
import { CreateWorkbookButton } from "@/components/workbooks/CreateWorkbookButton";

export const dynamic = "force-dynamic";

export default async function WorkbooksHubPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_workbooks")) {
    redirect("/workspace");
  }

  const workbooks = await listWorkbooks({ id: user.id, isSuperuser: user.isSuperuser });
  const platformTables = listPlatformTablesForUser({
    id: user.id,
    platformRole: user.platformRole,
    isSuperuser: user.isSuperuser,
  });
  const canManage = can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_workbooks",
  );

  return (
    <div className="mx-auto w-full max-w-5xl p-6">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">Workbooks</h1>
          <p className="text-sm text-[var(--dpf-muted)]">
            Spreadsheet-style grids for your own tables. Create custom fields, edit inline, sort and filter.
          </p>
        </div>
        {canManage && <CreateWorkbookButton />}
      </div>

      {workbooks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] p-12 text-center">
          <Table2 className="mx-auto mb-3 h-8 w-8 text-[var(--dpf-muted)]" />
          <p className="text-[var(--dpf-text)]">No workbooks yet.</p>
          <p className="text-sm text-[var(--dpf-muted)]">
            {canManage
              ? "Create your first workbook to start working in a grid."
              : "Ask a colleague to share a workbook with you."}
          </p>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {workbooks.map((wb) => (
            <li key={wb.workbookId}>
              <Link
                href={`/workbooks/${wb.workbookId}`}
                className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition hover:bg-[var(--dpf-surface-2)]"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-[var(--dpf-text)]">{wb.name}</span>
                  <span className="rounded-full border border-[var(--dpf-border)] px-2 py-0.5 text-xs text-[var(--dpf-muted)]">
                    {wb.role}
                  </span>
                </div>
                {wb.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--dpf-muted)]">{wb.description}</p>
                )}
                <p className="mt-3 text-xs text-[var(--dpf-muted)]">
                  {wb.tableCount} {wb.tableCount === 1 ? "table" : "tables"} · updated{" "}
                  <LocalTime value={wb.updatedAt} />
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {platformTables.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-1 text-lg font-semibold text-[var(--dpf-text)]">Platform data</h2>
          <p className="mb-3 text-sm text-[var(--dpf-muted)]">
            Existing platform records, opened as live spreadsheets. Edits here are the same data as the forms.
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {platformTables.map((t) => (
              <li key={t.entityType}>
                <Link
                  href={`/workbooks/system/${t.entityType}`}
                  className="block rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4 transition hover:bg-[var(--dpf-surface-2)]"
                >
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-[var(--dpf-muted)]" />
                    <span className="font-medium text-[var(--dpf-text)]">{t.label}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--dpf-muted)]">{t.description}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
