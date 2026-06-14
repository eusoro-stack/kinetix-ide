#!/usr/bin/env python3
import os
import sys
import json
import time
import shutil
import argparse
import subprocess
from datetime import datetime

# Try loading environment variables from .env file if python-dotenv is available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Global NVML (NVIDIA Management Library) State for zero-overhead telemetry
NVML_AVAILABLE = False
NVML_DEVICE_HANDLE = None

def init_nvml():
    global NVML_AVAILABLE, NVML_DEVICE_HANDLE
    try:
        import pynvml
        pynvml.nvmlInit()
        # Cache handle for the first GPU device (index 0)
        NVML_DEVICE_HANDLE = pynvml.nvmlDeviceGetHandleByIndex(0)
        NVML_AVAILABLE = True
        print("[NVML] Native GPU library initialized. Zero-overhead querying active.")
    except Exception as e:
        NVML_AVAILABLE = False
        NVML_DEVICE_HANDLE = None
        print(f"[NVML] Initialization failed: {e}. Falling back to nvidia-smi subprocess.")

def parse_args():
    parser = argparse.ArgumentParser(description="Kinetix Telemetry Collector Daemon")
    parser.parser_path = os.path.dirname(os.path.abspath(__file__))
    parser.add_argument("--interval", type=int, default=5, help="Polling interval in seconds")
    parser.add_argument("--output", default=os.path.join(parser.parser_path, "telemetry_node.json"), help="Path to write local JSON status")
    parser.add_argument("--bigquery", action="store_true", help="Stream telemetry directly to Google Cloud BigQuery")
    return parser.parse_args()

def apply_core_affinity(p_threads, e_threads):
    pinned_log = []
    try:
        import psutil
        # Scan active processes
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                name = proc.info['name'].lower() if proc.info['name'] else ""
                pid = proc.info['pid']
                
                # Check for high-priority inference processes
                if 'ollama' in name or 'llama' in name:
                    # Pin to P-cores
                    proc.cpu_affinity(p_threads)
                    pinned_log.append({
                        "pid": pid,
                        "name": proc.info['name'],
                        "type": "inference",
                        "cores": p_threads
                    })
                # Check for background tasks running under our ide setup
                elif name in ['node.exe', 'python.exe', 'pm2.exe'] or 'node' in name or 'python' in name:
                    cmdline = proc.info['cmdline']
                    cmdline_str = " ".join(cmdline).lower() if cmdline else ""
                    
                    is_kinetix_task = False
                    if any(k in cmdline_str for k in ['kinetix', 'telemetry', 'rag_agent', 'serve_cors', 'make_video']):
                        is_kinetix_task = True
                    
                    if is_kinetix_task:
                        # Pin to E-cores
                        proc.cpu_affinity(e_threads)
                        pinned_log.append({
                            "pid": pid,
                            "name": proc.info['name'],
                            "type": "background",
                            "cores": e_threads
                        })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
                continue
    except Exception as e:
        print(f"Error in core affinity manager: {e}", file=sys.stderr)
    return pinned_log

