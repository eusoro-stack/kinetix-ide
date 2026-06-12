#!/usr/bin/env bash

# Kinetix IDE: Thread Scheduling & Memory Allocation Script (macOS / Linux)
# Aligns libuv and V8 heap limits to high-performance workspace nodes

echo -e "\033[36m🛸 Tuning workspace CPU scheduling and V8 heap bounds...\033[0m"

# Match thread pool size to logical processor count
if [[ "$OSTYPE" == "darwin"* ]]; then
    cores=$(sysctl -n hw.ncpu)
else
    cores=$(nproc)
fi

export UV_THREADPOOL_SIZE=$cores
echo -e "\033[32m✓ UV_THREADPOOL_SIZE set to $cores\033[0m"

# Optimize heap memory to allow up to 8GB space allocation
export NODE_OPTIONS="--max-old-space-size=8192"
echo -e "\033[32m✓ NODE_OPTIONS old space size set to 8192MB\033[0m"

# Persist to shell profile
if [[ "$SHELL" == */zsh ]]; then
    PROFILE="$HOME/.zshrc"
elif [[ "$SHELL" == */bash ]]; then
    PROFILE="$HOME/.bashrc"
else
    PROFILE="$HOME/.profile"
fi

if ! grep -q "UV_THREADPOOL_SIZE" "$PROFILE"; then
    echo "export UV_THREADPOOL_SIZE=$cores" >> "$PROFILE"
    echo 'export NODE_OPTIONS="--max-old-space-size=8192"' >> "$PROFILE"
    echo -e "\033[32m✓ Telemetry environments appended to $PROFILE\033[0m"
fi

echo -e "\033[36m🛸 System scheduling optimized successfully.\033[0m"
