output "instance_id" {
  description = "EC2 instance ID."
  value       = aws_instance.dpf.id
}

output "public_ip" {
  description = "Public IP of the DPF VM. Note: if the instance is stopped and started, this IP changes unless you add an Elastic IP."
  value       = aws_instance.dpf.public_ip
}

output "portal_url" {
  description = "DPF portal URL. The portal takes ~8-12 minutes after first launch to become healthy (image pulls + database migrations)."
  value       = "http://${aws_instance.dpf.public_ip}:3000"
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
  description = "SSH command to connect directly (requires key_name to be set and port 22 open)."
  value       = var.key_name != null ? "ssh ubuntu@${aws_instance.dpf.public_ip}" : "No key pair configured. Use SSM (see ssm_command)."
}

output "ssm_command" {
  description = "AWS SSM Session Manager command to open a shell without port 22."
  value       = var.enable_ssm ? "aws ssm start-session --target ${aws_instance.dpf.id} --region ${var.aws_region}" : "SSM not enabled (set enable_ssm = true to use)."
}

output "install_log_command" {
  description = "Command to tail the cloud-init install log. Run this after launching to watch progress."
  value       = var.enable_ssm ? "aws ssm start-session --target ${aws_instance.dpf.id} --region ${var.aws_region} --document-name AWS-StartInteractiveCommand --parameters command='tail -f /var/log/dpf-install.log'" : "ssh ubuntu@${aws_instance.dpf.public_ip} 'tail -f /var/log/dpf-install.log'"
}

output "doctor_command" {
  description = "Run DPF diagnostics on the instance and retrieve the bundle."
  value       = "ssh ubuntu@${aws_instance.dpf.public_ip} 'cd /opt/dpf && bash install-dpf.sh doctor'"
}
