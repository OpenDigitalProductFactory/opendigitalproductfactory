output "vm_id" {
  description = "Azure VM resource ID."
  value       = azurerm_linux_virtual_machine.dpf.id
}

output "vm_name" {
  description = "Azure VM name."
  value       = azurerm_linux_virtual_machine.dpf.name
}

output "public_ip" {
  description = "Static public IP of the DPF VM."
  value       = azurerm_public_ip.dpf.ip_address
}

output "portal_url" {
  description = "DPF portal URL. The portal takes ~8-12 minutes after first launch to become healthy (image pulls + database migrations)."
  value       = "http://${azurerm_public_ip.dpf.ip_address}:3000"
}

output "admin_username" {
  description = "DPF admin login username."
  value       = "admin@dpf.local"
}

output "admin_password" {
  description = "DPF admin password (from var.dpf_admin_password). Retrieve with: terraform output -raw admin_password"
  value       = var.dpf_admin_password
  sensitive   = true
}

output "ssh_command" {
  description = "SSH command to connect to the instance."
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.dpf.ip_address}"
}

output "install_log_command" {
  description = "Stream the cloud-init install log. Requires port 22 to be open (admin_source_ranges set) and SSH key configured."
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.dpf.ip_address} 'tail -f /var/log/dpf-install.log'"
}

output "run_command_log" {
  description = "Check install progress without SSH using Azure Run Command (output truncated to last ~50 lines; no live tail)."
  value       = "az vm run-command invoke --resource-group ${var.resource_group_name} --name ${azurerm_linux_virtual_machine.dpf.name} --command-id RunShellScript --scripts 'tail -n 50 /var/log/dpf-install.log'"
}

output "doctor_command" {
  description = "Run DPF diagnostics on the instance."
  value       = "ssh ${var.admin_username}@${azurerm_public_ip.dpf.ip_address} 'cd /opt/dpf && bash install-dpf.sh doctor'"
}
