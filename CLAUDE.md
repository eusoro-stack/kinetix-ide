# Kinetix IDE — Project Guide

## What this is
A local "workstation orchestration" dashboard for AI development. A Node/Express
console (`interface/`) shows live CPU/RAM/GPU telemetry, lets you start/stop PM2
processes, talk to a local Ollama instance, and run ops scripts. A Python
collector (`telemetry.py`) writes `telemetry_node.json`, which the console reads.
Everything is managed by PM2 via `core/ecosystem.config.js`. Public repo, MIT.

## Key commands
```bash
# Setup — macOS/Linux (creates .venv, installs pm2 + npm deps, copies .env)
./core/setup.sh
./scripts/init_node.sh            # optional: UV_THREADPOOL_SIZE + V8 heap tuning

# Setup — Windows (PowerShell)
Set-ExecutionPolicy Bypass -Scope Process -Force
.\core\setup.ps1
.\scripts\init_node.ps1

# Start the console only (no PM2)
cd interface && npm install && npm start      # http://localhost:3000

# Full stack via PM2 (console, telemetry, rag-sync, media-bridge, health-check)
pm2 start core/ecosystem.config.js
pm2 status / pm2 logs / pm2 restart <name> / pm2 stop all
```
No test or lint scripts exist in `interface/package.json` — only `start`.

## Project structure
- `core/` — `setup.sh` / `setup.ps1` installers, `ecosystem.config.js` (PM2 app definitions)
- `interface/` — `server.js` (Express API, ~1600 lines, all routes), `public/` (dashboard HTML/CSS/JS), `dashboard_layout.json`
- `scripts/` — Python/shell helpers run by PM2 or the Ops Hub (health check, RAG worker, stress test, BigQuery setup)
- `telemetry.py` — root-level GPU/CPU collector (pynvml, falls back to nvidia-smi)
- `docs/` — `System_Manual.md`, `Quality_Assurance_Audit.md`, plus a static landing page (`index.html`, `landing.css`)
- `presentation/` — slide deck (`index.html`, `slides/*.png`, `make_video.py`); served by the console at `/presentation`
- `documents/` — small text files read by the console's Ops Hub (see Secrets)
- `config/` — `.env.example` only; the real `.env` lives at the repo root

## Gotchas
- The setup scripts copy `config/.env.example` to **root** `.env` (not `config/.env`). `server.js` loads `../.env` relative to `interface/`.
- `server.js` also searches sibling folders for keys (`../Telegram-Bot/.env`, `../revoice/.env`, `../.env`). Behaviour depends on what sits next to this repo on the owner's machine.
- `ecosystem.config.js` launches `kinetix-media-bridge` from `~/Documents/roon-myclaw`. That app will fail on a machine without that sibling repo.
- `GET /api/ops/vault` returns the contents of `documents/vault_code.txt` to anyone who can reach the server, and the server binds `0.0.0.0`. Treat the console as LAN/Tailscale-only.
- `/api/image/generate` writes files into `interface/public/generated/`; those files are currently committed to git.
- Python deps are installed into `.venv` (gitignored); PM2 picks the venv interpreter automatically.
- `telemetry.py` only streams to BigQuery when `GCP_PROJECT_ID` is set.

## Secrets
Never commit values. Env var names from `config/.env.example`:
`PORT`, `OLLAMA_HOST`, `GCP_PROJECT_ID`, `SENTINEL_BIGQUERY_DATASET`,
`SENTINEL_BIGQUERY_TABLE`, `ACTIVE_BILLING_TARGET`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_ALLOWED_USER_ID`. `server.js` also reads `GEMINI_API_KEY` if present.
`documents/vault_code.txt` and `documents/kinetix_info.txt` exist in the repo and
must be reviewed for sensitivity before any public sharing. Do not open or quote them.

## Related projects
Sibling repos by the same owner: uso-command, model-gauntlet, roon-myclaw, breathefirst-app, revoice, tadbot.
