# Kinetix IDE: Concurrency Stress-Tester (Windows)
# Benchmarks target nodes (Ollama, PM2, or console api) to audit throughput and evaluate grade status

$targetUrl = "http://localhost:3000/api/metrics"
$concurrency = 15
$totalRequests = 150

Write-Host "🛸 Kinetix Telemetry Benchmark: Simulating load..." -ForegroundColor Cyan
Write-Host "Target Target:      $targetUrl" -ForegroundColor Yellow
Write-Host "Concurrent Workers: $concurrency" -ForegroundColor Yellow
Write-Host "Total Requests:     $totalRequests" -ForegroundColor Yellow

$startTime = Get-Date
$success = 0
$fail = 0
$latencies = @()

$jobs = @()
for ($i = 0; $i -lt $concurrency; $i++) {
    $requestPerThread = [Math]::Floor($totalRequests / $concurrency)
    
    $job = Start-Job -ScriptBlock {
        param($url, $count)
        $suc = 0
        $fl = 0
        $lats = @()
        for ($j = 0; $j -lt $count; $j++) {
            $reqStart = Get-Date
            try {
                $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2 -ErrorAction Stop
                $reqEnd = Get-Date
                $lats += ($reqEnd - $reqStart).TotalMilliseconds
                $suc++
            } catch {
                $fl++
            }
            Start-Sleep -Milliseconds 30
        }
        return @{success=$suc; fail=$fl; latencies=$lats}
    } -ArgumentList $targetUrl, $requestPerThread
    $jobs += $job
}

$results = Wait-Job $jobs | Receive-Job
foreach ($res in $results) {
    if ($res -ne $null) {
        $success += $res.success
        $fail += $res.fail
        if ($res.latencies -ne $null) { $latencies += $res.latencies }
    }
}
Remove-Job $jobs

$endTime = Get-Date
$duration = ($endTime - $startTime).TotalSeconds
$avgLatency = 0
if ($latencies.Count -gt 0) {
    $sum = 0
    foreach ($l in $latencies) { $sum += $l }
    $avgLatency = $sum / $latencies.Count
}

Write-Host "`n📊 BENCHMARK METRICS RESULTS" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "Total Elapsed:     $([Math]::Round($duration, 2)) seconds" -ForegroundColor White
Write-Host "Success Rate:      $success / $($success + $fail) requests" -ForegroundColor Green
Write-Host "Avg Query Latency: $([Math]::Round($avgLatency, 2)) ms" -ForegroundColor White
Write-Host "========================================" -ForegroundColor Yellow

if ($fail -eq 0 -and $avgLatency -lt 120) {
    Write-Host "✓ Benchmark rating: Node Rank A+ (Optimal Performance)" -ForegroundColor Green
} else {
    Write-Host "- Benchmark rating: Node Rank B (Resource saturation detected)" -ForegroundColor DarkYellow
}
