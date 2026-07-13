#!/usr/bin/env python3
import os
import sys
import json
import time
import math
import argparse
import urllib.request
from datetime import datetime

# Path Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCUMENTS_DIR = os.path.join(BASE_DIR, "documents")
STORE_PATH = os.path.join(BASE_DIR, "scripts", "vector_store.json")

# Ensure directories exist
os.makedirs(DOCUMENTS_DIR, exist_ok=True)

# Generate a sample document if empty
sample_doc_path = os.path.join(DOCUMENTS_DIR, "kinetix_info.txt")
if not os.listdir(DOCUMENTS_DIR):
    with open(sample_doc_path, "w", encoding="utf-8") as f:
        f.write(
            "Kinetix IDE is a high-performance workstation orchestrator designed by Enefiok Usoro.\n"
            "It decouples telemetry monitoring, process execution, and system-level thread schedules.\n"
            "Performance Cores (P-Cores) are mapped to cores 0-15 and handle heavy tasks like LLM inference.\n"
            "Efficient Cores (E-Cores) are mapped to cores 16-23 and handle background sync and telemetry gathering.\n"
            "The network challenger module tests connectivity across local and Tailscale VPN interfaces.\n"
        )
    print(f"[RAG Setup] Created sample document at {sample_doc_path}")

def parse_args():
    parser = argparse.ArgumentParser(description="Local Vector RAG embedding synchronizer and query engine")
    parser.add_argument("--watch", action="store_true", help="Watch documents folder for updates continuously")
    parser.add_argument("--interval", type=int, default=15, help="Scan interval in seconds")
    parser.add_argument("--query", type=str, default="", help="Query the local document vector index")
    parser.add_argument("--llm", type=str, default="phi4", help="Inference model to answer query (e.g. phi4, llama3.1)")
    return parser.parse_args()

def fetch_embedding(text, model="nomic-embed-text"):
    url = "http://127.0.0.1:11434/api/embeddings"
    data = json.dumps({"model": model, "prompt": text}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res = json.loads(response.read().decode("utf-8"))
            return res.get("embedding")
    except Exception as e:
        # Fallback to /api/embed
        try:
            url_alt = "http://127.0.0.1:11434/api/embed"
            data_alt = json.dumps({"model": model, "input": text}).encode("utf-8")
            req_alt = urllib.request.Request(url_alt, data=data_alt, headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req_alt, timeout=30) as response:
                res = json.loads(response.read().decode("utf-8"))
                embeddings = res.get("embeddings")
                if embeddings and len(embeddings) > 0:
                    return embeddings[0]
        except Exception as e2:
            print(f"[RAG Error] Embedding fetch failed: {e2}")
        return None

def fetch_llm_response(prompt, context, model="phi4"):
    url = "http://127.0.0.1:11434/api/generate"
    full_prompt = (
        f"You are the Kinetix Core AI Assistant. Answer the query contextually using the provided info.\n\n"
        f"Context:\n{context}\n\n"
        f"Query: {prompt}\n\n"
        f"Response:"
    )
    data = json.dumps({"model": model, "prompt": full_prompt, "stream": False}).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            res = json.loads(response.read().decode("utf-8"))
            return res.get("response")
    except Exception as e:
        return f"LLM generation failed: {e}"

def cosine_similarity(v1, v2):
    dot = sum(x * y for x, y in zip(v1, v2))
    mag1 = math.sqrt(sum(x * x for x in v1))
    mag2 = math.sqrt(sum(x * x for x in v2))
    return dot / (mag1 * mag2) if mag1 > 0 and mag2 > 0 else 0.0

def load_store():
    if os.path.exists(STORE_PATH):
        try:
            with open(STORE_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def save_store(store):
    try:
        with open(STORE_PATH, "w", encoding="utf-8") as f:
            json.dump(store, f, indent=2)
    except Exception as e:
        print(f"[RAG Error] Failed to write vector store: {e}")

def run_sync():
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    store = load_store()
    updated = False
    
    files = [f for f in os.listdir(DOCUMENTS_DIR) if f.endswith(".txt")]
    
    if not files:
        print(f"[{timestamp}] Embedding sync check: No documents found in {DOCUMENTS_DIR}")
        return
        
    print(f"[{timestamp}] Checking {len(files)} documents for modified files...")
    
    for filename in files:
        filepath = os.path.join(DOCUMENTS_DIR, filename)
        mtime = os.path.getmtime(filepath)
        
        # Check if modified since last embed
        if filename not in store or store[filename]["mtime"] < mtime:
            print(f"[{timestamp}] Indexing new/modified document: {filename}")
            try:
                with open(filepath, "r", encoding="utf-8") as f:
                    content = f.read().strip()
                
                # Split content into paragraphs/lines
                chunks = [p.strip() for p in content.split("\n") if len(p.strip()) > 10]
                
                vector_chunks = []
                for chunk in chunks:
                    emb = fetch_embedding(chunk)
                    if emb:
                        vector_chunks.append({"text": chunk, "embedding": emb})
                        
                store[filename] = {
                    "mtime": mtime,
                    "chunks": vector_chunks
                }
                updated = True
                print(f"[{timestamp}] Successfully indexed {len(vector_chunks)} chunks for {filename}")
            except Exception as e:
                print(f"[RAG Error] Failed to process {filename}: {e}")
                
    if updated:
        save_store(store)
        print(f"[{timestamp}] Vector store index updated and saved.")
    else:
        print(f"[{timestamp}] Embedding status: Vector DB is fully synchronized (0 pending updates).")

def handle_query(query, model):
    print(f"\n[RAG Query] Initiating vector search for: '{query}'")
    query_vector = fetch_embedding(query)
    if not query_vector:
        print("[RAG Error] Failed to compute query embedding.")
        return
        
    store = load_store()
    matches = []
    
    for filename, file_data in store.items():
        for chunk in file_data.get("chunks", []):
            sim = cosine_similarity(query_vector, chunk["embedding"])
            matches.append((sim, chunk["text"], filename))
            
    # Sort matches by similarity score descending
    matches.sort(key=lambda x: x[0], reverse=True)
    
    if not matches or matches[0][0] < 0.35:
        print("[RAG Search] No strong matches found. Querying LLM directly with no context.")
        context = "No specific document context available."
    else:
        # Retrieve top 3 matches as context
        top_matches = matches[:3]
        print(f"[RAG Search] Found {len(top_matches)} context chunks:")
        for score, text, source in top_matches:
            print(f" - [{source}] (Score: {score:.3f}): {text[:60]}...")
            
        context = "\n".join([f"- {text} (Source: {source})" for score, text, source in top_matches])
        
    response = fetch_llm_response(query, context, model=model)
    print("\n" + "="*50)
    print(f"KINETIX CORE RESPONDER ({model})")
    print("="*50)
    print(response)
    print("="*50 + "\n")

def main():
    args = parse_args()
    
    if args.query:
        # Perform single query run
        handle_query(args.query, args.llm)
    elif args.watch:
        print("--- Kinetix IDE: Background RAG Embedding Synchronizer Active ---")
        print(f"Watching folder: {DOCUMENTS_DIR}")
        print("Polling local changes every 15s...")
        while True:
            try:
                run_sync()
            except KeyboardInterrupt:
                print("Stopping background synchronizer.")
                break
            except Exception as e:
                print(f"Error in embedding sync loop: {e}", file=sys.stderr)
            time.sleep(args.interval)
    else:
        # Run single sync
        print("--- Kinetix IDE: Single-run RAG Ingestion ---")
        run_sync()

if __name__ == "__main__":
    main()
