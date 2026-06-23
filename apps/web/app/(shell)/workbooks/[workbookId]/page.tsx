import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  getWorkbook,
  getTableGridData,
  WorkbookError,
  type ServiceUser,
} from "@/lib/workbooks/workbook-service";
import { WorkbookGrid } from "@/components/workbooks/Grid";
import { CreateTableButton } from "@/components/workbooks/CreateTableButton";
import { AddColumnButton } from "@/components/workbooks/AddColumnButton";
import { ImportSheetButton } from "@/components/workbooks/ImportSheetButton";
import { CreateEmployeesButton } from "@/components/workbooks/CreateEmployeesButton";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workbookId: string }>;
  searchParams: Promise<{ table?: string }>;
};

export default async function WorkbookDetailPage({ params, searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const user = session.user;
  if (!can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_workbooks")) {
    redirect("/workspace");
  }

  const { workbookId } = await params;
  const { table: tableParam } = await searchParams;
  const svcUser: ServiceUser = { id: user.id, isSuperuser: user.isSuperuser };

  let workbook;
  try {
    workbook = await getWorkbook(svcUser, workbookId);
  } catch (e) {
    if (e instanceof WorkbookError && e.status === 404) notFound();
    throw e;
  }

  const activeTableId =
    tableParam && workbook.tables.some((t) => t.tableId === tableParam)
      ? tableParam
      : workbook.tables[0]?.tableId;

  const canManage = can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_workbooks",
  );

  const grid = activeTableId ? await getTableGridData(svcUser, activeTableId) : null;

  return (
    <div className="mx-auto flex h-full w-full max-w-6xl flex-col p-6">
      <Link
        href="/workbooks"
        className="mb-2 inline-flex items-center gap-1 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
      >
        <ChevronLeft className="h-4 w-4" /> Workbooks
      </Link>

      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--dpf-text)]">{workbook.name}</h1>
          {workbook.description && (
            <p className="text-sm text-[var(--dpf-muted)]">{workbook.description}</p>
          )}
        </div>
      </div>

      {/* Table tabs */}
      <div className="mb-4 flex flex-wrap items-center gap-2 border-b border-[var(--dpf-border)] pb-2">
        {workbook.tables.map((t) => {
          const active = t.tableId === activeTableId;
          return (
            <Link
              key={t.tableId}
              href={`/workbooks/${workbookId}?table=${t.tableId}`}
              className={
                active
                  ? "rounded-md bg-[var(--dpf-surface-2)] px-3 py-1.5 text-sm font-medium text-[var(--dpf-text)]"
                  : "rounded-md px-3 py-1.5 text-sm text-[var(--dpf-muted)] hover:text-[var(--dpf-text)]"
              }
            >
              {t.name}
            </Link>
          );
        })}
        {canManage && <CreateTableButton workbookId={workbookId} />}
        {canManage && <ImportSheetButton workbookId={workbookId} />}
      </div>

      {!grid ? (
        <div className="rounded-lg border border-dashed border-[var(--dpf-border)] p-12 text-center text-[var(--dpf-muted)]">
          {canManage
            ? "No tables yet. Create a table to start building your grid."
            : "This workbook has no tables yet."}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {canManage && activeTableId && (
            <div className="flex flex-wrap items-center gap-2">
              <AddColumnButton
                workbookId={workbookId}
                tableId={activeTableId}
                columns={grid.schema.columns}
              />
              {grid.schema.dataSource === "custom" && (
                <CreateEmployeesButton tableId={activeTableId} />
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <WorkbookGrid
              tableId={activeTableId!}
              columns={grid.schema.columns}
              rows={grid.rows}
              capabilities={grid.schema.capabilities}
            />
          </div>
        </div>
      )}
    </div>
  );
}
