# DPF Install Guide — Cloud Single VM

This is the end-user install guide for running **DPF on a single cloud
VM** (AWS EC2 / GCP Compute Engine / Azure VM). It's a lift-and-shift
deployment: the Linux installer runs unchanged inside the VM, all
services run in Docker Compose on that VM, and Edge Nodes on the
customer's premises phone home over outbound HTTPS.

> **Status: Early access — pilot reports wanted.**
>
> The Single VM substrate is the first cloud deployment shape defined
> in the [cloud deployment design](../superpowers/specs/2026-05-09-cloud-deployment-design.md).
> Phase 0 reuses the Linux installer ([`docs/install/linux.md`](linux.md))
> unchanged — only the provisioning step + post-install hardening
> change from a bare-metal Linux box.
>
> The code is on `main` and statically validated; a real cloud pilot
> hasn't been reported yet. **If you have an AWS / GCP / Azure
> account you can spend an hour on, please run through this and
> [file a report](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md).**

For the architectural background:

- [Cloud deployment design](../superpowers/specs/2026-05-09-cloud-deployment-design.md)
  (§ "Single cloud VM (lift-and-shift)")
- [Deployment doctrine](../superpowers/specs/2026-05-09-deployment-contracts.md)
- [Linux install guide](linux.md) — the substrate this builds on

## When to pick Single VM

| You want | Single VM is | Pick Managed k8s / Container service instead if |
|---|---|---|
| Fastest path to a customer-cloud Authority Core | **right call** | you already run k8s and want HA out of the box |
| Minimum operational complexity | **right call** | you have a dedicated SRE team and want managed Postgres + autoscaling |
| Same compose stack you'd run on-prem | **right call** | you need PITR / read replicas / cross-AZ failover for the platform DBs |
| Build Studio working out of the box | **right call** | (Build Studio in cloud is a Phase 1 concern under the build-execution-provider spec) |
| Single point of failure tolerable for v1 | **right call** | you need a multi-AZ Authority Core today |

## Supported environment

