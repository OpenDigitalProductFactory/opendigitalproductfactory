Set-Location "C:\DPF"
docker compose up -d
Start-Sleep -Seconds 5
Start-Process "http://localhost:3000"
Write-Host "Digital Product Factory is starting at http://localhost:3000" -ForegroundColor Green
