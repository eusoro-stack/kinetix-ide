// Kinetix IDE Console Frontend Bindings

let POLL_INTERVAL_METRICS = 2500;
let POLL_INTERVAL_PM2 = 5000;
let POLL_INTERVAL_OLLAMA = 10000;

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor(seconds % (3600*24) / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  
  let res = '';
  if (d > 0) res += `${d}d `;
  if (h > 0 || d > 0) res += `${h}h `;
  res += `${m}m`;
  return res;
}

let activeNode = 'mac';

function switchNode(node) {
  if (activeNode === node) return;
  activeNode = node;
  
  document.getElementById('tab-mac').classList.toggle('active', node === 'mac');
  document.getElementById('tab-alienware').classList.toggle('active', node === 'alienware');
  
  // Re-fetch metrics and PM2 lists immediately
  fetchMetrics();
  fetchPM2();
}

// Fetch System Telemetry Metrics
async function fetchMetrics() {
  try {
    const endpoint = activeNode === 'mac' ? '/api/metrics' : '/api/metrics/alienware';
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    // Update top header meta
    document.getElementById('meta-host').innerText = data.os_platform === 'win32' ? 'Kinetix Workstation' : 'Kinetix Core Node';
    
    const netIndicator = document.getElementById('meta-network');
    netIndicator.innerText = 'Connected';
    netIndicator.className = 'val status-indicator online';

    const gradeBadge = document.getElementById('meta-grade');
    gradeBadge.innerText = data.system_grade || 'A+';
    
    const colStatus = document.getElementById('collector-status');
    if (data.collector_active) {
      colStatus.innerText = 'Telemetry Active';
      colStatus.className = 'badge active';
    } else {
      colStatus.innerText = 'Daemon Offline';
      colStatus.className = 'badge warning';
    }

    // CPU Metrics
    document.getElementById('cpu-percent').innerText = `${Math.round(data.cpu.percent)}%`;
    document.getElementById('cpu-bar').style.width = `${data.cpu.percent}%`;
    document.getElementById('cpu-cores').innerText = `Cores: ${data.cpu.cores}`;
    document.getElementById('cpu-threads').innerText = `Threads: ${data.cpu.threads}`;

    // Render/Update CPU Core Grid
    const coreGrid = document.getElementById('cpu-core-grid');
    if (coreGrid && data.cpu.per_core_percent) {
      const pCores = data.cpu.p_cores || [];
      const eCores = data.cpu.e_cores || [];
      
      // If the number of cells doesn't match the threads, clear and rebuild
      if (coreGrid.children.length !== data.cpu.per_core_percent.length) {
        coreGrid.innerHTML = '';
        data.cpu.per_core_percent.forEach((pct, index) => {
          const isP = pCores.includes(index);
          const cell = document.createElement('div');
          cell.className = `core-cell ${isP ? 'p-core' : 'e-core'}`;
          cell.id = `core-cell-${index}`;
          cell.title = `Core ${index} (${isP ? 'P-Core' : 'E-Core'}): 0%`;
          cell.innerText = index;
          coreGrid.appendChild(cell);
        });
      }
      
      // Update core cells load value and classes
      data.cpu.per_core_percent.forEach((pct, index) => {
        const cell = document.getElementById(`core-cell-${index}`);
        if (cell) {
          const load = Math.round(pct);
          cell.title = `Core ${index} (${pCores.includes(index) ? 'P-Core' : 'E-Core'}): ${load}%`;
          if (load > 5) {
            cell.classList.add('active');
            const opacity = 0.12 + (load / 100) * 0.5;
            const accentColor = pCores.includes(index) ? '155, 81, 224' : '0, 242, 254';
            cell.style.background = `rgba(${accentColor}, ${opacity})`;
            cell.style.borderColor = `rgba(${accentColor}, ${0.3 + (load / 100) * 0.7})`;
          } else {
            cell.classList.remove('active');
            cell.style.background = '';
            cell.style.borderColor = '';
          }
        }
      });
    }

    // Render/Update Core Affinity Scheduler logs
    const affinityLog = document.getElementById('affinity-log-list');
    const affinityStatus = document.getElementById('affinity-status');
    if (affinityLog) {
      if (data.cpu.pinned_processes && data.cpu.pinned_processes.length > 0) {
        if (affinityStatus) {
          affinityStatus.innerText = 'Active';
          affinityStatus.className = 'badge active';
        }
        let logsHtml = '';
        data.cpu.pinned_processes.forEach(proc => {
          const coresFormatted = proc.cores.length > 4 
            ? `[${proc.cores[0]}-${proc.cores[proc.cores.length-1]}]`
            : `[${proc.cores.join(',')}]`;
            
          logsHtml += `
            <li class="affinity-log-item">
              <span class="proc-name" title="${proc.name}">${proc.name}</span>
              <div class="proc-meta">
                <span class="proc-type ${proc.type}">${proc.type}</span>
                <span class="proc-cores">${coresFormatted}</span>
              </div>
            </li>
          `;
        });
        affinityLog.innerHTML = logsHtml;
      } else {
        if (affinityStatus) {
          affinityStatus.innerText = 'Idle';
          affinityStatus.className = 'badge';
        }
        affinityLog.innerHTML = '<li class="empty-log" style="color:var(--text-muted);font-size:0.75rem;">No active processes pinned.</li>';
      }
    }

    // Memory Metrics
    document.getElementById('ram-percent').innerText = `${data.memory.percent}%`;
    document.getElementById('ram-bar').style.width = `${data.memory.percent}%`;
    document.getElementById('ram-used').innerText = formatBytes(data.memory.used_bytes);
    document.getElementById('ram-total').innerText = formatBytes(data.memory.total_bytes);

    // Disk Metrics
    document.getElementById('disk-percent').innerText = `${data.disk.percent}%`;
    document.getElementById('disk-bar').style.width = `${data.disk.percent}%`;
    document.getElementById('disk-used').innerText = formatBytes(data.disk.used_bytes);
    document.getElementById('disk-total').innerText = formatBytes(data.disk.total_bytes);

    // Footer stats
    document.getElementById('sys-uptime').innerText = formatUptime(data.uptime);
    document.getElementById('sys-platform').innerText = data.os_platform;

    // GPU Metrics Card
    const gpuInactiveMsg = document.getElementById('gpu-inactive-msg');
    const gpuDetails = document.getElementById('gpu-details');

    if (data.gpu && data.gpu.available) {
      gpuInactiveMsg.classList.add('hidden');
      gpuDetails.classList.remove('hidden');
      
      document.getElementById('gpu-status').innerText = 'Online';
      document.getElementById('gpu-status').className = 'badge active';
      document.getElementById('gpu-name').innerText = data.gpu.name;
      document.getElementById('gpu-util').innerText = `${data.gpu.utilization}%`;
      document.getElementById('gpu-vram-percent').innerText = `${data.gpu.vram.percent}%`;
      document.getElementById('gpu-temp').innerText = `${data.gpu.temperature}°C`;
      document.getElementById('gpu-vram-bytes').innerText = `${formatBytes(data.gpu.vram.used_bytes)} / ${formatBytes(data.gpu.vram.total_bytes)}`;
    } else {
      gpuDetails.classList.add('hidden');
      gpuInactiveMsg.classList.remove('hidden');
      document.getElementById('gpu-status').innerText = 'Inactive';
      document.getElementById('gpu-status').className = 'badge';
    }

  } catch (err) {
    console.error('Error fetching telemetry metrics:', err);
    const netIndicator = document.getElementById('meta-network');
    netIndicator.innerText = 'Disconnected';
    netIndicator.className = 'val status-indicator offline';
    document.getElementById('meta-grade').innerText = '-';
  }
}

