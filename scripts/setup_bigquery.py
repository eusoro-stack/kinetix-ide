#!/usr/bin/env python3
import os
import sys

def main():
    print("--- Kinetix IDE: Google BigQuery Ingestion Setup Utility ---")
    
    gcp_project = os.environ.get("GCP_PROJECT_ID")
    dataset_name = os.environ.get("SENTINEL_BIGQUERY_DATASET", "sentinel_telemetry")
    table_name = os.environ.get("SENTINEL_BIGQUERY_TABLE", "node_health_log")
    
    if not gcp_project:
        print("[Setup Warning] 'GCP_PROJECT_ID' environment variable is not defined.")
        print("Please configure your terminal environment before running setup, e.g.:")
        print("  Windows PowerShell:  $env:GCP_PROJECT_ID='your-gcp-project'")
        print("  Linux / macOS:       export GCP_PROJECT_ID='your-gcp-project'\n")
        print("If you do not have a GCP project, you can skip this step and run other features locally.")
        return

    print(f"Target Project: {gcp_project}")
    print(f"Target Dataset: {dataset_name}")
    print(f"Target Table:   {table_name}")
    
    try:
        from google.cloud import bigquery
        from google.api_core.exceptions import Conflict
    except ImportError:
        print("\n[Setup Error] The 'google-cloud-bigquery' package is not installed.")
        print("Please install it in your virtual environment by running:")
        print("  pip install google-cloud-bigquery\n")
        return

    try:
        # Initialize the BigQuery client
        client = bigquery.Client(project=gcp_project)
        
        # 1. Create the dataset if not exists
        dataset_id = f"{gcp_project}.{dataset_name}"
        dataset = bigquery.Dataset(dataset_id)
        dataset.location = "US"  # Default location
        
        try:
            client.create_dataset(dataset, timeout=30)
            print(f"✓ Dataset '{dataset_name}' successfully created in project '{gcp_project}'.")
        except Conflict:
            print(f"✓ Dataset '{dataset_name}' already exists.")
        
        # 2. Define the schema based on telemetry.py fields
        schema = [
            bigquery.SchemaField("timestamp", "TIMESTAMP", mode="REQUIRED", description="ISO telemetry capture time"),
            bigquery.SchemaField("cpu_percent", "FLOAT", mode="REQUIRED", description="CPU utilization percentage"),
            bigquery.SchemaField("mem_percent", "FLOAT", mode="REQUIRED", description="System memory utilization percentage"),
            bigquery.SchemaField("disk_percent", "FLOAT", mode="REQUIRED", description="System drive disk space utilization percentage"),
            bigquery.SchemaField("gpu_available", "BOOLEAN", mode="REQUIRED", description="Indicates if active NVML/Nvidia GPU is active"),
            bigquery.SchemaField("gpu_name", "STRING", mode="NULLABLE", description="Name of the active discrete GPU"),
            bigquery.SchemaField("gpu_temp", "FLOAT", mode="NULLABLE", description="GPU core temperature in Celsius"),
            bigquery.SchemaField("gpu_utilization", "FLOAT", mode="NULLABLE", description="GPU core compute utilization percentage"),
            bigquery.SchemaField("gpu_vram_percent", "FLOAT", mode="NULLABLE", description="Dedicated VRAM utilization percentage"),
            bigquery.SchemaField("system_grade", "STRING", mode="REQUIRED", description="Overall workstation grade evaluate index"),
            bigquery.SchemaField("average_load_percent", "FLOAT", mode="REQUIRED", description="Workload average metrics")
        ]
        
        table_id = f"{dataset_id}.{table_name}"
        table = bigquery.Table(table_id, schema=schema)
        
        # Partition table by timestamp to optimize query costs
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY,
            field="timestamp"
        )
        
        try:
            client.create_table(table, timeout=30)
            print(f"✓ Table '{table_name}' successfully created with day partitioning.")
        except Conflict:
            print(f"✓ Table '{table_name}' already exists.")
            
        print("\n[Setup Success] BigQuery is ready for Kinetix telemetry ingestion!")
        print("To run the telemetry collector under PM2 with streaming enabled, run:")
        print(f"  $env:GCP_PROJECT_ID='{gcp_project}'; $env:SENTINEL_BIGQUERY_DATASET='{dataset_name}'; $env:SENTINEL_BIGQUERY_TABLE='{table_name}'; pm2 restart kinetix-telemetry")

    except Exception as e:
        print(f"\n[Setup Error] Failed to configure BigQuery: {e}")
        print("Please ensure your local environment is authenticated by running:")
        print("  gcloud auth application-default login")

if __name__ == "__main__":
    main()
