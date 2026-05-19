# infra/terraform/single-vm/azure/main.tf
#
# Provisions a single Ubuntu 24.04 Azure VM and runs install-dpf.sh
# via cloud-init (custom_data). Mirrors the structure of the AWS and GCP
# modules in this directory.
#
# Azure-specific notes vs the AWS/GCP modules:
#   - Networking is explicit: VNet + subnet + public IP + NIC + NSG.
#   - Azure does not offer a free SSM/IAP equivalent. Shell access uses
#     direct SSH (admin_ssh_public_key required). To avoid exposing port 22,
#     set admin_source_ranges = [] and use 'az vm run-command invoke' for
#     one-shot commands, or provision Azure Bastion separately.
#   - cloud-init is delivered via custom_data (base64-encoded); Ubuntu 24.04
#     images from Canonical process it on first boot.
#   - Managed disks are encrypted at rest with platform-managed keys by default
#     (no extra configuration needed).
#   - The resource group must exist before applying — this module intentionally
#     does not create it to avoid destroying existing resources on 'terraform destroy'.

locals {
  user_data = templatefile("${path.module}/user-data/install.sh", {
    dpf_repo_url           = var.dpf_repo_url
    dpf_branch             = var.dpf_branch
    dpf_admin_password_b64 = base64encode(var.dpf_admin_password)
    llm_base_url           = var.llm_base_url
    llm_model              = var.llm_model
    embedding_model        = var.embedding_model
  })

  base_tags = { managed-by = "terraform", component = "dpf-portal" }
  tags      = merge(local.base_tags, var.tags)
}

# ── Networking ────────────────────────────────────────────────────────────────

resource "azurerm_virtual_network" "dpf" {
  name                = "${var.name_prefix}-vnet"
  resource_group_name = var.resource_group_name
  location            = var.location
  address_space       = var.vnet_address_space
  tags                = local.tags
}

resource "azurerm_subnet" "dpf" {
  name                 = "${var.name_prefix}-subnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.dpf.name
  address_prefixes     = [var.subnet_address_prefix]
}

resource "azurerm_public_ip" "dpf" {
  name                = "${var.name_prefix}-pip"
  resource_group_name = var.resource_group_name
  location            = var.location
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.tags
}

# ── Network security group ────────────────────────────────────────────────────

resource "azurerm_network_security_group" "dpf" {
  name                = "${var.name_prefix}-nsg"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = local.tags
}

resource "azurerm_network_security_rule" "ssh" {
  count                       = length(var.admin_source_ranges) > 0 ? 1 : 0
  name                        = "allow-ssh"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.dpf.name
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefixes     = var.admin_source_ranges
  destination_address_prefix  = "*"
}

resource "azurerm_network_security_rule" "portal" {
  name                        = "allow-portal"
  resource_group_name         = var.resource_group_name
  network_security_group_name = azurerm_network_security_group.dpf.name
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "3000"
  source_address_prefixes     = var.portal_source_ranges
  destination_address_prefix  = "*"
}

# ── Network interface ─────────────────────────────────────────────────────────

resource "azurerm_network_interface" "dpf" {
  name                = "${var.name_prefix}-nic"
  resource_group_name = var.resource_group_name
  location            = var.location
  tags                = local.tags

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.dpf.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.dpf.id
  }
}

resource "azurerm_network_interface_security_group_association" "dpf" {
  network_interface_id      = azurerm_network_interface.dpf.id
  network_security_group_id = azurerm_network_security_group.dpf.id
}

# ── Virtual machine ───────────────────────────────────────────────────────────

resource "azurerm_linux_virtual_machine" "dpf" {
  name                = "${var.name_prefix}-portal"
  resource_group_name = var.resource_group_name
  location            = var.location
  size                = var.vm_size
  admin_username      = var.admin_username
  tags                = local.tags

  # cloud-init delivered via custom_data; Ubuntu 24.04 processes it on first boot.
  custom_data = base64encode(local.user_data)

  network_interface_ids = [azurerm_network_interface.dpf.id]

  admin_ssh_key {
    username   = var.admin_username
    public_key = var.admin_ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
    disk_size_gb         = var.os_disk_size_gb
    # Managed disk encryption at rest with platform-managed keys is on by default.
  }

  source_image_reference {
    # Ubuntu 24.04 LTS (Noble Numbat) — official Canonical Azure image.
    publisher = "Canonical"
    offer     = "ubuntu-24_04-lts"
    sku       = "server"
    version   = "latest"
  }

  lifecycle {
    # Prevent replacement when the image resolves to a new patch version.
    # To replace: terraform apply -replace=azurerm_linux_virtual_machine.dpf
    ignore_changes = [custom_data, source_image_reference[0].version]
  }
}