// Fetch PM2 Processes
async function fetchPM2() {
  try {
    const endpoint = activeNode === 'mac' ? '/api/pm2' : '/api/pm2/alienware';
    const res = await fetch(endpoint);
    if (!res.ok) throw new Error('PM2 request failed');
    const data = await res.json();

    const statusBadge = document.getElementById('pm2-status');
    const pm2List = document.getElementById('pm2-list');

    if (data.pm2_active) {
      statusBadge.innerText = 'Active';
      statusBadge.className = 'badge active';
      
      if (!data.processes || data.processes.length === 0) {
        pm2List.innerHTML = '<tr><td colspan="5" class="empty-message">No PM2 processes active.</td></tr>';
        return;
      }

      let rowsHtml = '';
      data.processes.forEach(proc => {
        const isOnline = proc.status === 'online';
        const ramFormatted = formatBytes(proc.memory);
        const statusClass = isOnline ? 'status-online' : 'status-stopped';
        
        rowsHtml += `
          <tr>
            <td><strong>${proc.name}</strong><br><small style="color:var(--text-muted)">ID: ${proc.id} | PID: ${proc.pid || '-'}</small></td>
            <td>
              <span class="status-pill ${statusClass}">
                <span class="status-dot"></span>
                ${proc.status}
              </span>
            </td>
            <td>${proc.cpu}%</td>
            <td>${ramFormatted}</td>
            <td>
              <div class="action-group">
                ${isOnline ? `
                  <button class="action-btn btn-stop" title="Stop Process" onclick="controlPM2('stop', '${proc.id}')">
                    <svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                  </button>
                ` : `
                  <button class="action-btn btn-start" title="Start Process" onclick="controlPM2('start', '${proc.id}')">
                    <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  </button>
                `}
                <button class="action-btn" title="Restart Process" onclick="controlPM2('restart', '${proc.id}')">
                  <svg viewBox="0 0 24 24"><path d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      });
      pm2List.innerHTML = rowsHtml;

    } else {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge';
      pm2List.innerHTML = `<tr><td colspan="5" class="empty-message">${data.error || 'PM2 is offline.'}</td></tr>`;
    }
  } catch (err) {
    console.error('Error fetching PM2 info:', err);
  }
}

// PM2 Action Trigger
async function controlPM2(action, id) {
  try {
    const endpoint = activeNode === 'mac' ? '/api/pm2/control' : '/api/pm2/control/alienware';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, id })
    });
    
    if (res.ok) {
      fetchPM2();
    } else {
      const errData = await res.json();
      alert(`Process control error: ${errData.error || 'Server error'}`);
    }
  } catch (err) {
    console.error('Error controlling PM2:', err);
  }
}

// Fetch Ollama Status & Models
async function fetchOllama() {
  try {
    const res = await fetch('/api/ollama');
    if (!res.ok) throw new Error('Ollama request failed');
    const data = await res.json();

    const statusBadge = document.getElementById('ollama-status');
    const endpointText = document.getElementById('ollama-endpoint');
    const modelsContainer = document.getElementById('ollama-models');

    endpointText.innerText = data.endpoint;

    if (data.ollama_active) {
      statusBadge.innerText = 'Connected';
      statusBadge.className = 'badge active';

      if (!data.models || data.models.length === 0) {
        modelsContainer.innerHTML = '<div class="empty-message">No models cached. Pull models to get started.</div>';
        return;
      }

      let modelsHtml = '';
      data.models.forEach(model => {
        const sizeFormatted = model.size ? formatBytes(model.size) : 'Unknown size';
        modelsHtml += `
          <div class="model-item">
             <span class="m-name">${model.name}</span>
             <span class="m-size">${sizeFormatted}</span>
          </div>
        `;
      });
      modelsContainer.innerHTML = modelsHtml;

    } else {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge';
      modelsContainer.innerHTML = `<div class="empty-message" style="color:var(--accent-red)">${data.error || 'Gateway offline.'}</div>`;
    }
  } catch (err) {
    console.error('Error fetching Ollama config:', err);
  }
}

// Handle pulling a model
document.getElementById('pull-model-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const modelInput = document.getElementById('model-name-input');
  const pullBtn = document.getElementById('pull-btn');
  const statusMsg = document.getElementById('pull-status-message');
  
  const modelName = modelInput.value.trim();
  if (!modelName) return;

  modelInput.disabled = true;
  pullBtn.disabled = true;
  statusMsg.innerText = `Requesting pull for '${modelName}'...`;
  statusMsg.classList.remove('hidden');

  try {
    const res = await fetch('/api/ollama/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName })
    });

    if (res.ok) {
      statusMsg.innerText = `Model '${modelName}' successfully cached.`;
      statusMsg.style.color = 'var(--accent-green)';
      modelInput.value = '';
      setTimeout(() => {
        fetchOllama();
        statusMsg.classList.add('hidden');
        statusMsg.style.color = 'var(--accent-yellow)';
      }, 3000);
    } else {
      const errData = await res.json();
      statusMsg.innerText = `Pull failed: ${errData.error || 'Server error'}`;
      statusMsg.style.color = 'var(--accent-red)';
    }
  } catch (err) {
    statusMsg.innerText = `Connection error: ${err.message}`;
    statusMsg.style.color = 'var(--accent-red)';
  } finally {
    modelInput.disabled = false;
    pullBtn.disabled = false;
  }
});

// Load dynamic layout configuration and setup polling loops
async function initialize() {
  try {
    const res = await fetch('/api/layout');
    if (res.ok) {
      const config = await res.json();
      
      // Override polling intervals if present
      if (config.polling) {
        if (config.polling.metrics_interval_ms) {
          POLL_INTERVAL_METRICS = config.polling.metrics_interval_ms;
        }
        if (config.polling.pm2_interval_ms) {
          POLL_INTERVAL_PM2 = config.polling.pm2_interval_ms;
        }
        if (config.polling.ollama_interval_ms) {
          POLL_INTERVAL_OLLAMA = config.polling.ollama_interval_ms;
        }
      }
      
      // Apply primary styling from layout file if present
      if (config.theme && config.theme.primaryColor) {
        document.documentElement.style.setProperty('--accent-blue', config.theme.primaryColor);
      }
      if (config.theme && config.theme.secondaryColor) {
        document.documentElement.style.setProperty('--accent-purple', config.theme.secondaryColor);
      }
    }
  } catch (err) {
    console.warn('Could not load layout configuration file, using defaults:', err);
  }

  // Initial triggers
  fetchMetrics();
  fetchPM2();
  fetchOllama();
  
  // Audiophile Initial triggers
  pollRoon();
  loadHudSubProfiles();
  pollMeshStatus();

  // Polling loops
  setInterval(fetchMetrics, POLL_INTERVAL_METRICS);
  setInterval(fetchPM2, POLL_INTERVAL_PM2);
  setInterval(fetchOllama, POLL_INTERVAL_OLLAMA);
  
  // Audiophile Polling loops
  setInterval(pollRoon, 4000);
  setInterval(pollMeshStatus, 8000);
}

// ── AUDIOPHILE & MESH SYNC frontend bindings ─────────────────────────────────

let allHudSubProfiles = [];

async function pollRoon() {
  try {
    const res = await fetch('/api/roon/status');
    const data = await res.json();
    
    const statusBadge = document.getElementById('roon-status');
    if (data.connected) {
      statusBadge.innerText = 'Online';
      statusBadge.className = 'badge active';
    } else {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge';
    }
    
    if (data.now_playing) {
      const np = data.now_playing;
      document.getElementById('roon-title').textContent = np.title || '—';
      document.getElementById('roon-artist').textContent = np.artist || '—';
      document.getElementById('roon-album').textContent = np.album || '';
      
      const stateBadge = document.getElementById('roon-state');
      const s = np.state || 'stopped';
      stateBadge.textContent = s.charAt(0).toUpperCase() + s.slice(1);
      stateBadge.className = 'state-badge ' + s;
      
      const img = document.getElementById('roon-art');
      const placeholder = document.getElementById('roon-art-placeholder');
      if (np.image_key) {
        img.src = '/api/roon/image/' + np.image_key;
        img.style.display = 'block';
        placeholder.style.display = 'none';
      } else {
        img.style.display = 'none';
        placeholder.style.display = 'flex';
      }
    }
    
    if (data.volume != null) {
      document.getElementById('roon-volume-val').innerText = data.volume + '%';
      document.getElementById('roon-volume-slider').value = data.volume;
    }
    
    if (data.active_sub_profile !== undefined) {
      const select = document.getElementById('hud-sub-select');
      if (select.value !== data.active_sub_profile) {
        select.value = data.active_sub_profile || "";
        updateHudSubProfileDetails(data.active_sub_profile);
      }
    }
  } catch (err) {
    console.error('Failed to poll Roon:', err);
    document.getElementById('roon-status').innerText = 'Offline';
    document.getElementById('roon-status').className = 'badge';
  }
}

async function loadHudSubProfiles() {
  try {
    const res = await fetch('/api/roon/sub_profiles');
    const data = await res.json();
    allHudSubProfiles = data.profiles || [];
    
    const select = document.getElementById('hud-sub-select');
    select.innerHTML = '<option value="">None Selected</option>';
    
    allHudSubProfiles.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.friendly_name || p.name;
      select.appendChild(opt);
    });
    
    if (data.active) {
      select.value = data.active;
      updateHudSubProfileDetails(data.active);
    }
  } catch (err) {
    console.error('Failed to load subwoofer profiles:', err);
  }
}

function updateHudSubProfileDetails(name) {
  const detailsDiv = document.getElementById('hud-sub-details');
  if (!name) {
    detailsDiv.style.display = 'none';
    return;
  }
  
  const p = allHudSubProfiles.find(x => x.name === name);
  if (!p) {
    detailsDiv.style.display = 'none';
    return;
  }
  
  document.getElementById('hud-sub-crossover').textContent = p.crossover_freq != null ? p.crossover_freq + ' Hz' : '—';
  document.getElementById('hud-sub-boost').textContent = p.deep_bass_boost_level != null ? p.deep_bass_boost_level + ' dB' : '—';
  document.getElementById('hud-sub-gain').textContent = p.room_gain_level != null ? p.room_gain_level + ' dB' : '—';
  
  detailsDiv.style.display = 'block';
  
  setTimeout(drawHudEQCurve, 50);
}

async function selectHudSubProfile(name) {
  updateHudSubProfileDetails(name);
  try {
    const res = await fetch('/api/roon/select_sub_profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: name })
    });
    const d = await res.json();
    if (d.eq_synced) {
      logConsole("System", `Successfully synced Subwoofer profile '${name}' and activated MUSE EQ Presets!`);
    } else if (name) {
      logConsole("System", `Warning: Selected profile '${name}' but MUSE EQ Sync failed: ${d.eq_error || 'No matching preset found'}`);
    }
  } catch (err) {
    console.error(err);
  }
}

function previewRoonVol(v) {
  document.getElementById('roon-volume-val').innerText = v + '%';
}

async function setRoonVol(level) {
  previewRoonVol(level);
  try {
    await fetch('/api/roon/volume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level: +level })
    });
  } catch (err) {
    console.error(err);
  }
}

async function pbRoon(action) {
  try {
    await fetch('/api/roon/playback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    setTimeout(pollRoon, 700);
  } catch (err) {
    console.error(err);
  }
}

function drawHudEQCurve() {
  const canvas = document.getElementById('hud-eq-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#06070c';
  ctx.fillRect(0, 0, w, h);
  
  const freqs = [20, 30, 40, 50, 60, 70, 80, 90, 100, 120, 150, 200];
  const logMin = Math.log10(20);
  const logMax = Math.log10(200);
  
  function getX(f) {
    return ((Math.log10(f) - logMin) / (logMax - logMin)) * w;
  }
  
  function getY(db) {
    return h - ((db - -7) / 8) * h;
  }
  
  // Draw Grid Lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
  ctx.lineWidth = 1;
  freqs.forEach(f => {
    const x = getX(f);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  });
  
  const dbs = [0, -3, -6];
  dbs.forEach(db => {
    const y = getY(db);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  });
  
  // EQ Peaking filter equation calculations (B1: 62Hz -3.5dB Q4, B2: 95Hz -4dB Q5)
  function getResponse(f) {
    const h1 = -3.5 / (1 + Math.pow(4.0 * (f / 62 - 62 / f), 2));
    const h2 = -4.0 / (1 + Math.pow(5.0 * (f / 95 - 95 / f), 2));
    return h1 + h2;
  }
  
  ctx.strokeStyle = 'var(--accent-blue)';
  ctx.lineWidth = 2;
  ctx.shadowColor = 'var(--accent-blue)';
  ctx.shadowBlur = 4;
  
  ctx.beginPath();
  let first = true;
  for (let x = 0; x < w; x++) {
    const pct = x / w;
    const f = Math.pow(10, logMin + pct * (logMax - logMin));
    const y = getY(getResponse(f));
    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.shadowBlur = 0;
}

async function pollMeshStatus() {
  try {
    const res = await fetch('/api/system/status');
    const data = await res.json();
    
    const container = document.getElementById('mesh-nodes-list');
    if (!container) return;
    
    let html = '';
    Object.keys(data).forEach(key => {
      const node = data[key];
      const onlineClass = node.online ? 'online' : 'offline';
      const statusText = node.online ? 'Online' : 'Offline';
      
      let details = [];
      if (node.ssh) details.push('SSH');
      if (node.roon) details.push(key === 'mac' ? 'Panel API' : 'Roon Core');
      const detailsStr = details.length > 0 ? ` [${details.join(', ')}]` : '';

      html += `
        <div class="mesh-node-item">
          <div class="mesh-node-info">
            <span class="mesh-node-name">${node.name}</span>
            <span class="mesh-node-ip">${node.ip}${detailsStr}</span>
          </div>
          <span class="mesh-node-status ${onlineClass}">
            <span class="status-dot"></span>
            ${statusText}
          </span>
        </div>
      `;
    });
    
    container.innerHTML = html;
  } catch (err) {
    console.error('Failed to poll mesh status:', err);
  }
}

async function triggerAutomation(type) {
  const btnSyncCal = document.getElementById('btn-sync-cal');
  const btnSyncProj = document.getElementById('btn-sync-proj');
  const logElem = document.getElementById('console-log');
  
  btnSyncCal.disabled = true;
  btnSyncProj.disabled = true;
  
  const scriptName = type === 'sync_calibration' ? 'sync_calibration.sh' : 'sync_projects.sh';
  logConsole("Executor", `Launching script: ${scriptName} ...`);
  
  try {
    const res = await fetch(`/api/system/${type}`, { method: 'POST' });
    const data = await res.json();
    
    logConsole("stdout", data.output);
    if (data.success) {
      logConsole("Executor", `Script ${scriptName} completed successfully!`);
    } else {
      logConsole("Executor", `Script ${scriptName} failed with error.`);
    }
  } catch (err) {
    logConsole("Executor", `Communication error: ${err.message}`);
  } finally {
    btnSyncCal.disabled = false;
    btnSyncProj.disabled = false;
    pollMeshStatus();
  }
}

function logConsole(sender, message) {
  const logElem = document.getElementById('console-log');
  const timestamp = new Date().toLocaleTimeString();
  
  // Format message to strip escape sequences (like \033 colors)
  const cleanMsg = message.replace(/\033\[[0-9;]*m/g, '');
  
  const logLine = `[${timestamp}] [${sender}] ${cleanMsg}\n`;
  if (logElem.innerText === "Ready for action. Click a sync button above." || logElem.innerText.startsWith("Ready")) {
    logElem.innerText = logLine;
  } else {
    logElem.innerText += logLine;
  }
  
  // Scroll to bottom
  const container = logElem.parentElement;
  container.scrollTop = container.scrollHeight;
}

function clearConsoleLog() {
  document.getElementById('console-log').innerText = "Ready for action. Click a sync button above.";
}

// Bind to window to allow HTML button handlers to call them
window.switchNode = switchNode;
window.previewRoonVol = previewRoonVol;
window.setRoonVol = setRoonVol;
window.pbRoon = pbRoon;
window.selectHudSubProfile = selectHudSubProfile;
window.triggerAutomation = triggerAutomation;
window.clearConsoleLog = clearConsoleLog;

window.controlPM2 = controlPM2;

// Launch application
initialize();

