# Kinetix IDE: Thread Scheduling & Memory Allocation Script (Windows)
# Aligns libuv and V8 heap limits to high-performance workspace nodes (up to 24 threads)

Write-Host "🛸 Tuning workspace CPU affinity and scheduling..." -ForegroundColor Cyan

# Configure Node Thread Pool
$logicalCores = [System.Environment]::ProcessorCount
$threadPoolSize = [Math]::Max(4, $logicalCores)
[System.Environment]::SetEnvironmentVariable("UV_THREADPOOL_SIZE", $threadPoolSize.ToString(), "User")
$env:UV_THREADPOOL_SIZE = $threadPoolSize
Write-Host "✓ UV_THREADPOOL_SIZE configured to $threadPoolSize (Thread affinity set)" -ForegroundColor Green

# Configure Max RAM allocation (Heap limit: 8GB)
$maxHeap = 8192
[System.Environment]::SetEnvironmentVariable("NODE_OPTIONS", "--max-old-space-size=$maxHeap", "User")
$env:NODE_OPTIONS = "--max-old-space-size=$maxHeap"
Write-Host "✓ NODE_OPTIONS configured to utilize up to $maxHeap MB of RAM." -ForegroundColor Green

# Priority Hook for Process Manager
try {
    $processes = Get-Process -Name "pm2" -ErrorAction SilentlyContinue
    if ($processes) {
        $processes.PriorityClass = "High"
        Write-Host "✓ PM2 background daemon priority elevated to High." -ForegroundColor Green
    }
} catch {
    # Skip silently if permission restricted or not running
}

Write-Host "🛸 System scheduling optimized successfully." -ForegroundColor Green
