# Kinetix IDE: Quality Assurance Audit

This document is a formal checkout list to ensure that your workstation deployment of the **Kinetix IDE** matches the performance, resilience, and security parameters of our certified benchmark standard.

---

## 🛡️ Checklist Verification Items

### 1. Security & Parity
- [ ] **Credential Sanitization:** Verify that no personal API keys, database credentials, or system paths are present in `.env` or configuration JSON files.
- [ ] **GCP Connectivity:** Confirm that if `GCP_PROJECT_ID` is set, BigQuery permissions allow streaming to the configured destination table.

### 2. Infrastructure Resilience
- [ ] **PM2 Persistence:** Run `pm2 status` to verify that `kinetix-console`, `kinetix-telemetry`, and `kinetix-rag-sync` are active.
- [ ] **Auto-Restart:** Test process crashes using `pm2 restart <id>` or termination hooks and confirm they restart automatically under 1.5 seconds.
- [ ] **V8 Garbage Collector:** Confirm memory heap limit override (`--max-old-space-size=8192`) is active inside the environment options.

### 3. Visual Parity & Interactivity
- [ ] **Glassmorphic Styling:** Open `http://localhost:3000` and confirm the design rendered matches the premium dark-mode theme.
- [ ] **Action Triggering:** Test stopping and restarting PM2 processes directly from the UI console and ensure it executes successfully.
- [ ] **Gateway Model Pulling:** Request a model pull (e.g., `llama3.2`) from the UI and verify that download feedback displays properly.

### 4. Throughput Stress-Testing
- [ ] **Baseline Latency:** Execute `.\scripts\test_concurrency.ps1` (or `./scripts/test_concurrency.sh`) and verify average response times are below **120ms**.
- [ ] **Node Rating:** Confirm the benchmark output yields a **Node Rank A+ (Optimal Performance)** evaluation rank.
