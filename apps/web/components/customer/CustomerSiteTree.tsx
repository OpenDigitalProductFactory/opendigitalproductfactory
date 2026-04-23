import { NewCustomerSiteNodeButton } from "@/components/customer/NewCustomerSiteNodeButton";

type SiteAddress = {
  addressLine1: string;
  addressLine2?: string | null;
  postalCode: string;
  validationSource?: string | null;
  validatedAt?: Date | string | null;
  city: {
    name: string;
    region: {
      name: string;
      country?: {
        iso2?: string | null;
      } | null;
    };
  };
};

type SiteNode = {
  id: string;
  nodeId: string;
  siteId: string;
  parentNodeId?: string | null;
  name: string;
  nodeType: string;
  status: string;
  notes?: string | null;
};

type Site = {
  id: string;
  siteId: string;
  name: string;
  siteType: string;
  status: string;
  timezone?: string | null;
  accessInstructions?: string | null;
  hoursNotes?: string | null;
  serviceNotes?: string | null;
  primaryAddress?: SiteAddress | null;
  nodes: SiteNode[];
};

function formatAddress(address?: SiteAddress | null) {
  if (!address) {
    return null;
  }

  const locality = `${address.city.name}, ${address.city.region.name} ${address.postalCode}`.trim();
  return [address.addressLine1, address.addressLine2, locality]
    .filter(Boolean)
    .join(", ");
}

function buildNodeTree(nodes: SiteNode[], parentNodeId: string | null = null): SiteNode[] {
  return nodes.filter((node) => (node.parentNodeId ?? null) === parentNodeId);
}

function SiteNodeBranch({
  accountId,
  siteId,
  nodes,
  parentNodeId = null,
}: {
  accountId: string;
  siteId: string;
  nodes: SiteNode[];
  parentNodeId?: string | null;
}) {
  const branch = buildNodeTree(nodes, parentNodeId);
  if (branch.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-2">
      {branch.map((node) => (
        <li key={node.id} className="rounded-md border border-[var(--dpf-border)] bg-[var(--dpf-surface-2)] p-3">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-[var(--dpf-text)]">{node.name}</p>
            <span className="rounded-full bg-[var(--dpf-surface-1)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
              {node.nodeType}
            </span>
          </div>
          {node.notes ? (
            <p className="mt-1 text-[10px] text-[var(--dpf-muted)]">{node.notes}</p>
          ) : null}
          <div className="mt-2">
            <NewCustomerSiteNodeButton
              accountId={accountId}
              siteId={siteId}
              parentNodeId={node.id}
              label="+ Add Child"
            />
          </div>
          <div className="mt-2 pl-4">
            <SiteNodeBranch
              accountId={accountId}
              siteId={siteId}
              nodes={nodes}
              parentNodeId={node.id}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function CustomerSiteTree({
  accountId,
  sites,
}: {
  accountId: string;
  sites: Site[];
}) {
  if (sites.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4">
        <p className="text-sm text-[var(--dpf-muted)]">No customer sites registered yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {sites.map((site) => {
        const address = formatAddress(site.primaryAddress);
        return (
          <section
            key={site.id}
            className="rounded-lg border border-[var(--dpf-border)] bg-[var(--dpf-surface-1)] p-4"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-[var(--dpf-text)]">{site.name}</h3>
              <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                {site.siteType}
              </span>
              <span className="rounded-full bg-[var(--dpf-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--dpf-muted)]">
                {site.status}
              </span>
              {site.timezone ? (
                <span className="text-[10px] text-[var(--dpf-muted)]">{site.timezone}</span>
              ) : null}
            </div>

            {address ? (
              <p className="mt-2 text-xs text-[var(--dpf-text)]">{address}</p>
            ) : (
              <p className="mt-2 text-xs text-[var(--dpf-muted)]">No address assigned.</p>
            )}

            <div className="mt-3 space-y-2">
              {site.accessInstructions ? (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  <span className="font-semibold text-[var(--dpf-text)]">Access:</span>{" "}
                  {site.accessInstructions}
                </p>
              ) : null}
              {site.hoursNotes ? (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  <span className="font-semibold text-[var(--dpf-text)]">Hours:</span>{" "}
                  {site.hoursNotes}
                </p>
              ) : null}
              {site.serviceNotes ? (
                <p className="text-[10px] text-[var(--dpf-muted)]">
                  <span className="font-semibold text-[var(--dpf-text)]">Service:</span>{" "}
                  {site.serviceNotes}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--dpf-muted)]">
                  Sublocations
                </p>
                <NewCustomerSiteNodeButton accountId={accountId} siteId={site.id} />
              </div>
              <SiteNodeBranch accountId={accountId} siteId={site.id} nodes={site.nodes} />
            </div>
          </section>
        );
      })}
    </div>
  );
}
