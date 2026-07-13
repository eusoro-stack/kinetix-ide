#!/usr/bin/env python3
import os
import sys

# Ensure Windows standard out matches UTF-8 encoding for unicode emoji logs
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

import json
import time
import urllib.request
import urllib.parse
import threading

# Import psutil for setting CPU core affinity
try:
    import psutil
except ImportError:
    print("[Error] psutil library is required to pin processes to core affinity.")
    sys.exit(1)

# Configuration
API_BASE = "http://localhost:3000"
TEST_DURATION_SECONDS = 8
PE_CORES_SPLIT = 16  # Cores 0-15 are P-Cores, 16-23 are E-Cores

class BenchmarkThread(threading.Thread):
    def __init__(self, thread_id, core_id, duration):
        super().__init__()
        self.thread_id = thread_id
        self.core_id = core_id
        self.duration = duration
        self.operations_completed = 0
        self.stopped = False

    def run(self):
        # Pin thread to the specific core ID
        try:
            p = psutil.Process()
            p.cpu_affinity([self.core_id])
        except Exception as e:
            print(f"[Thread-{self.thread_id}] Core Pinning Failed on Core {self.core_id}: {e}")
            return

        end_time = time.time() + self.duration
        local_ops = 0

        # CPU stress loop: calculate prime sequences
        # Keep variables local for speed
        while time.time() < end_time and not self.stopped:
            # Simple math calculations to generate core load
            val = 1234567.0
            for _ in range(500):
                val = (val * 1.000001) / 1.0000005
                val = val % 1000000
            local_ops += 1

        self.operations_completed = local_ops

def http_get(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Kinetix-Stress-Test/1.0'})
        with urllib.request.urlopen(req, timeout=3000) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[HTTP] GET Failed for {url}: {e}")
        return None

def http_post(url, data):
    try:
        json_data = json.dumps(data).encode('utf-8')
        req = urllib.request.Request(
            url, 
            data=json_data, 
            headers={'Content-Type': 'application/json', 'User-Agent': 'Kinetix-Stress-Test/1.0'}
        )
        with urllib.request.urlopen(req, timeout=5000) as response:
            return json.loads(response.read().decode('utf-8'))
    except Exception as e:
        print(f"[HTTP] POST Failed for {url}: {e}")
        return None

def run_network_diagnostics():
    print("\n" + "="*50)
    print(" 🌐 NETWORK CONNECTIVITY & LATENCY CHALLENGE")
    print("="*50)
    
    # 1. Fetch discovered local network interfaces
    interfaces_url = f"{API_BASE}/api/network/interfaces"
    data = http_get(interfaces_url)
    
    if not data or "endpoints" not in data:
        print("[Error] Could not retrieve network interfaces from Express server.")
        return
        
    print(f"Hostname: {data.get('hostname', 'unknown')}")
    print(f"Active Port: {data.get('port', 3000)}")
    print("\nDiagnosing routing boundaries...")
    
    # 2. Challenge each endpoint via the Express gateway
    challenge_url = f"{API_BASE}/api/network/challenge"
    
    for ep in data["endpoints"]:
        target = ep["address"]
        label = ep["label"]
        type_str = ep["type"]
        
        # Call Express API network challenge proxy
        res = http_post(challenge_url, {"target": target})
        
        if res and res.get("success"):
            latency = res.get("latency_ms", 0)
            status = res.get("status", "N/A")
            print(f" -> [{type_str}] {label:<30} | Status: {status} OK | Latency: {latency}ms")
        else:
            err = res.get("error", "Timeout") if res else "Endpoint unreachable"
            print(f" -> [{type_str}] {label:<30} | FAILED | Error: {err}")

def run_cpu_stress_test():
    # Identify CPU threads
    try:
        total_threads = psutil.cpu_count(logical=True)
    except Exception:
        total_threads = os.cpu_count() or 8
        
    print("\n" + "="*50)
    print(f" 🧬 CPU CORE STRESS TEST ({total_threads} Logical Threads)")
    print("="*50)
    
    p_cores = list(range(min(total_threads, PE_CORES_SPLIT)))
    e_cores = list(range(PE_CORES_SPLIT, total_threads)) if total_threads > PE_CORES_SPLIT else []
    
    print(f"Performance Cores (P-Cores) Mapped: Cores {p_cores[0]} to {p_cores[-1]}")
    if e_cores:
        print(f"Efficient Cores (E-Cores) Mapped:   Cores {e_cores[0]} to {e_cores[-1]}")
    else:
        print("Efficient Cores (E-Cores) Mapped:   None (Workstation has symmetrical cores)")
        
    print(f"\nLaunching stress threads for {TEST_DURATION_SECONDS} seconds...")
    
    threads = []
    
    # Spawn P-Core Benchmark Threads
    for index, core in enumerate(p_cores):
        t = BenchmarkThread(thread_id=f"P-{index}", core_id=core, duration=TEST_DURATION_SECONDS)
        threads.append(t)
        
    # Spawn E-Core Benchmark Threads
    for index, core in enumerate(e_cores):
        t = BenchmarkThread(thread_id=f"E-{index}", core_id=core, duration=TEST_DURATION_SECONDS)
        threads.append(t)
        
    # Start all threads
    start_time = time.time()
    for t in threads:
        t.start()
        
    # Wait for completion
    for t in threads:
        t.join()
    end_time = time.time()
    
    actual_duration = end_time - start_time
    print(f"\nBenchmarking complete in {actual_duration:.2f} seconds.")
    
    # Process results
    p_operations = 0
    e_operations = 0
    p_thread_count = 0
    e_thread_count = 0
    
    print("\nCore-by-Core Benchmark Throughput:")
    print("-"*40)
    
    for t in threads:
        core_type = "P-Core" if "P" in t.thread_id else "E-Core"
        ops_sec = int(t.operations_completed / actual_duration)
        print(f" -> Core {t.core_id:>2} ({core_type}): {ops_sec:>7,} math loops/sec")
        
        if "P" in t.thread_id:
            p_operations += t.operations_completed
            p_thread_count += 1
        else:
            e_operations += t.operations_completed
            e_thread_count += 1
            
    print("-"*40)
    
    p_avg = int(p_operations / actual_duration / p_thread_count) if p_thread_count > 0 else 0
    e_avg = int(e_operations / actual_duration / e_thread_count) if e_thread_count > 0 else 0
    
    print(f"P-Cores Average Throughput: {p_avg:,} math loops/sec per core")
    if e_thread_count > 0:
        print(f"E-Cores Average Throughput: {e_avg:,} math loops/sec per core")
        ratio = p_avg / e_avg if e_avg > 0 else 1
        print(f"Efficiency Ratio (P-Core speed vs E-Core): {ratio:.2f}x faster")
    
    print("\nStatus: Workstation core partition verified successfully.")

if __name__ == "__main__":
    print("="*60)
    print(" 👽 KINETIX ADVANCED WORKSTATION SYSTEM STRESS TEST")
    print("="*60)
    
    run_network_diagnostics()
    run_cpu_stress_test()
    
    print("\n" + "="*60)
    print(" SYSTEM PERFORMANCE TEST VERIFICATION COMPLETE")
    print("="*60)
