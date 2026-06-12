#!/usr/bin/env bash

# Kinetix IDE: Concurrency Stress-Tester (macOS / Linux)
# Benchmarks target nodes to evaluate average latency and rank validation

TARGET_URL="http://localhost:3000/api/metrics"
CONCURRENCY=15
TOTAL_REQUESTS=150

echo -e "\033[36m🛸 Kinetix Telemetry Benchmark: Simulating load...\033[0m"
echo -e "Target URL:  $TARGET_URL"
echo -e "Concurrency: $CONCURRENCY processes"
echo -e "Total load:  $TOTAL_REQUESTS queries"

start_time=$(date +%s%N)
success_count=0
fail_count=0
TMP_DIR=$(mktemp -d)

for ((i=0; i<CONCURRENCY; i++)); do
    req_per_thread=$((TOTAL_REQUESTS / CONCURRENCY))
    (
        thread_success=0
        thread_fail=0
        for ((j=0; j<req_per_thread; j++)); do
            response_code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "$TARGET_URL")
            if [ "$response_code" -eq 200 ]; then
                thread_success=$((thread_success + 1))
            else
                thread_fail=$((thread_fail + 1))
            fi
            sleep 0.03
        done
        echo "$thread_success $thread_fail" > "$TMP_DIR/thread_$i"
    ) &
done

wait

for ((i=0; i<CONCURRENCY; i++)); do
    if [ -f "$TMP_DIR/thread_$i" ]; then
        read -r s f < "$TMP_DIR/thread_$i"
        success_count=$((success_count + s))
        fail_count=$((fail_count + f))
    fi
done

rm -rf "$TMP_DIR"
end_time=$(date +%s%N)
elapsed_ns=$((end_time - start_time))
elapsed_sec=$(echo "scale=3; $elapsed_ns / 1000000000" | bc)
avg_latency=$(echo "scale=2; ($elapsed_sec * 1000) / $TOTAL_REQUESTS" | bc)

echo -e "\n\033[32m📊 BENCHMARK METRICS RESULTS\033[0m"
echo -e "\033[33m========================================\033[0m"
echo -e "Total Elapsed:     $elapsed_sec seconds"
echo -e "Success Rate:      $success_count / $TOTAL_REQUESTS requests"
echo -e "Avg Query Latency: $avg_latency ms"
echo -e "\033[33m========================================\033[0m"

if [ "$fail_count" -eq 0 ] && (( $(echo "$avg_latency < 120" | bc -l) )); then
    echo -e "\033[32m✓ Benchmark rating: Node Rank A+ (Optimal Performance)\033[0m"
else
    echo -e "\033[33m- Benchmark rating: Node Rank B (Resource saturation detected)\033[0m"
fi
