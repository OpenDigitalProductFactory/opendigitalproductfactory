# infra/terraform/single-vm/aws/main.tf
#
# Provisions a single Ubuntu 24.04 EC2 instance and runs install-dpf.sh
# via cloud-init. The installer pulls pre-built GHCR images (--release flag)
# and starts the full DPF stack (portal, postgres, neo4j, qdrant, edge-node).
#
# Typical time from `terraform apply` to healthy portal: ~8-12 minutes.
# Track progress: aws ssm start-session --target <instance_id> then
#   tail -f /var/log/dpf-install.log

# ── Data: Ubuntu 24.04 LTS (noble) AMI ──────────────────────────────────────

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical official account

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ── VPC: supplied or default ──────────────────────────────────────────────────

data "aws_vpc" "default" {
  count   = var.vpc_id == null ? 1 : 0
  default = true
}

locals {
  vpc_id = var.vpc_id != null ? var.vpc_id : data.aws_vpc.default[0].id
}

# ── IAM: instance role for SSM Session Manager ───────────────────────────────

resource "aws_iam_role" "dpf" {
  count = var.enable_ssm ? 1 : 0
  name  = "${var.name_prefix}-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = merge(var.tags, { Name = "${var.name_prefix}-instance-role" })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  count      = var.enable_ssm ? 1 : 0
  role       = aws_iam_role.dpf[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "dpf" {
  count = var.enable_ssm ? 1 : 0
  name  = "${var.name_prefix}-instance-profile"
  role  = aws_iam_role.dpf[0].name

  tags = merge(var.tags, { Name = "${var.name_prefix}-instance-profile" })
}

# ── Security group ────────────────────────────────────────────────────────────

resource "aws_security_group" "dpf" {
  name        = "${var.name_prefix}-sg"
  description = "DPF single-VM: portal (3000) + optional SSH (22)"
  vpc_id      = local.vpc_id

  # SSH — disabled when admin_cidr_blocks = []
  dynamic "ingress" {
    for_each = length(var.admin_cidr_blocks) > 0 ? [1] : []
    content {
      description = "SSH"
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = var.admin_cidr_blocks
    }
  }

  # DPF portal
  ingress {
    description = "DPF portal"
    from_port   = 3000
    to_port     = 3000
    protocol    = "tcp"
    cidr_blocks = var.portal_cidr_blocks
  }

  # All outbound (image pulls, LLM API calls, GHCR, npm)
  egress {
    description = "All outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-sg" })
}

# ── Cloud-init user data ──────────────────────────────────────────────────────

locals {
  user_data = templatefile("${path.module}/user-data/install.sh", {
    dpf_repo_url           = var.dpf_repo_url
    dpf_branch             = var.dpf_branch
    # base64-encoded so any password value passes safely through bash single-quote context
    dpf_admin_password_b64 = base64encode(var.dpf_admin_password)
    llm_base_url           = var.llm_base_url
    llm_model              = var.llm_model
    embedding_model        = var.embedding_model
  })
}

# ── EC2 instance ──────────────────────────────────────────────────────────────

resource "aws_instance" "dpf" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = var.subnet_id
  key_name                    = var.key_name
  iam_instance_profile        = var.enable_ssm ? aws_iam_instance_profile.dpf[0].name : null
  associate_public_ip_address = true

  vpc_security_group_ids = [aws_security_group.dpf.id]

  user_data = local.user_data

  root_block_device {
    volume_type           = "gp3"
    volume_size           = var.root_volume_size_gb
    delete_on_termination = true
    encrypted             = true
  }

  # Require IMDSv2 (metadata token-required). Prevents SSRF-based metadata theft.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-portal" })

  lifecycle {
    # Prevent Terraform from replacing the instance on AMI refresh.
    # To update the AMI, target this resource explicitly:
    #   terraform apply -replace=aws_instance.dpf
    ignore_changes = [ami, user_data]
  }
}
