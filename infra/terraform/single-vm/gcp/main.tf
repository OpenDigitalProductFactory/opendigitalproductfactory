# infra/terraform/single-vm/gcp/main.tf
#
# Provisions a single Ubuntu 24.04 Compute Engine instance and runs
# install-dpf.sh via cloud-init metadata. Mirrors the structure of
# infra/terraform/single-vm/aws/main.tf.
#
# GCP-specific notes vs the AWS module:
#   - Firewall rules are VPC-scoped (not instance-scoped) and use network
#     tags to target the instance.
#   - IAP-for-TCP replaces SSM: `gcloud compute ssh` tunnels through the
#     Identity-Aware Proxy without exposing port 22 to the internet.
#   - Cloud-init is delivered via the `user-data` metadata key (same content
#     as the AWS module; GCP's guest agent processes it on first boot).
#   - OS Login is NOT enabled — the module uses legacy metadata SSH keys
#     (var.ssh_public_key) or IAP tunnelling instead, for simplicity.
#   - The instance is given a service account with no additional IAM roles.
#     Compute Engine's default SA has broad project-editor rights; this
#     module creates a minimal SA instead.

# ── Service account (minimal — no project-editor rights) ─────────────────────

resource "google_service_account" "dpf" {
  account_id   = "${var.name_prefix}-vm"
  display_name = "DPF single-VM instance service account"
  project      = var.project_id
}

# ── Firewall: IAP tunnel (port 22 via Google's 35.235.240.0/20) ───────────────
# This lets `gcloud compute ssh` work without opening port 22 to 0.0.0.0/0.

resource "google_compute_firewall" "iap_ssh" {
  count   = var.enable_iap ? 1 : 0
  name    = "${var.name_prefix}-allow-iap-ssh"
  network = "default"
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  # IAP's published IP range — https://cloud.google.com/iap/docs/using-tcp-forwarding
  source_ranges = ["35.235.240.0/20"]
  target_tags   = ["${var.name_prefix}-portal"]

  description = "Allow IAP-for-TCP SSH to DPF instance (no public port 22 needed)"
}

# ── Firewall: direct SSH (optional) ──────────────────────────────────────────

resource "google_compute_firewall" "ssh" {
  count   = length(var.admin_source_ranges) > 0 ? 1 : 0
  name    = "${var.name_prefix}-allow-ssh"
  network = "default"
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["22"]
  }

  source_ranges = var.admin_source_ranges
  target_tags   = ["${var.name_prefix}-portal"]
}

# ── Firewall: DPF portal ──────────────────────────────────────────────────────

resource "google_compute_firewall" "portal" {
  name    = "${var.name_prefix}-allow-portal"
  network = "default"
  project = var.project_id

  allow {
    protocol = "tcp"
    ports    = ["3000"]
  }

  source_ranges = var.portal_source_ranges
  target_tags   = ["${var.name_prefix}-portal"]
}

# ── Cloud-init metadata ───────────────────────────────────────────────────────

locals {
  user_data = templatefile("${path.module}/user-data/install.sh", {
    dpf_repo_url           = var.dpf_repo_url
    dpf_branch             = var.dpf_branch
    dpf_admin_password_b64 = base64encode(var.dpf_admin_password)
    llm_base_url           = var.llm_base_url
    llm_model              = var.llm_model
    embedding_model        = var.embedding_model
  })

  # GCP instance labels must be lowercase letters, numbers, or hyphens.
  base_labels = { managed-by = "terraform", component = "dpf-portal" }
  labels      = merge(local.base_labels, var.tags)

  # SSH key metadata entry (optional).
  ssh_metadata = var.ssh_public_key != null ? { "ssh-keys" = var.ssh_public_key } : {}
}

# ── Compute Engine instance ───────────────────────────────────────────────────

resource "google_compute_instance" "dpf" {
  name         = "${var.name_prefix}-portal"
  machine_type = var.machine_type
  zone         = var.zone
  project      = var.project_id

  tags   = ["${var.name_prefix}-portal"]
  labels = local.labels

  boot_disk {
    initialize_params {
      # Ubuntu 24.04 LTS (noble) — official Canonical image family.
      image = "ubuntu-os-cloud/ubuntu-2404-lts-amd64"
      size  = var.root_disk_size_gb
      type  = "pd-ssd"
    }
    # Boot disk is deleted with the instance (matches AWS delete_on_termination).
    auto_delete = true
  }

  network_interface {
    subnetwork = var.subnetwork

    # Ephemeral public IP — required to reach GHCR, npm, and LLM endpoints.
    access_config {}
  }

  metadata = merge(local.ssh_metadata, {
    # GCP's guest agent processes the "user-data" key as cloud-init on Ubuntu.
    "user-data" = local.user_data

    # Disable OS Login so legacy SSH keys + IAP tunnelling work without
    # project-level OS Login IAM bindings.
    "enable-oslogin" = "FALSE"
  })

  service_account {
    email  = google_service_account.dpf.email
    # No OAuth scopes needed — the VM pulls images from GHCR (not GCR)
    # and doesn't call GCP APIs at runtime.
    scopes = ["https://www.googleapis.com/auth/cloud-platform"]
  }

  # Shielded VM — enabled by default on n2 machine types.
  shielded_instance_config {
    enable_secure_boot          = true
    enable_vtpm                 = true
    enable_integrity_monitoring = true
  }

  lifecycle {
    # Prevent replacement on image family resolution changes.
    # To replace: terraform apply -replace=google_compute_instance.dpf
    ignore_changes = [boot_disk[0].initialize_params[0].image, metadata["user-data"]]
  }
}
