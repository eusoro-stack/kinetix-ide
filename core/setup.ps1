# Kinetix IDE: One-Click Environment Setup Script (Windows PowerShell)
# Usage: .\core\setup.ps1

$baseDir = Split-Path $PSScriptRoot -Parent
Write-Host "🛸 Kinetix IDE Blueprint Installer: Validating environment..." -ForegroundColor Cyan

# 1. Directory Structure Setup
Write-Host "`n[1/4] Preparing directories..." -ForegroundColor Yellow
$folders = @("config", "logs", "data", "scripts")
foreach ($folder in $folders) {
    $path = Join-Path $baseDir $folder
    if (-not (Test-Path $path)) {
        New-Item -ItemType Directory -Path $path | Out-Null
        Write-Host "✓ Created directory: ./$folder" -ForegroundColor Green
    } else {
        Write-Host "✓ Directory exists: ./$folder" -ForegroundColor Green
    }
}

# 2. Environment Configurations Setup
Write-Host "`n[2/4] Initializing environment config variables..." -ForegroundColor Yellow
$envExample = Join-Path (Join-Path $baseDir "config") ".env.example"
$envReal = Join-Path $baseDir ".env"
if (-not (Test-Path $envReal)) {
    if (Test-Path $envExample) {
        Copy-Item -Path $envExample -Destination $envReal
        Write-Host "✓ Created .env file in root from config/.env.example" -ForegroundColor Green
    } else {
        Write-Warning "Could not find config/.env.example template."
    }
} else {
    Write-Host "✓ Active root .env configuration detected." -ForegroundColor Green
}

# Bind default Ollama host to loopback if not set
if ([string]::IsNullOrEmpty($env:OLLAMA_HOST)) {
    [System.Environment]::SetEnvironmentVariable("OLLAMA_HOST", "127.0.0.1:11434", "User")
    $env:OLLAMA_HOST = "127.0.0.1:11434"
    Write-Host "✓ Bound default OLLAMA_HOST environment parameter." -ForegroundColor Green
}

# 3. Core Tool Dependency Verification
Write-Host "`n[3/4] Benchmarking system tool chain requirements..." -ForegroundColor Yellow

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    Write-Host "✓ Node.js detected: $(node -v)" -ForegroundColor Green
} else {
    Write-Error "Error: Node.js is required but not found in PATH. Please install Node.js (v18+) and retry."
    exit 1
}

$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if ($pm2) {
    Write-Host "✓ PM2 background process manager detected." -ForegroundColor Green
} else {
    Write-Host "- PM2 not found globally. Initiating installation..." -ForegroundColor DarkYellow
    npm install -g pm2
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ PM2 installed globally successfully." -ForegroundColor Green
    } else {
         Write-Warning "Could not install PM2 automatically. Run 'npm install -g pm2' as administrator."
    }
}

$python = Get-Command python -ErrorAction SilentlyContinue
if ($python) {
    Write-Host "✓ Python detected: $(python --version)" -ForegroundColor Green
    $hasPsutil = python -c "import psutil" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "- Installing psutil for system telemetry tracking..." -ForegroundColor DarkYellow
        pip install psutil --quiet
    }
} else {
    Write-Warning "Python 3 is recommended for the telemetry collectors script."
}

# 4. Console App Initialization
Write-Host "`n[4/4] Mounting Kinetix Console API dependencies..." -ForegroundColor Yellow
$consolePath = Join-Path $baseDir "interface"
if (Test-Path $consolePath) {
    Push-Location $consolePath
    Write-Host "Installing NPM dependencies for console..." -ForegroundColor Cyan
    npm install
    Pop-Location
    Write-Host "✓ Kinetix Interface mounted." -ForegroundColor Green
}

Write-Host "`n🛸 Setup complete! To deploy your workspace, execute:" -ForegroundColor Green
Write-Host "pm2 start core/ecosystem.config.js" -ForegroundColor Cyan
