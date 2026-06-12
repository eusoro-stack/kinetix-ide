#!/usr/bin/env bash

# Kinetix IDE: One-Click Environment Setup Script (macOS / Linux Bash)
# Usage: ./core/setup.sh

BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." &> /dev/null && pwd )"
echo -e "\033[36m🛸 Kinetix IDE Blueprint Installer: Validating environment...\033[0m"

# 1. Directory Structure Setup
echo -e "\n\033[33m[1/4] Preparing workspace directories...\033[0m"
folders=("config" "logs" "data" "scripts")
for f in "${folders[@]}"; do
    if [ ! -d "$BASE_DIR/$f" ]; then
        mkdir -p "$BASE_DIR/$f"
        echo -e "\033[32m✓ Created directory: ./$f\033[0m"
    else
        echo -e "\033[32m✓ Directory exists: ./$f\033[0m"
    fi
done

# 2. Environment Configurations Setup
echo -e "\n\033[33m[2/4] Initializing environment config variables...\033[0m"
if [ ! -f "$BASE_DIR/.env" ]; then
    if [ -f "$BASE_DIR/config/.env.example" ]; then
        cp "$BASE_DIR/config/.env.example" "$BASE_DIR/.env"
        echo -e "\033[32m✓ Created .env file from config/.env.example\033[0m"
    else
        echo -e "\033[31m⚠️  Could not find config/.env.example template.\033[0m"
    fi
else
    echo -e "\033[32m✓ Active root .env configuration detected.\033[0m"
fi

# 3. Core Tool Dependency Verification
echo -e "\n\033[33m[3/4] Benchmarking system tool chain requirements...\033[0m"

if command -v node &> /dev/null; then
    echo -e "\033[32m✓ Node.js detected: $(node -v)\033[0m"
else
    echo -e "\033[31mError: Node.js is required but not found in PATH. Please install Node.js (v18+) and retry.\033[0m"
    exit 1
fi

if command -v pm2 &> /dev/null; then
    echo -e "\033[32m✓ PM2 background process manager detected.\033[0m"
else
    echo -e "\033[33m- PM2 not found globally. Initiating installation...\033[0m"
    npm install -g pm2
    if [ $? -eq 0 ]; then
        echo -e "\033[32m✓ PM2 installed globally successfully.\033[0m"
    else
        echo -e "\033[31m⚠️  Could not install PM2 automatically. Run 'sudo npm install -g pm2' manually.\033[0m"
    fi
fi

if command -v python3 &> /dev/null; then
    echo -e "\033[32m✓ Python 3 detected: $(python3 --version)\033[0m"
    if python3 -c "import psutil" &> /dev/null; then
        echo -e "\033[32m✓ Python package 'psutil' is installed.\033[0m"
    else
        echo -e "\033[33m- Installing 'psutil' for system telemetry tracking...\033[0m"
        python3 -m pip install psutil --quiet
    fi
else
    echo -e "\033[31m⚠️  Python 3 is recommended for the telemetry collectors script.\033[0m"
fi

# 4. Console App Initialization
echo -e "\n\033[33m[4/4] Mounting Kinetix Console API dependencies...\033[0m"
if [ -d "$BASE_DIR/interface" ]; then
    cd "$BASE_DIR/interface"
    echo "Installing NPM dependencies for console..."
    npm install
    cd "$BASE_DIR"
    echo -e "\033[32m✓ Kinetix Interface mounted.\033[0m"
fi

echo -e "\n\033[32m🛸 Setup complete! To deploy your workspace, execute:\033[0m"
echo -e "\033[36mpm2 start core/ecosystem.config.js\033[0m"
