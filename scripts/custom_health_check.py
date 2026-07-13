#!/usr/bin/env python3
import os
import sys
import time
from datetime import datetime

# Try to load psutil for telemetry stats
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

def format_bytes(bytes, decimals=2):
    if bytes == 0:
        return '0 Bytes'
    k = 1024
    dm = 0 if decimals < 0 else decimals
    sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
    i = int(math.log(bytes) / math.log(k)) if bytes > 0 else 0
    return f"{float(bytes / (k ** i)):.{dm}f} {sizes[i]}"

# Standard fallback for format_bytes in case math is needed
import math

def main():
    print("==================================================")
    print("  Kinetix Workstation Custom Health Monitor")
    print(f"  Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("==================================================")
    
    interval = 5
    
    # Cache initial I/O values if psutil is available
    if PSUTIL_AVAILABLE:
        try:
            initial_io = psutil.disk_io_counters()
        except Exception:
            initial_io = None
    else:
        initial_io = None
        print("[Warning] 'psutil' library not found. Running with mock/fallback metrics.")

    while True:
        try:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            if PSUTIL_AVAILABLE:
                # 1. Memory usage
                mem = psutil.virtual_memory()
                mem_used = format_bytes(mem.used)
                mem_total = format_bytes(mem.total)
                mem_pct = mem.percent
                
                # 2. Disk I/O since monitor start
                try:
                    current_io = psutil.disk_io_counters()
                    if initial_io and current_io:
                        read_diff = current_io.read_bytes - initial_io.read_bytes
                        write_diff = current_io.write_bytes - initial_io.read_bytes # wait, write_bytes - write_bytes or read_bytes? Typo check: current_io.write_bytes - initial_io.write_bytes
                        read_diff = max(0, read_diff)
                        write_diff = max(0, current_io.write_bytes - initial_io.write_bytes)
                        
                        io_msg = f"Disk I/O since monitor boot: Read={format_bytes(read_diff)}, Write={format_bytes(write_diff)}"
                    else:
                        io_msg = f"Disk total I/O since boot: Read={format_bytes(current_io.read_bytes)}, Write={format_bytes(current_io.write_bytes)}"
                except Exception:
                    io_msg = "Disk I/O counters unavailable."
                
                # 3. CPU Core Average temp mock check
                load_avg = [round(x, 2) for x in psutil.getloadavg()] if hasattr(psutil, "getloadavg") else [0.0, 0.0, 0.0]
                
                print(f"[{timestamp}] Memory Load: {mem_pct}% ({mem_used} / {mem_total})")
                print(f"[{timestamp}] {io_msg}")
                print(f"[{timestamp}] Load Average (1m, 5m, 15m): {load_avg}")
            else:
                # Fallback mock logs
                print(f"[{timestamp}] Memory Load: 74.2% (12.5 GB / 16.8 GB) [MOCK]")
                print(f"[{timestamp}] Disk I/O since monitor boot: Read=12.4 MB, Write=8.2 MB [MOCK]")
                print(f"[{timestamp}] Load Average: [1.45, 1.20, 0.98] [MOCK]")
                
            print("-" * 50)
            sys.stdout.flush()
            
        except KeyboardInterrupt:
            print(f"\n[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Health Monitor Stopped.")
            break
        except Exception as e:
            print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] Monitor Error: {e}", file=sys.stderr)
            sys.stderr.flush()
            
        time.sleep(interval)

if __name__ == "__main__":
    main()
