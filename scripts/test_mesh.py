#!/usr/bin/env python3
import os
import sys
import json
import time
import urllib.request
from datetime import datetime

# Path Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOGS_DIR = os.path.join(BASE_DIR, "logs")
LOG_FILE = os.path.join(LOGS_DIR, "network_diagnostics.log")

# Ensure logs directory exists
os.makedirs(LOGS_DIR, exist_ok=True)

def fetch_json(url, data=None):
    """
    Helper to fetch JSON from local Express API safely using standard urllib
    """
    req = urllib.request.Request(url)
    if data:
        req.add_header("Content-Type", "application/json")
        encoded_data = json.dumps(data).encode("utf-8")
        req.data = encoded_data
        req.method = "POST"
        
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"[Mesh Logger Error] Request to {url} failed: {e}")
        return None

def main():
    print("--- Kinetix IDE: Network Mesh Diagnostics Sweep Tool ---")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    # 1. Fetch interfaces from the Express API
    api_url = "http://127.0.0.1:3000/api/network/interfaces"
    print(f"[{timestamp}] Contacting local server interfaces API...")
    interfaces_data = fetch_json(api_url)
    
    if not interfaces_data or "endpoints" not in interfaces_data:
        print("[Mesh Logger Error] Could not retrieve interfaces from local Express server.")
        print("Please ensure kinetix-console is running under PM2 on port 3000.")
        return

    endpoints = interfaces_data["endpoints"]
    print(f"[{timestamp}] Discovered {len(endpoints)} interface endpoints. Starting sweep...")
    
    log_lines = []
    log_lines.append(f"[{timestamp}] === NETWORK MESH DIAGNOSTIC RUN ===")
    
    for ep in endpoints:
        ep_type = ep["type"]
        address = ep["address"]
        label = ep["label"]
        
        print(f"Testing {ep_type} ({label}) at {address}...")
        
        # 2. Challenge the endpoint via the Express proxy pinger
        challenge_url = "http://127.0.0.1:3000/api/network/challenge"
        challenge_result = fetch_json(challenge_url, data={"target": address})
        
        if challenge_result and challenge_result.get("success"):
            latency = challenge_result.get("latency_ms")
            status = challenge_result.get("status")
            status_text = challenge_result.get("statusText", "OK")
            
            result_str = f"[{timestamp}] {ep_type} ({label}): REACHABLE | Latency={latency}ms | Status={status} {status_text}"
        else:
            err = challenge_result.get("error", "Connection Timeout") if challenge_result else "Express Pinger Offline"
            result_str = f"[{timestamp}] {ep_type} ({label}): UNREACHABLE | Error={err}"
            
        print(f"  Result: {result_str.split('|')[1].strip() if '|' in result_str else result_str}")
        log_lines.append(result_str)
        
    log_lines.append(f"[{timestamp}] ==========================================\n")
    
    # Write to local log file
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write("\n".join(log_lines))
        print(f"\n[Mesh Logger Success] Diagnostics log appended successfully to:")
        print(f"  {LOG_FILE}")
    except Exception as e:
        print(f"[Mesh Logger Error] Failed to write diagnostics log file: {e}")

if __name__ == "__main__":
    main()
