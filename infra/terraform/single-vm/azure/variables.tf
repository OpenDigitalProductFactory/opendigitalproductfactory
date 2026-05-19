# infra/terraform/single-vm/azure/variables.tf
#
# Mirrors the structure of infra/terraform/single-vm/{aws,gcp}/variables.tf.
# Minimum quick-start (save as terraform.tfvars):
#
#   subscription_id      = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#   resource_group_name  = "dpf-rg"
#   location             = "eastus"
#   admin_ssh_public_key = "ssh-rsa AAAA..."   # contents of ~/.ssh/id_rsa.pub
#   dpf_admin_password   = "change-me-16-chars-min"

# ── Azure / infra ─────────────────────────────────────────────────────────────

variable "subscription_id" {
  description = "Azure subscription ID. Can also be set via ARM_SUBSCRIPTION_ID environment variable."
  type        = string
  default     = null
}

variable "resource_group_name" {
  description = "Name of the resource group to deploy into. Must already exist — this module does not create it."
  type        = string
}

variable "location" {
  description = "Azure region. Must match the resource group's location. Example: eastus, westeurope, australiaeast."
  type        = string
  default     = "eastus"
}

variable "name_prefix" {
  description = "Prefix applied to every Azure resource name."
  type        = string
  default     = "dpf"
}

variable "vm_size" {
  description = "Azure VM size. DPF requires at least 4 vCPU / 16 GB RAM. Standard_D4s_v5 (4 vCPU / 16 GB) is the tested floor."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "vnet_address_space" {
  description = "Address space for the VNet created by this module. Change if it conflicts with your existing network."
  type        = list(string)
  default     = ["10.0.0.0/16"]
}

variable "subnet_address_prefix" {
  description = "CIDR for the subnet created within the VNet."
  type        = string
  default     = "10.0.1.0/24"
}

variable "admin_source_ranges" {
  description = "CIDR ranges allowed SSH access (port 22). Set to [] to close port 22 — use 'az vm run-command invoke' or Azure Bastion for shell access instead."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "portal_source_ranges" {
  description = "CIDR ranges allowed to reach the DPF portal (port 3000). Defaults to open — restrict to your office/VPN CIDR for internal pilots."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "admin_username" {
  description = "Local administrator username on the VM. Used for SSH and in the ssh_command output."
  type        = string
  default     = "ubuntu"
}

variable "admin_ssh_public_key" {
  description = "SSH public key to authorize for admin_username. Paste the contents of ~/.ssh/id_rsa.pub or similar. Azure Linux VMs require an SSH key."
  type        = string
}

variable "os_disk_size_gb" {
  description = "OS disk size in GiB. Azure encrypts managed disks at rest with platform-managed keys by default."
  type        = number
  default     = 50
}

variable "tags" {
  description = "Tags merged onto all resources."
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
