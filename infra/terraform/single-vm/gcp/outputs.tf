output "instance_id" {
  description = "Compute Engine instance ID (numeric)."
  value       = google_compute_instance.dpf.instance_id
}

output "instance_name" {
  description = "Compute Engine instance name."
  value       = google_compute_instance.dpf.name
}

output "public_ip" {
  description = "Ephemeral public IP of the DPF VM. Note: changes if the instance is stopped and started. Assign a static external IP if you need a stable address."
  value       = google_compute_instance.dpf.network_interface[0].access_config[0].nat_ip
}

output "portal_url" {
  description = "DPF portal URL. The portal takes ~8-12 minutes after first launch to become healthy (image pulls + database migrations)."
  value       = "http://${google_compute_instance.dpf.network_interface[0].access_config[0].nat_ip}:3000"
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

output "iap_ssh_command" {
  description = "SSH via IAP tunnel (no public port 22 needed). Requires gcloud CLI and IAP-enabled firewall rule."
  value       = "gcloud compute ssh ubuntu@${google_compute_instance.dpf.name} --project=${var.project_id} --zone=${var.zone} --tunnel-through-iap"
}

output "install_log_command" {
  description = "Watch cloud-init progress via IAP tunnel."
  value       = "gcloud compute ssh ubuntu@${google_compute_instance.dpf.name} --project=${var.project_id} --zone=${var.zone} --tunnel-through-iap --command='tail -f /var/log/dpf-install.log'"
}

output "doctor_command" {
  description = "Run DPF diagnostics on the instance."
  value       = "gcloud compute ssh ubuntu@${google_compute_instance.dpf.name} --project=${var.project_id} --zone=${var.zone} --tunnel-through-iap --command='cd /opt/dpf && bash install-dpf.sh doctor'"
}

output "service_account_email" {
  description = "Email of the minimal service account attached to the instance."
  value       = google_service_account.dpf.email
}
