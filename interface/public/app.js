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

// Fetch System Telemetry Metrics
async function fetchMetrics() {
  try {
    const res = await fetch('/api/metrics');
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
    const res = await fetch('/api/pm2');
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
    const res = await fetch('/api/pm2/control', {
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

  // Polling loops
  setInterval(fetchMetrics, POLL_INTERVAL_METRICS);
  setInterval(fetchPM2, POLL_INTERVAL_PM2);
  setInterval(fetchOllama, POLL_INTERVAL_OLLAMA);
}

window.controlPM2 = controlPM2;

// Launch application
initialize();
