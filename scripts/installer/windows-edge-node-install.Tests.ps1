# scripts/installer/windows-edge-node-install.Tests.ps1
#
# Pester 5 tests for the Windows installer Edge Node compose/start/bootstrap
# helpers.
#
# Run: pwsh -NoProfile -Command "Invoke-Pester -Path scripts/installer/windows-edge-node-install.Tests.ps1 -Output Detailed"

#Requires -Modules @{ ModuleName='Pester'; ModuleVersion='5.0' }

BeforeAll {
    $script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    $script:InstallerPath = Join-Path $script:RepoRoot 'install-dpf.ps1'
    . $script:InstallerPath -LibraryOnly
    . (Resolve-DPFNativeEdgeModulePath -InstallDir $script:RepoRoot)
}

Describe "Windows installer Edge Node compose chain" {
    It "loads as a standalone downloaded bootstrap before release companions exist" {
        $standaloneRoot = Join-Path $TestDrive "standalone"
        New-Item -ItemType Directory -Path $standaloneRoot | Out-Null
        $standaloneInstaller = Join-Path $standaloneRoot "install-dpf.ps1"
        Copy-Item -LiteralPath $script:InstallerPath -Destination $standaloneInstaller

        { . $standaloneInstaller -LibraryOnly } | Should -Not -Throw
        Get-Command Resolve-DPFNativeEdgeModulePath -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It "loads installer Edge Node helper functions without running the installer flow" {
        Get-Command Get-DPFComposeArgs -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFEdgeComposeContent -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFStartScriptContent -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Get-DPFStopScriptContent -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Set-DPFEnvFileValue -ErrorAction Stop | Should -Not -BeNullOrEmpty
        Get-Command Install-DPFNativeEdgeNode -ErrorAction Stop | Should -Not -BeNullOrEmpty
    }

    It "builds the base, override, and Edge Node compose chain in order when edge is opted in" {
        $installRoot = Join-Path $TestDrive "dpf"
        New-Item -ItemType Directory -Path $installRoot | Out-Null
        Set-Content -Path (Join-Path $installRoot "docker-compose.yml") -Value "services: {}"
        Set-Content -Path (Join-Path $installRoot "docker-compose.override.yml") -Value "services: {}"
        Set-Content -Path (Join-Path $installRoot "docker-compose.edge.yml") -Value "services: {}"

        $composeArgs = Get-DPFComposeArgs -InstallDir $installRoot -IncludeEdge:$true

        ($composeArgs -join "|") | Should -Be "-f|docker-compose.yml|-f|docker-compose.override.yml|-f|docker-compose.edge.yml"
    }

    It "omits the Edge Node overlay by default (opt-in; BI-72CFF89D)" {
        $installRoot = Join-Path $TestDrive "dpf-default-edge"
        New-Item -ItemType Directory -Path $installRoot | Out-Null
        Set-Content -Path (Join-Path $installRoot "docker-compose.yml") -Value "services: {}"
        Set-Content -Path (Join-Path $installRoot "docker-compose.override.yml") -Value "services: {}"
        Set-Content -Path (Join-Path $installRoot "docker-compose.edge.yml") -Value "services: {}"

        $composeArgs = Get-DPFComposeArgs -InstallDir $installRoot

        ($composeArgs -join "|") | Should -Be "-f|docker-compose.yml|-f|docker-compose.override.yml"
    }

    It "can omit the Edge Node overlay for core-only startup" {
        $installRoot = Join-Path $TestDrive "dpf-core"
        New-Item -ItemType Directory -Path $installRoot | Out-Null
        Set-Content -Path (Join-Path $installRoot "docker-compose.yml") -Value "services: {}"
        Set-Content -Path (Join-Path $installRoot "docker-compose.edge.yml") -Value "services: {}"

        $composeArgs = Get-DPFComposeArgs -InstallDir $installRoot -IncludeEdge:$false

        ($composeArgs -join "|") | Should -Be "-f|docker-compose.yml"
    }

    It "renders a generated start script that starts the host-native Edge task" {
        $script = Get-DPFStartScriptContent

        $script | Should -Not -Match "docker-compose\.edge\.yml"
        $script | Should -Match "DPF-Native-Edge-Node"
        $script | Should -Match "docker compose @composeArgs up -d"
        $script | Should -Not -Match "(?m)^docker compose up -d$"
    }

    It "renders the consumer-mode Edge Node compose overlay" {
        $compose = Get-DPFEdgeComposeContent -Version "latest"

        $compose | Should -Match "edge-node:"
        $compose | Should -Match "ghcr\.io/opendigitalproductfactory/dpf-edge-node:latest"
        $compose | Should -Match 'DPF_BOOTSTRAP_TOKEN: \$\{DPF_BOOTSTRAP_TOKEN:-\}'
        $compose | Should -Match "edge_node_state:/var/lib/dpf-edge-node"
    }

    It "keeps checked-in start and stop entrypoints on the Edge Node compose chain" {
        foreach ($relativePath in @("dpf-start.ps1", "scripts/dpf-start.ps1")) {
            $content = Get-Content -Path (Join-Path $script:RepoRoot $relativePath) -Raw

            $content | Should -Match "docker-compose\.edge\.yml"
            $content | Should -Match "docker compose @composeArgs up -d"
            $content | Should -Not -Match "(?m)^docker compose up -d$"
        }

        foreach ($relativePath in @("dpf-stop.ps1", "scripts/dpf-stop.ps1")) {
            $content = Get-Content -Path (Join-Path $script:RepoRoot $relativePath) -Raw

            $content | Should -Match "docker-compose\.edge\.yml"
            $content | Should -Match "docker compose @composeArgs down"
            $content | Should -Not -Match "(?m)^docker compose down$"
        }
    }
}

Describe "Windows installer Edge Node bootstrap env" {
    It "appends and replaces bootstrap env values without duplicating keys" {
        $envPath = Join-Path $TestDrive ".env"
        Set-Content -Path $envPath -Value "FOO=bar`nDPF_BOOTSTRAP_TOKEN=dpfboot_OLD`n"

        Set-DPFEnvFileValue -Path $envPath -Key "DPF_BOOTSTRAP_TOKEN" -Value "dpfboot_NEW"
        Set-DPFEnvFileValue -Path $envPath -Key "DPF_EDGE_NODE_NAME" -Value "host-a"

        $text = Get-Content -Path $envPath -Raw
        ([regex]::Matches($text, "(?m)^DPF_BOOTSTRAP_TOKEN=").Count) | Should -Be 1
        ([regex]::Matches($text, "(?m)^DPF_EDGE_NODE_NAME=").Count) | Should -Be 1
        $text | Should -Match "(?m)^DPF_BOOTSTRAP_TOKEN=dpfboot_NEW$"
        $text | Should -Match "(?m)^DPF_EDGE_NODE_NAME=host-a$"
    }
}