def get_system_metrics():
    metrics = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "cpu": {},
        "memory": {},
        "disk": {},
        "gpu": {
            "available": False
        }
    }
    
    # 1. CPU Metrics
    try:
        import psutil
        metrics["cpu"]["percent"] = psutil.cpu_percent(interval=None)
        metrics["cpu"]["cores"] = psutil.cpu_count(logical=False) or 4
        metrics["cpu"]["threads"] = psutil.cpu_count(logical=True) or 4
        
        # CPU Topology Identification
        logical_cores = metrics["cpu"]["threads"]
        physical_cores = metrics["cpu"]["cores"]
        
        # Heuristic for hybrid cores (Intel Alder Lake / Raptor Lake):
        # HT physical cores have 2 threads, E-cores have 1.
        # H = L - P
        ht_cores = logical_cores - physical_cores
        if ht_cores > 0:
            p_core_threads = list(range(0, 2 * ht_cores))
            e_core_threads = list(range(2 * ht_cores, logical_cores))
        else:
            # Fallback for symmetrical CPUs:
            # Split cores in half: lower half for P-cores, upper half for E-cores
            p_core_threads = list(range(0, max(1, logical_cores // 2)))
            e_core_threads = list(range(max(1, logical_cores // 2), logical_cores))
            if not e_core_threads:
                e_core_threads = [0]
                
        metrics["cpu"]["p_cores"] = p_core_threads
        metrics["cpu"]["e_cores"] = e_core_threads
        metrics["cpu"]["per_core_percent"] = psutil.cpu_percent(interval=None, percpu=True)
        
        # Execute Process Pinning
        metrics["cpu"]["pinned_processes"] = apply_core_affinity(p_core_threads, e_core_threads)
        
        if sys.platform != 'win32':
            metrics["cpu"]["load_avg"] = os.getloadavg()
        else:
            metrics["cpu"]["load_avg"] = [metrics["cpu"]["percent"]] * 3
            
        # 2. Memory Metrics
        mem = psutil.virtual_memory()
        metrics["memory"] = {
            "total_bytes": mem.total,
            "available_bytes": mem.available,
            "used_bytes": mem.used,
            "percent": mem.percent
        }
        
        # 3. Disk Metrics
        disk = psutil.disk_usage('/')
        metrics["disk"] = {
            "total_bytes": disk.total,
            "free_bytes": disk.free,
            "used_bytes": disk.used,
            "percent": disk.percent
        }
    except ImportError:
        # Minimal Fallback
        metrics["cpu"]["percent"] = 10.0
        metrics["cpu"]["cores"] = os.cpu_count() or 4
        metrics["cpu"]["threads"] = os.cpu_count() or 4
        metrics["cpu"]["p_cores"] = list(range(metrics["cpu"]["threads"] // 2))
        metrics["cpu"]["e_cores"] = list(range(metrics["cpu"]["threads"] // 2, metrics["cpu"]["threads"]))
        metrics["cpu"]["per_core_percent"] = [10.0] * metrics["cpu"]["threads"]
        metrics["cpu"]["pinned_processes"] = []
        metrics["cpu"]["load_avg"] = [0.0, 0.0, 0.0]
        
        total_mem = 16 * 1024 * 1024 * 1024
        metrics["memory"] = {
            "total_bytes": total_mem,
            "available_bytes": int(total_mem * 0.8),
            "used_bytes": int(total_mem * 0.2),
            "percent": 20.0
        }
        
        try:
            total, used, free = shutil.disk_usage('/')
            metrics["disk"] = {
                "total_bytes": total,
                "free_bytes": free,
                "used_bytes": used,
                "percent": round((used / total) * 100, 2)
            }
        except Exception:
            metrics["disk"] = {
                "total_bytes": 500 * 1024 * 1024 * 1024,
                "free_bytes": 250 * 1024 * 1024 * 1024,
                "used_bytes": 250 * 1024 * 1024 * 1024,
                "percent": 50.0
            }

    # 4. GPU Metrics
    gpu_metrics_retrieved = False
    
    # Try using in-process NVML bindings first for zero-overhead querying
    if NVML_AVAILABLE and NVML_DEVICE_HANDLE is not None:
        try:
            import pynvml
            
            # Query name
            name = pynvml.nvmlDeviceGetName(NVML_DEVICE_HANDLE)
            if isinstance(name, bytes):
                name = name.decode('utf-8')
                
            # Query temperature
            temp = pynvml.nvmlDeviceGetTemperature(NVML_DEVICE_HANDLE, pynvml.NVML_TEMPERATURE_GPU)
            
            # Query memory (VRAM)
            mem_info = pynvml.nvmlDeviceGetMemoryInfo(NVML_DEVICE_HANDLE)
            vram_total = mem_info.total
            vram_used = mem_info.used
            vram_free = mem_info.free
            vram_percent = round((vram_used / vram_total) * 100, 2) if vram_total > 0 else 0.0
            
            # Query utilization
            util_info = pynvml.nvmlDeviceGetUtilizationRates(NVML_DEVICE_HANDLE)
            gpu_util = util_info.gpu
            
            metrics["gpu"] = {
                "available": True,
                "name": name,
                "temperature": int(temp),
                "vram": {
                    "total_bytes": int(vram_total),
                    "used_bytes": int(vram_used),
                    "free_bytes": int(vram_free),
                    "percent": vram_percent
                },
                "utilization": int(gpu_util)
            }
            gpu_metrics_retrieved = True
        except Exception as e:
            metrics["gpu"]["error_nvml"] = f"NVML query error: {str(e)}"

    # Fallback to legacy subprocess for nvidia-smi if NVML is not configured/fails
    if not gpu_metrics_retrieved:
        nvidia_smi_path = shutil.which("nvidia-smi")
        if not nvidia_smi_path and sys.platform == 'win32':
            check_paths = [
                r"C:\Program Files\NVIDIA Corporation\NVSMI\nvidia-smi.exe",
                r"C:\Windows\System32\nvidia-smi.exe"
            ]
            for p in check_paths:
                if os.path.exists(p):
                    nvidia_smi_path = p
                    break

        if nvidia_smi_path:
            try:
                res = subprocess.run(
                    [nvidia_smi_path, "--query-gpu=name,temperature.gpu,memory.total,memory.used,utilization.gpu", "--format=csv,noheader,nounits"],
                    capture_output=True, text=True, check=True
                )
                lines = res.stdout.strip().split('\n')
                if lines and ',' in lines[0]:
                    parts = [p.strip() for p in lines[0].split(',')]
                    vram_total_mib = float(parts[2])
                    vram_used_mib = float(parts[3])
                    vram_percent = round((vram_used_mib / vram_total_mib) * 100, 2)
                    
                    metrics["gpu"] = {
                        "available": True,
                        "name": parts[0],
                        "temperature": int(parts[1]),
                        "vram": {
                            "total_bytes": int(vram_total_mib * 1024 * 1024),
                            "used_bytes": int(vram_used_mib * 1024 * 1024),
                            "free_bytes": int((vram_total_mib - vram_used_mib) * 1024 * 1024),
                            "percent": vram_percent
                        },
                        "utilization": int(parts[4])
                    }
                    gpu_metrics_retrieved = True
            except Exception as e:
                metrics["gpu"]["error_smi"] = f"nvidia-smi fallback error: {str(e)}"
            
    # Calculate Node Health Grade
    cpu_percent = metrics["cpu"]["percent"]
    mem_percent = metrics["memory"]["percent"]
    gpu_percent = metrics["gpu"].get("utilization", 0) if metrics["gpu"]["available"] else 0
    gpu_vram_percent = metrics["gpu"].get("vram", {}).get("percent", 0) if metrics["gpu"]["available"] else 0
    
    avg_load = (cpu_percent + mem_percent + max(gpu_percent, gpu_vram_percent)) / 3.0
    
    if avg_load < 15:
        grade = "A+"
    elif avg_load < 30:
        grade = "A"
    elif avg_load < 50:
        grade = "B"
    elif avg_load < 70:
        grade = "C"
    elif avg_load < 85:
        grade = "D"
    else:
        grade = "F"
        
    metrics["system_grade"] = grade
    metrics["average_load_percent"] = round(avg_load, 2)
    metrics["os_platform"] = sys.platform
    metrics["uptime"] = int(time.time() - psutil.boot_time()) if 'psutil' in sys.modules else 3600
    
    return metrics

def stream_to_bigquery(metrics_data):
    """
    Streams metrics into GCP BigQuery dynamically loaded from environment
    """
    gcp_project = os.environ.get("GCP_PROJECT_ID")
    dataset_name = os.environ.get("SENTINEL_BIGQUERY_DATASET", "sentinel_telemetry")
    table_name = os.environ.get("SENTINEL_BIGQUERY_TABLE", "node_health_log")
    
    if not gcp_project:
        # Quiet return if not configured
        return

    try:
        from google.cloud import bigquery
        client = bigquery.Client(project=gcp_project)
        table_id = f"{gcp_project}.{dataset_name}.{table_name}"
        
        row = {
            "timestamp": metrics_data["timestamp"],
            "cpu_percent": metrics_data["cpu"]["percent"],
            "mem_percent": metrics_data["memory"]["percent"],
            "disk_percent": metrics_data["disk"]["percent"],
            "gpu_available": metrics_data["gpu"]["available"],
            "gpu_name": metrics_data["gpu"].get("name", "N/A"),
            "gpu_temp": metrics_data["gpu"].get("temperature", 0),
            "gpu_utilization": metrics_data["gpu"].get("utilization", 0),
            "gpu_vram_percent": metrics_data["gpu"].get("vram", {}).get("percent", 0.0),
            "system_grade": metrics_data["system_grade"],
            "average_load_percent": metrics_data["average_load_percent"]
        }
        
        errors = client.insert_rows_json(table_id, [row])
        if errors:
            print(f"[{datetime.now()}] BigQuery streaming errors: {errors}", file=sys.stderr)
    except Exception as e:
        # Log failure warning locally
        print(f"[{datetime.now()}] Telemetry streaming exception: {e}", file=sys.stderr)

def main():
    args = parse_args()
    print(f"Kinetix Telemetry Collector started. Interval: {args.interval}s.")
    print(f"Metrics output node: {args.output}")

    # Initialize NVML once at process boot
    init_nvml()

    try:
        while True:
            try:
                metrics = get_system_metrics()
                
                # Write local JSON safely
                temp_output = args.output + ".tmp"
                with open(temp_output, "w") as f:
                    json.dump(metrics, f, indent=2)
                os.replace(temp_output, args.output)
                
                # Stream to BQ if CLI flag set or env configured
                if args.bigquery or os.environ.get("GCP_PROJECT_ID"):
                    stream_to_bigquery(metrics)
                    
            except Exception as e:
                print(f"Error in telemetry loop: {e}", file=sys.stderr)
                
            time.sleep(args.interval)
    finally:
        # Gracefully shutdown NVML if initialized
        if NVML_AVAILABLE:
            try:
                import pynvml
                pynvml.nvmlShutdown()
                print("[NVML] Shutdown complete.")
            except Exception:
                pass

if __name__ == "__main__":
    main()
