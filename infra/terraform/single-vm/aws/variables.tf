# infra/terraform/single-vm/aws/variables.tf
#
# Minimal inputs for a single-VM DPF deployment on AWS.
# All optional variables have safe defaults; required ones are
# deliberately left without defaults so Terraform surfaces them at plan time.
#
# Minimum quick-start (save as terraform.tfvars):
#
#   aws_region         = "us-east-1"
#   subnet_id          = "subnet-xxxxxxxxxxxxxxxxx"
#   dpf_admin_password = "change-me-16-chars-min"
#
# Then: terraform init && terraform apply

# ── AWS / infra ─────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "us-east-1"
}

variable "name_prefix" {
  description = "Prefix applied to every AWS resource name and tag."
  type        = string
  default     = "dpf"
}

variable "instance_type" {
  description = "EC2 instance type. DPF requires at least 4 vCPU / 16 GB RAM. t3.xlarge (4 vCPU / 16 GB) is the tested floor."
  type        = string
  default     = "t3.xlarge"
}

variable "vpc_id" {
  description = "VPC to deploy into. When null the account default VPC is used."
  type        = string
  default     = null
}

variable "subnet_id" {
  description = "Public subnet to place the instance in. Must be in var.vpc_id (or the default VPC when vpc_id is null). The subnet must auto-assign public IPs or associate_public_ip_address must work."
  type        = string
}

variable "key_name" {
  description = "EC2 key pair name for direct SSH access. Optional when enable_ssm = true (SSM Session Manager provides shell access without port 22)."
  type        = string
  default     = null
}

variable "admin_cidr_blocks" {
  description = "CIDR blocks allowed SSH access (port 22). Set to [] to close port 22 entirely and use SSM. Defaults to open — restrict before production use."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "portal_cidr_blocks" {
  description = "CIDR blocks allowed to reach the DPF portal (port 3000). Defaults to open — restrict to your office/VPN CIDR for internal pilots."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "root_volume_size_gb" {
  description = "Root EBS volume size in GiB. Must accommodate the OS, Docker images (~10 GB each), and Docker volumes (Postgres, Neo4j, Qdrant)."
  type        = number
  default     = 50
}

variable "enable_ssm" {
  description = "Attach AmazonSSMManagedInstanceCore so operators can open a shell via AWS Systems Manager without requiring port-22 ingress."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Additional tags merged onto every resource."
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
# Cloud VMs do not run Docker Model Runner (a Docker Desktop feature).
# You must supply an external OpenAI-compatible endpoint.
# Leave blank to configure post-install via SSH + .env + docker compose up.

variable "llm_base_url" {
  description = "OpenAI-compatible base URL for the LLM provider. Example: https://api.openai.com/v1. Required for the AI features to work on a cloud VM."
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