| Component | Required |
|-----------|----------|
| Cloud | AWS, GCP, or Azure. Other providers (DigitalOcean, Linode, Hetzner) likely work — they're not yet tested. |
| VM OS | Ubuntu 22.04+ / Debian 12+ / Fedora 39+ (the Linux installer's supported matrix) |
| VM size | **4 vCPU / 16 GB RAM minimum**; 8 vCPU / 32 GB recommended for the local-LLM tier |
| Disk | **100 GB minimum** (Postgres + Neo4j + Qdrant volumes + GHCR images + Ollama models) |
| Architecture | `x86_64` or `arm64` (multi-arch GHCR images cover both) |
| Inbound | Port 443 (or 80 → 443 redirect) to the VM if exposing publicly; Port 3000 for direct/internal access |
| Outbound | Full egress to `ghcr.io`, `registry-1.docker.io`, `objects.githubusercontent.com`, plus any LLM provider endpoints you configure |

## Quick provision

### Option A — Terraform (AWS, GCP, or Azure, recommended)

One-command Terraform modules are available for AWS, GCP, and Azure. They
provision the VM, firewall rules, IAM role/service account, and run the DPF
installer via cloud-init:

**AWS (EC2):**

```bash
cd infra/terraform/single-vm/aws
cp /dev/null terraform.tfvars   # or create from the variables.tf comments

cat > terraform.tfvars << 'EOF'
aws_region         = "us-east-1"
subnet_id          = "subnet-xxxxxxxxxxxxxxxxx"
dpf_admin_password = "change-me-long-enough-16chars"
llm_base_url       = "https://api.openai.com/v1"
llm_model          = "gpt-4o"
embedding_model    = "text-embedding-3-small"
EOF

terraform init && terraform apply
```

After `apply`, watch the cloud-init log:

```bash
aws ssm start-session --target $(terraform output -raw instance_id) \
  --document-name AWS-StartInteractiveCommand \
  --parameters command='tail -f /var/log/dpf-install.log'
```

Typical install time: **8-12 minutes**. Variables reference:
[`infra/terraform/single-vm/aws/variables.tf`](../../infra/terraform/single-vm/aws/variables.tf).

**GCP (Compute Engine):**

```bash
cd infra/terraform/single-vm/gcp

cat > terraform.tfvars << 'EOF'
project_id         = "my-gcp-project"
zone               = "us-central1-a"
subnetwork         = "default"
dpf_admin_password = "change-me-long-enough-16chars"
llm_base_url       = "https://api.openai.com/v1"
llm_model          = "gpt-4o"
embedding_model    = "text-embedding-3-small"
EOF

terraform init && terraform apply
```

After `apply`, watch the cloud-init log via IAP tunnel (no port 22 needed):

```bash
gcloud compute ssh ubuntu@$(terraform output -raw instance_name) \
  --project=my-gcp-project --zone=us-central1-a --tunnel-through-iap \
  --command='tail -f /var/log/dpf-install.log'
```

Typical install time: **8-12 minutes**. Variables reference:
[`infra/terraform/single-vm/gcp/variables.tf`](../../infra/terraform/single-vm/gcp/variables.tf).

**Azure (VM):**

```bash
# Create the resource group first (the module does not create it)
az group create --name dpf-rg --location eastus

cd infra/terraform/single-vm/azure

cat > terraform.tfvars << 'EOF'
resource_group_name  = "dpf-rg"
location             = "eastus"
admin_ssh_public_key = "ssh-rsa AAAA..."   # contents of ~/.ssh/id_rsa.pub
dpf_admin_password   = "change-me-long-enough-16chars"
llm_base_url         = "https://api.openai.com/v1"
llm_model            = "gpt-4o"
embedding_model      = "text-embedding-3-small"
EOF

terraform init && terraform apply
```

After `apply`, watch progress via SSH (if port 22 is open) or Azure Run Command:

```bash
# SSH (requires admin_source_ranges set in tfvars)
ssh ubuntu@$(terraform output -raw public_ip) 'tail -f /var/log/dpf-install.log'

# Or without SSH — Azure Run Command (output buffered, not live):
az vm run-command invoke \
  --resource-group dpf-rg --name dpf-portal \
  --command-id RunShellScript \
  --scripts 'tail -n 50 /var/log/dpf-install.log'
```

Typical install time: **8-12 minutes**. Variables reference:
[`infra/terraform/single-vm/azure/variables.tf`](../../infra/terraform/single-vm/azure/variables.tf).

### Option B — Manual provisioning (other clouds)

The runbook below covers manual VM provisioning for clouds without a
Terraform module (DigitalOcean, Hetzner, Linode, etc.).

### AWS (EC2) — manual

```bash
# Create a key pair if you don't have one
aws ec2 create-key-pair --key-name dpf-pilot \
  --query 'KeyMaterial' --output text > ~/.ssh/dpf-pilot.pem
chmod 600 ~/.ssh/dpf-pilot.pem

# Provision the VM. t3.xlarge = 4 vCPU / 16 GB; m6a.2xlarge = 8 vCPU / 32 GB.
aws ec2 run-instances \
  --image-id $(aws ec2 describe-images \
    --owners 099720109477 \
    --filters 'Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-jammy-22.04-amd64-server-*' \
    --query 'Images | sort_by(@, &CreationDate)[-1].ImageId' --output text) \
  --instance-type t3.xlarge \
  --key-name dpf-pilot \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=100,VolumeType=gp3}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=dpf-pilot}]'

# Security group: 22 inbound from your IP, 3000 inbound from where
# you'll access the portal (or set up a Caddy / nginx reverse proxy
# on 443 — see "Public URL" below).
```

### GCP (Compute Engine)

```bash
gcloud compute instances create dpf-pilot \
  --machine-type=n2-standard-4 \
  --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud \
  --boot-disk-size=100GB --boot-disk-type=pd-ssd \
  --tags=dpf-pilot

# Firewall: allow 3000 (or 443 if you front with Caddy).
gcloud compute firewall-rules create allow-dpf-portal \
  --target-tags=dpf-pilot --source-ranges=YOUR.IP.ADDR/32 \
  --allow=tcp:3000
```

### Azure

```bash
az group create --name dpf-pilot --location eastus
az vm create \
  --resource-group dpf-pilot --name dpf-pilot \
  --image Ubuntu2204 --size Standard_D4s_v5 \
  --os-disk-size-gb 100 \
  --admin-username azureuser --generate-ssh-keys \
  --nsg-rule SSH

# Allow 3000 inbound from your IP.
az vm open-port --resource-group dpf-pilot --name dpf-pilot \
  --port 3000 --priority 1010
```

## Install DPF

SSH into the VM, then run the standard Linux install:

```bash
# Prereqs (the installer assumes you bring these).
sudo apt-get update && sudo apt-get install -y git curl ca-certificates
# Node 20+ via NodeSource:
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm

# Clone + install
git clone https://github.com/OpenDigitalProductFactory/opendigitalproductfactory ~/dpf
cd ~/dpf
bash install-dpf.sh --headless --release
```

That's it — the installer auto-detects Linux, runs the same preflight
+ Docker install + compose-up + autostart flow as a bare-metal Linux
host. The bundled Edge Node container starts alongside the Authority
Core unless you pass `--no-edge`.

After it finishes:

```bash
curl http://localhost:3000/api/health     # should return 200
grep ADMIN_PASSWORD .env                  # initial admin credentials
```

Browse to the VM's public IP (or whatever you configured) on port 3000
and log in with `admin@dpf.local` + the password from `.env`.

## Public URL + TLS

Phase 0 ships **HTTP on port 3000 only**. For a real customer-cloud
deployment you'll want:

1. **DNS** — point a hostname at the VM's public IP.
2. **TLS termination** — Caddy is the lowest-friction option. After
   the install completes, install Caddy on the VM and add a one-line
   reverse-proxy config:
   ```caddyfile
   dpf.example.com {
     reverse_proxy localhost:3000
   }
   ```
   Caddy auto-provisions a Let's Encrypt cert. Open inbound 443 in
   the security group / firewall and close inbound 3000 to the
   public internet.
3. **Public URL env var** — set `PUBLIC_URL=https://dpf.example.com`
   in `.env` and restart the stack (`bash dpf-stop.sh && bash
   dpf-start.sh`). This tells the portal to emit absolute URLs for
   notification emails, webhook payloads, and Edge Node enrollment
   endpoints.

   Setting `PUBLIC_URL` also activates **canonical-host enforcement**:
   any request arriving on a non-matching origin (e.g. the raw VM
   public IP on port 3000) is 301-redirected to `PUBLIC_URL` with a
   `Clear-Site-Data: "storage"` header. This ensures all users share a
   single browser origin, so chat history, session state, and UI
   preferences don't diverge between IP-based and hostname-based access.

   If you need to keep direct LAN/IP access alive after setting a
   canonical domain (e.g. on-prem admin reaching the VM at its private
   IP), use `PUBLIC_URL_ALIASES` to allow-list those origins:

   ```
   PUBLIC_URL_ALIASES=10.0.0.5:3000,dpf.internal
   ```

   Health-probe endpoints (`/api/health`, `/api/healthz`, `/api/ready`)
   are excluded from the redirect so load balancer probes hitting the
   VM directly still succeed.

The cloud-deployment spec covers TLS placement options in detail
([§ Public URL and TLS](../superpowers/specs/2026-05-09-cloud-deployment-design.md#public-url-and-tls)).

## Persistent storage

The Linux installer creates Docker named volumes for Postgres, Neo4j,
Qdrant, and Redis. These live in `/var/lib/docker/volumes/` on the VM.

For a customer-cloud deployment you want those volumes on a separate,
snapshotted disk:

- **AWS:** attach a second EBS volume (gp3, 100 GB+), mount at
  `/var/lib/docker`, run the installer.
- **GCP:** attach a persistent disk, same mount.
- **Azure:** attach a managed disk, same mount.

Snapshot the disk on a schedule you control. The verification runbook
covers a basic backup test
([docs/install/verification-runbook.md](verification-runbook.md)).

## Edge Node story

The bundled Edge Node container (auto-approved at enrollment per spec
§ Approval policy) runs alongside the Authority Core on the VM and
discovers the VM itself + its docker network. That's the demo-quality
default.

For real on-premise discovery, deploy a separate Edge Node container
on the customer's network using
[`docker-compose.edge-standalone.yml`](../../docker-compose.edge-standalone.yml).
Point it at `https://dpf.example.com` via `DPF_AUTHORITY_URL`. It
phones home over outbound HTTPS — no VPC peering or VPN required.

See [edge-node-multi-host.md](edge-node-multi-host.md) for the
standalone Edge Node runbook.

## Verify

The same one-command verification wrapper works on the VM:

```bash
cd ~/dpf
bash scripts/verify-install-edge.sh
```

Output is a tarball at `~/.dpf/verify-bundle-<timestamp>.tar.gz`.
Attach it to an [install verification issue](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md).

## Day-to-day

Same lifecycle commands as bare-metal Linux:

| Task | Command |
|------|---------|
| Stop the stack | `bash dpf-stop.sh` |
| Start the stack | `bash dpf-start.sh` |
| Update images | `git pull && bash dpf-stop.sh && bash dpf-start.sh` |
| Diagnostic bundle | `bash install-dpf.sh doctor` |
| Uninstall (keep data) | `bash uninstall-dpf.sh` |
| Uninstall (wipe data) | `bash uninstall-dpf.sh --purge --yes` |

## What Phase 0 does NOT cover

Out of scope for the Single VM Phase 0 substrate:

- **Terraform (other clouds)** — AWS, GCP, and Azure modules shipped in Phase 0
  (`infra/terraform/single-vm/{aws,gcp,azure}/`). DigitalOcean, Hetzner,
  and Linode are community-contributed follow-ons tracked in BI-22332688.
- **HA / multi-AZ** — single VM by definition. Pick the Managed k8s
  substrate if you need HA today.
- **PITR backups** — disk snapshots are the operator's responsibility.
- **Managed databases** — Phase 0 runs Postgres / Neo4j / Qdrant /
  Redis inside the compose stack on the VM. Managed-DB variants are
  the Managed container service substrate, not Single VM.
- **Build Studio in cloud** — works the same as on-prem on this
  substrate (sandboxes are local Docker containers on the same VM).
  Sandbox-isolation tradeoffs apply per the build-execution-provider
  spec.

See the [Phase 0 roadmap](../superpowers/plans/2026-05-17-cloud-single-vm-phase0-roadmap.md)
for the implementation status of each deferred item.

## Help us graduate this guide to GA

Running this on AWS / GCP / Azure and got it working (or hit a wall)?
File an [install verification report](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/issues/new?template=install_verification.md)
with the cloud + VM size + the wrapper's bundle attached. A handful
of independent reports flips this substrate from "Early access" to
"GA" in the README.
