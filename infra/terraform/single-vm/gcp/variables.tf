# infra/terraform/single-vm/gcp/variables.tf
#
# Mirrors the structure of infra/terraform/single-vm/aws/variables.tf.
# Minimum quick-start (save as terraform.tfvars):
#
#   project_id         = "my-gcp-project"
#   zone               = "us-central1-a"
#   subnetwork         = "projects/my-gcp-project/regions/us-central1/subnetworks/default"
#   dpf_admin_password = "change-me-16-chars-min"

# ── GCP / infra ──────────────────────────────────────────────────────────────

variable "project_id" {
  description = "GCP project ID to deploy into."
  type        = string
}

variable "region" {
  description = "GCP region. Must contain var.zone."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone to place the instance in."
  type        = string
  default     = "us-central1-a"
}

variable "name_prefix" {
  description = "Prefix applied to every GCP resource name."
  type        = string
  default     = "dpf"
}

variable "machine_type" {
  description = "Compute Engine machine type. DPF requires at least 4 vCPU / 16 GB RAM. n2-standard-4 (4 vCPU / 16 GB) is the tested floor."
  type        = string
  default     = "n2-standard-4"
}

variable "subnetwork" {
  description = "Self-link or name of the subnetwork to attach the instance to. Example: 'default' or the full self-link. The subnetwork must be in var.region."
  type        = string
}

variable "admin_source_ranges" {
  description = "CIDR ranges allowed SSH access (port 22) via the firewall rule. Set to [] to close port 22 entirely."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "portal_source_ranges" {
  description = "CIDR ranges allowed to reach the DPF portal (port 3000). Defaults to open — restrict to your office/VPN CIDR for internal pilots."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "root_disk_size_gb" {
  description = "Boot disk size in GiB."
  type        = number
  default     = 50
}

variable "enable_iap" {
  description = "Add the IAP-for-TCP tunnel firewall rule so operators can open a shell via Identity-Aware Proxy without exposing port 22 to the internet."
  type        = bool
  default     = true
}

variable "ssh_public_key" {
  description = "Optional SSH public key to add to the instance metadata (format: 'ubuntu:<ssh-rsa AAAA...>'). When null, use IAP tunnelling or OS Login instead."
  type        = string
  default     = null
  sensitive   = true
}

variable "tags" {
  description = "Additional GCP resource labels merged onto all resources."
  type        = map(string)
  default     = {}
}

# ── DPF installer ────────────────────────────────────────────────────────────

variable "dpf_repo_url" {
  description = "Git repository URL to clone on the VM."
  type        = string
  default     = "https://github.com/OpenDigitalProductFactory/opendigitalproductfactory.git"
}

variable "dpf_branch" {
  description = "Git branch or tag to check out. Pin to a release tag (e.g. v0.42.0) for reproducible deploys."
  type        = string
  default     = "main"
}

variable "dpf_admin_password" {
  description = "Initial password for the admin@dpf.local account. Must be at least 16 characters. No single-quote characters. Stored in Terraform state as sensitive."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.dpf_admin_password) >= 16
    error_message = "dpf_admin_password must be at least 16 characters."
  }

  validation {
    condition     = !strcontains(var.dpf_admin_password, "'")
    error_message = "dpf_admin_password must not contain single-quote characters (shell encoding constraint)."
  }
}

# ── LLM provider ─────────────────────────────────────────────────────────────

variable "llm_base_url" {
  description = "OpenAI-compatible base URL for the LLM provider. Example: https://api.openai.com/v1. Required for AI features to work on a cloud VM."
  type        = string
  default     = ""
}

variable "llm_model" {
  description = "Default chat-completions model name. Example: gpt-4o."
  type        = string
  default     = ""
}

variable "embedding_model" {
  description = "Default embedding model name. Example: text-embedding-3-small."
  type        = string
  default     = ""
}
