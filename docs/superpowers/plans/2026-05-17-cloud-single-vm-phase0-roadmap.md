# Cloud Single VM Substrate — Phase 0 Roadmap

> **Status:** Phase 0 deliverables (the install runbook +
> verification path) are on `main`. The substrate is **early-access**
> pending a real-cloud pilot report. This roadmap names what's in
> Phase 0 vs deferred to Phase 1+ so future implementers don't have
> to re-derive scope.

## Phase 0 scope (what "done" means)

End-to-end demo, reproducible by an operator on any major cloud:

```bash
# Provision a VM per docs/install/cloud-single-vm.md
ssh -i ~/.ssh/dpf-pilot.pem ubuntu@<vm-public-ip>

# Prereqs + install
sudo apt-get update && sudo apt-get install -y git curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs && sudo npm install -g pnpm

git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh --headless --release

# Verify
bash scripts/verify-install-edge.sh
# → ~/.dpf/verify-bundle-<timestamp>.tar.gz captured
# → file an install_verification.md issue with the bundle attached
```

When the demo above passes on a real cloud VM, **Outcome 6 (Cloud
substrate pilot)** in the parent thread ledger flips from
`spec-only / not-started` to `Single-VM verified locally`. Container-
service and Managed-k8s substrates remain separate roadmaps.

## What ships in Phase 0

| # | Slice | Where | Status |
|---|-------|-------|--------|
| **B1** | Runbook covering AWS / GCP / Azure provisioning + install + verify | `docs/install/cloud-single-vm.md` | ✅ landed |
| **B2** | Phase 0 roadmap (this doc) | `docs/superpowers/plans/2026-05-17-cloud-single-vm-phase0-roadmap.md` | ✅ landed |
| **B3** | Real-cloud pilot report (operator runs B1, attaches `verify-bundle-*.tar.gz` to an install_verification issue) | GitHub issue | 🙋 **report wanted** |
| **B4** | README + verification-runbook cross-link to B1 | `README.md`, `docs/install/verification-runbook.md` | ✅ landed (in this PR) |

The substrate is mostly-shipped because **Single VM is the Linux
installer running on a cloud VM**, and the Linux installer is already
in production. Phase 0 ships the documentation + verification path
that turns it into a recognized substrate.

## Deferred to Phase 1 (explicit non-goals for Phase 0)

| Slice | Why deferred | Trigger to start |
|-------|--------------|------------------|
| **B5** Terraform module `deploy/terraform/{aws,gcp,azure}/single-vm/` that wraps `install-dpf.sh --headless` via cloud-init | Manual provisioning runbook is enough for early adopters; Terraform is operational sugar. | Two or more real-cloud pilot reports land; operators ask for it. |
| **B6** Managed databases variants (Postgres → RDS / CloudSQL / Azure Database) | Single VM substrate is "compose stack on a VM"; managed DBs are a different substrate (container service). | Customer demand for compose-stack-on-VM + managed Postgres specifically. |
| **B7** HA / multi-AZ Authority Core | Single VM by definition is single-AZ. HA = different substrate (Managed k8s). | Never on this substrate. |
| **B8** PITR backup automation | Snapshots are the operator's responsibility. Automation is a packaging-target concern (TAPPaaS / marketplace image). | Marketplace image starts. |
| **B9** Build Studio in cloud — non-local sandbox provider | Sandboxes run locally on the same VM in Phase 0; that's compose-stack-on-VM behavior. Provider abstraction is the build-execution-provider spec's territory. | Build Studio provider abstraction ships its `kubernetes-job` provider. |
| **B10** TAPPaaS module wrapping Single VM | Separate substrate × packaging-target combination per `cloud-deployment-design.md`. | Single VM has real-cloud reports; TAPPaaS module work starts (Track C in the parent thread). |

## Dependencies

- **Linux installer (`install-dpf.sh`)** — done on `main`. Single VM
  is the Linux installer running on a cloud VM; no Single-VM-specific
  installer changes are needed.
- **Multi-arch GHCR images** — done. Both `linux/amd64` and
  `linux/arm64` ship, so Graviton / Tau-T2A / Azure ARM are first-class.
- **Verification wrapper** — done. `scripts/verify-install-edge.sh`
  works on a cloud VM the same as on a bare-metal box.
- **Edge Node bundled in install (`--no-edge` to skip)** — done.
  The on-VM Edge Node is a demo-quality default; real on-prem
  discovery uses the standalone Edge Node deploy
  (`docker-compose.edge-standalone.yml`).

## Verification gate

A community operator runs the runbook end-to-end on at least one of
AWS / GCP / Azure, captures a `verify-bundle-*.tar.gz`, and files an
`install_verification.md` issue with the bundle attached. The
maintainer flips this row in
[`docs/install/verification-runbook.md`](../../install/verification-runbook.md)
from "reports wanted" to ✅ verified.

A pilot from each of AWS / GCP / Azure is the bar for promoting the
substrate from "Early access" to "GA" in the README.

## Cross-references

- [Cloud deployment design](../specs/2026-05-09-cloud-deployment-design.md) — § Single cloud VM (lift-and-shift) + § Deployment priority
- [Linux install guide](../../install/linux.md) — the substrate this builds on
- [Single VM operator runbook](../../install/cloud-single-vm.md) — B1
- [Verification runbook](../../install/verification-runbook.md) — pilot-report flow
- [Edge Node multi-host runbook](../../install/edge-node-multi-host.md) — standalone-Edge-Node deploy from a customer's network
