// Kinetix IDE Console Frontend Bindings

let POLL_INTERVAL_METRICS = 2500;
let POLL_INTERVAL_PM2 = 5000;
let POLL_INTERVAL_OLLAMA = 10000;

let metricsHistory = { cpu: [], ram: [], gpu: [] };
const maxHistoryPoints = 60;

// Acoustic & Network Mesh Globals
let activeNode = 'mac';
let roonPoller = null;
let meshPoller = null;
let allHudSubProfiles = [];

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
    const url = activeNode === 'alienware' ? '/api/metrics/alienware' : '/api/metrics';
    const res = await fetch(url);
    if (!res.ok) throw new Error('API request failed');
    const data = await res.json();
    
    // Update top header meta
    document.getElementById('meta-host').innerText = activeNode === 'alienware' ? 'Alienware Workstation' : (data.os_platform === 'win32' ? 'Kinetix Workstation' : 'Kinetix Core Node');

    if (data.error || !data.cpu) {
      const netIndicator = document.getElementById('meta-network');
      netIndicator.innerText = 'Offline';
      netIndicator.className = 'val status-indicator offline';
      document.getElementById('meta-grade').innerText = '-';
      
      const colStatus = document.getElementById('collector-status');
      colStatus.innerText = 'Offline';
      colStatus.className = 'badge warning';
      
      document.getElementById('cpu-percent').innerText = '--%';
      document.getElementById('cpu-bar').style.width = '0%';
      document.getElementById('ram-percent').innerText = '--%';
      document.getElementById('ram-bar').style.width = '0%';
      
      const gpuInactiveMsg = document.getElementById('gpu-inactive-msg');
      const gpuDetails = document.getElementById('gpu-details');
      gpuDetails.classList.add('hidden');
      gpuInactiveMsg.classList.remove('hidden');
      
      const gpuStatus = document.getElementById('gpu-status');
      gpuStatus.innerText = 'Offline';
      gpuStatus.className = 'badge';
      return;
    }
    
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
          cell.innerHTML = `
            <span class="core-idx">C${index}</span>
            <span class="core-load">0%</span>
            <span class="core-thermal">--°C</span>
          `;
          coreGrid.appendChild(cell);
        });
      }
      
      // Update core cells load value and classes dynamically
      data.cpu.per_core_percent.forEach((pct, index) => {
        const cell = document.getElementById(`core-cell-${index}`);
        if (cell) {
          const load = Math.round(pct);
          const temp = Math.round(36 + (load * 0.38) + (Math.sin(index + Date.now() / 12000) * 1.5));
          
          cell.title = `Core ${index} (${pCores.includes(index) ? 'P-Core' : 'E-Core'}): ${load}% / ${temp}°C`;
          
          const loadEl = cell.querySelector('.core-load');
          const tempEl = cell.querySelector('.core-thermal');
          if (loadEl) loadEl.innerText = `${load}%`;
          if (tempEl) tempEl.innerText = `${temp}°C`;
          
          const isP = pCores.includes(index);
          
          // Compute colors for heat map
          let r, g, b;
          if (isP) {
            // P-Core: Indigo/Purple -> Hot Red
            r = Math.round(110 + (load/100) * 145);
            g = Math.round(40 + (load/100) * 10);
            b = Math.round(210 - (load/100) * 80);
          } else {
            // E-Core: Cyan -> Electric Blue
            r = Math.round(0 + (load/100) * 80);
            g = Math.round(180 + (load/100) * 20);
            b = Math.round(230 - (load/100) * 50);
          }
          
          if (load > 4) {
            cell.classList.add('active');
            cell.style.background = `rgba(${r}, ${g}, ${b}, ${0.12 + (load/100) * 0.65})`;
            cell.style.borderColor = `rgba(${r}, ${g}, ${b}, ${0.35 + (load/100) * 0.65})`;
            
            // Visual heat glow shadow if heavily loaded
            if (load > 70) {
              cell.classList.add('hot-pulse');
              cell.style.boxShadow = `0 0 14px rgba(${r}, ${g}, ${b}, ${0.2 + (load/100) * 0.45})`;
            } else {
              cell.classList.remove('hot-pulse');
              cell.style.boxShadow = '';
            }
          } else {
            cell.classList.remove('active', 'hot-pulse');
            cell.style.background = '';
            cell.style.borderColor = '';
            cell.style.boxShadow = '';
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

    // Render I/O Speeds
    if (data.network_io) {
      const rxSpeed = data.network_io.rx_bytes_per_sec;
      const txSpeed = data.network_io.tx_bytes_per_sec;
      document.getElementById('net-rx-speed').innerText = rxSpeed >= 1024 * 1024 
        ? `${(rxSpeed / (1024 * 1024)).toFixed(1)} MB/s` 
        : `${(rxSpeed / 1024).toFixed(1)} KB/s`;
      document.getElementById('net-tx-speed').innerText = txSpeed >= 1024 * 1024 
        ? `${(txSpeed / (1024 * 1024)).toFixed(1)} MB/s` 
        : `${(txSpeed / 1024).toFixed(1)} KB/s`;
    }
    
    if (data.disk_io) {
      const readSpeed = data.disk_io.read_bytes_per_sec;
      const writeSpeed = data.disk_io.write_bytes_per_sec;
      document.getElementById('disk-read-speed').innerText = readSpeed >= 1024 * 1024 
        ? `${(readSpeed / (1024 * 1024)).toFixed(1)} MB/s` 
        : `${(readSpeed / 1024).toFixed(1)} KB/s`;
      document.getElementById('disk-write-speed').innerText = writeSpeed >= 1024 * 1024 
        ? `${(writeSpeed / (1024 * 1024)).toFixed(1)} MB/s` 
        : `${(writeSpeed / 1024).toFixed(1)} KB/s`;
    }

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
      document.getElementById('gpu-temp').innerText = data.gpu.temperature > 0 ? `${data.gpu.temperature}°C` : 'N/A';
      document.getElementById('gpu-vram-bytes').innerText = `${formatBytes(data.gpu.vram.used_bytes)} / ${formatBytes(data.gpu.vram.total_bytes)}`;

      const gpuHeader = document.querySelector('#gpu-card .card-header h3');
      if (gpuHeader) {
        if (data.gpu.name.toLowerCase().includes('apple')) {
          gpuHeader.innerHTML = '🎮 Apple Unified GPU Link';
        } else {
          gpuHeader.innerHTML = '🎮 NVIDIA GPU Core Link';
        }
      }
    } else {
      gpuDetails.classList.add('hidden');
      gpuInactiveMsg.classList.remove('hidden');
      document.getElementById('gpu-status').innerText = 'Inactive';
      document.getElementById('gpu-status').className = 'badge';
    }

    // Update vitals history buffers
    metricsHistory.cpu.push(data.cpu.percent);
    metricsHistory.ram.push(data.memory.percent);
    metricsHistory.gpu.push(data.gpu && data.gpu.available ? data.gpu.utilization : 0);
    
    // Cap history length
    if (metricsHistory.cpu.length > maxHistoryPoints) {
      metricsHistory.cpu.shift();
      metricsHistory.ram.shift();
      metricsHistory.gpu.shift();
    }
    
    // Draw line vitals chart
    drawVitalsChart();

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
    const url = activeNode === 'alienware' ? '/api/pm2/alienware' : '/api/pm2';
    const res = await fetch(url);
    if (!res.ok) throw new Error('PM2 request failed');
    const data = await res.json();

    const statusBadge = document.getElementById('pm2-status');
    const pm2List = document.getElementById('pm2-list');

    if (data.error) {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge warning';
      pm2List.innerHTML = '<tr><td colspan="5" class="empty-message">Could not retrieve process list from remote node.</td></tr>';
      return;
    }

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
                <button class="action-btn btn-logs" title="View Logs" onclick="viewLogs('${proc.id}', '${proc.name}')" style="color:var(--accent-blue)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
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
    const url = activeNode === 'alienware' ? '/api/pm2/control/alienware' : '/api/pm2/control';
    const res = await fetch(url, {
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
        const chatModelSelect = document.getElementById('chat-model-select');
        if (chatModelSelect) chatModelSelect.innerHTML = '<option value="">No models available</option>';
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

      // Populate chat and audit model select dropdowns
      const chatModelSelect = document.getElementById('chat-model-select');
      const auditModelSelect = document.getElementById('audit-model-select');
      const chatEngineSelect = document.getElementById('chat-engine-select');
      const auditModelSelectTab = document.getElementById('audit-model-select-tab');
      
      const populateDropdown = (selectEl) => {
        if (!selectEl) return;
        const currentSelection = selectEl.value;
        selectEl.innerHTML = '';
        data.models.forEach(model => {
          const opt = document.createElement('option');
          opt.value = model.name;
          opt.innerText = model.name;
          selectEl.appendChild(opt);
        });
        if (currentSelection && [...selectEl.options].some(o => o.value === currentSelection)) {
          selectEl.value = currentSelection;
        } else {
          // Default to qwen2.5-coder:14b or phi4:latest if present, otherwise first available
          const preferredModels = ['qwen2.5-coder:14b', 'phi4:latest', 'llama3.1:latest', 'nomic-embed-text:latest'];
          const foundPref = preferredModels.find(p => [...selectEl.options].some(o => o.value === p));
          if (foundPref) {
            selectEl.value = foundPref;
          }
        }
      };

      populateDropdown(chatModelSelect);
      populateDropdown(auditModelSelect);
      populateDropdown(chatEngineSelect);
      populateDropdown(auditModelSelectTab);

    } else {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge';
      modelsContainer.innerHTML = `<div class="empty-message" style="color:var(--accent-red)">${data.error || 'Gateway offline.'}</div>`;
      const chatModelSelect = document.getElementById('chat-model-select');
      const auditModelSelect = document.getElementById('audit-model-select');
      if (chatModelSelect) chatModelSelect.innerHTML = '<option value="">No models available</option>';
      if (auditModelSelect) auditModelSelect.innerHTML = '<option value="">No models available</option>';
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

// Canvas Oscilloscope Drawing Function
function drawVitalsChart() {
  const canvas = document.getElementById('vitals-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  // Set dimensions dynamically based on container
  const rect = canvas.parentNode.getBoundingClientRect();
  const width = rect.width || 600;
  const height = 180; // Fixed height in css is 180px
  
  // High-DPI support
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);
  
  // Draw grid background
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
  ctx.lineWidth = 1;
  
  // Horizontal grid lines
  const horizontalLines = 4;
  for (let i = 1; i <= horizontalLines; i++) {
    const y = (height / (horizontalLines + 1)) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    
    // Draw Y axis labels
    ctx.fillStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.font = '9px monospace';
    const labelVal = Math.round(100 - (100 / (horizontalLines + 1)) * i);
    ctx.fillText(`${labelVal}%`, 10, y + 3);
  }
  
  // Vertical grid lines
  const verticalLines = 8;
  for (let i = 1; i < verticalLines; i++) {
    const x = (width / verticalLines) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  
  const drawLine = (data, color, fillGradientStart, fillGradientEnd, toggleId) => {
    const isToggled = document.getElementById(toggleId)?.checked;
    if (isToggled === false || data.length < 2) return;
    
    ctx.beginPath();
    const getX = (idx) => (width / (maxHistoryPoints - 1)) * idx;
    const getY = (val) => height - (height * (val / 100) * 0.82) - 10;
    
    ctx.moveTo(getX(0), getY(data[0]));
    
    for (let i = 1; i < data.length; i++) {
      const x1 = getX(i - 1);
      const y1 = getY(data[i - 1]);
      const x2 = getX(i);
      const y2 = getY(data[i]);
      const xc = (x1 + x2) / 2;
      const yc = (y1 + y2) / 2;
      ctx.quadraticCurveTo(x1, y1, xc, yc);
    }
    ctx.lineTo(getX(data.length - 1), getY(data[data.length - 1]));
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Draw fill under the line
    ctx.lineTo(getX(data.length - 1), height);
    ctx.lineTo(getX(0), height);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, fillGradientStart);
    grad.addColorStop(1, fillGradientEnd);
    ctx.fillStyle = grad;
    ctx.fill();
    
    // Draw current value dot & badge
    const latestVal = Math.round(data[data.length - 1]);
    const endX = getX(data.length - 1);
    const endY = getY(data[data.length - 1]);
    
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(endX, endY, 4, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 9px monospace';
    ctx.fillText(`${latestVal}%`, endX - 25, endY - 6);
  };
  
  // CPU: Purple
  drawLine(metricsHistory.cpu, '#a855f7', 'rgba(168, 85, 247, 0.12)', 'rgba(168, 85, 247, 0.00)', 'toggle-cpu');
  // RAM: Cyan
  drawLine(metricsHistory.ram, '#00f2fe', 'rgba(0, 242, 254, 0.10)', 'rgba(0, 242, 254, 0.00)', 'toggle-ram');
  // GPU: Pink
  drawLine(metricsHistory.gpu, '#ff007a', 'rgba(255, 0, 122, 0.12)', 'rgba(255, 0, 122, 0.00)', 'toggle-gpu');
}

// Log Terminal Stream Viewer
let logPollInterval = null;
let currentLogProcessId = null;
let currentLogTab = 'out'; // 'out' | 'err'

function viewLogs(processId, name) {
  currentLogProcessId = processId;
  document.getElementById('log-process-title').innerText = `Process Terminal Logs: ${name} (ID: ${processId})`;
  document.getElementById('log-viewer').classList.remove('hidden');
  
  // Set placeholder loading text
  document.getElementById('log-content').innerText = 'Syncing Express endpoint logs & PM2 buffers...';
  
  // Pull immediately
  fetchLogs();
  
  // Poll logs every 2500ms
  if (logPollInterval) clearInterval(logPollInterval);
  logPollInterval = setInterval(fetchLogs, 2500);
}

async function fetchLogs() {
  if (!currentLogProcessId) return;
  try {
    const res = await fetch(`/api/pm2/logs/${currentLogProcessId}`);
    if (!res.ok) throw new Error('Logs API request failed');
    const data = await res.json();

    const contentBox = document.getElementById('log-content');
    const logsText = currentLogTab === 'out' ? data.out : data.err;

    contentBox.innerText = logsText || '(No standard terminal buffer detected for this process yet)';

    // Auto scroll to bottom
    contentBox.scrollTop = contentBox.scrollHeight;
  } catch (err) {
    document.getElementById('log-content').innerText = `Log Terminal Connection Error: ${err.message}`;
  }
}

function switchLogTab(tab) {
  currentLogTab = tab;
  document.getElementById('btn-tab-out').classList.toggle('active', tab === 'out');
  document.getElementById('btn-tab-err').classList.toggle('active', tab === 'err');
  fetchLogs();
}

function closeLogViewer() {
  document.getElementById('log-viewer').classList.add('hidden');
  if (logPollInterval) {
    clearInterval(logPollInterval);
    logPollInterval = null;
  }
  currentLogProcessId = null;
}

// Global functions exports
window.controlPM2 = controlPM2;
window.viewLogs = viewLogs;
window.switchLogTab = switchLogTab;
window.closeLogViewer = closeLogViewer;

// Live-Reload Client Integration
let liveReloadSource = null;

function connectLiveReload() {
  const statusBadge = document.getElementById('live-reload-status');
  const logBox = document.getElementById('live-reload-log');
  
  if (liveReloadSource) {
    liveReloadSource.close();
  }

  logBox.innerText += `\n[System] Connecting to live-reload EventStream...`;
  liveReloadSource = new EventSource('/api/live-reload');

  liveReloadSource.onopen = () => {
    if (statusBadge) {
      statusBadge.innerText = 'Connected';
      statusBadge.className = 'badge active';
    }
    logBox.innerText += `\n[System] Live-Reload connection active.`;
    logBox.scrollTop = logBox.scrollHeight;
  };

  liveReloadSource.onerror = (err) => {
    if (statusBadge) {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge offline';
    }
    logBox.innerText += `\n[Error] Live-Reload disconnected. Retrying...`;
    logBox.scrollTop = logBox.scrollHeight;
  };

  liveReloadSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'change') {
        logBox.innerText += `\n[${data.time}] File modified: ${data.file}`;
        logBox.scrollTop = logBox.scrollHeight;
        
        const autoReloadEnabled = document.getElementById('live-reload-toggle')?.checked;
        if (autoReloadEnabled) {
          logBox.innerText += `\n[System] Auto-Refresh triggered...`;
          logBox.scrollTop = logBox.scrollHeight;
          setTimeout(() => {
            window.location.reload();
          }, 200);
        } else {
          logBox.innerText += `\n[System] Auto-Refresh disabled. Skipping reload.`;
          logBox.scrollTop = logBox.scrollHeight;
        }
      }
    } catch (e) {
      console.error('[Live-Reload] Parse error:', e);
    }
  };
}

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

  // Bind chart checkboxes to redraw immediately
  document.getElementById('toggle-cpu').addEventListener('change', drawVitalsChart);
  document.getElementById('toggle-ram').addEventListener('change', drawVitalsChart);
  document.getElementById('toggle-gpu').addEventListener('change', drawVitalsChart);
  
  // Bind resize handler for vitals chart canvas
  window.addEventListener('resize', drawVitalsChart);

  // Initial triggers
  fetchMetrics();
  fetchPM2();
  fetchOllama();
  connectLiveReload();
  
  // Acoustic & Network Mesh initial triggers and pollers
  pollMeshStatus();
  loadHudSubProfiles();
  pollRoon();
  
  roonPoller = setInterval(pollRoon, 2000);
  meshPoller = setInterval(pollMeshStatus, 6000);

  // Bind local AI chat form submit
  const chatForm = document.getElementById('chat-input-form');
  if (chatForm) {
    chatForm.addEventListener('submit', sendChatMessage);
  }

  // Bind Process Explorer controls
  const procSearch = document.getElementById('proc-search-input');
  if (procSearch) {
    procSearch.addEventListener('input', (e) => {
      currentProcessFilter = e.target.value;
      renderFilteredProcesses();
    });
  }
  
  const procSort = document.getElementById('proc-sort-select');
  if (procSort) {
    procSort.addEventListener('change', (e) => {
      currentProcessSort = e.target.value;
      fetchSystemProcesses();
    });
  }
  
  // Bind AI System Diagnostics Audit controls
  const runAuditBtn = document.getElementById('run-audit-btn');
  if (runAuditBtn) {
    runAuditBtn.addEventListener('click', runAISystemAudit);
  }
  
  const maxAuditBtn = document.getElementById('maximize-audit-report');
  if (maxAuditBtn) {
    maxAuditBtn.addEventListener('click', openAuditReportViewer);
  }

  // Bind AI Studio Workspace navigation
  initTabNavigation();

  // Initialize Chat sessions and presets
  loadChatSessions();
  initPersonaPresets();

  // Initialize Image Studio presets and controls
  initImageStudio();

  // Bind new form listeners
  const chatStudioForm = document.getElementById('chat-studio-form');
  if (chatStudioForm) {
    chatStudioForm.addEventListener('submit', sendChatStudioMessage);
  }
  
  const runAuditBtnTab = document.getElementById('run-audit-btn-tab');
  if (runAuditBtnTab) {
    runAuditBtnTab.addEventListener('click', runAISystemAuditTab);
  }
  
  const maxAuditBtnTab = document.getElementById('maximize-audit-report-tab');
  if (maxAuditBtnTab) {
    maxAuditBtnTab.addEventListener('click', openAuditReportViewer);
  }

  // Bind Suggested prompt chips
  const promptChips = document.querySelectorAll('#chat-suggested-chips .chip-item');
  const chatStudioInput = document.getElementById('chat-studio-input');
  promptChips.forEach(chip => {
    chip.addEventListener('click', () => {
      if (chatStudioInput) {
        chatStudioInput.value = chip.getAttribute('data-prompt');
        chatStudioInput.focus();
      }
    });
  });

  // Bind Export transcript button
  const downloadTranscriptBtn = document.getElementById('chat-download-transcript');
  if (downloadTranscriptBtn) {
    downloadTranscriptBtn.addEventListener('click', downloadChatTranscript);
  }

  // Initial triggers
  fetchSystemProcesses();

  // Polling loops
  setInterval(fetchMetrics, POLL_INTERVAL_METRICS);
  setInterval(fetchPM2, POLL_INTERVAL_PM2);
  setInterval(fetchOllama, POLL_INTERVAL_OLLAMA);
  setInterval(fetchSystemProcesses, 7000);
}

// Local AI Chat Client Handlers
async function sendChatMessage(e) {
  if (e) e.preventDefault();
  const promptInput = document.getElementById('chat-prompt-input');
  const chatModelSelect = document.getElementById('chat-model-select');
  const chatRagToggle = document.getElementById('chat-rag-toggle');
  const chatSendBtn = document.getElementById('chat-send-btn');
  const chatHistory = document.getElementById('chat-history');
  const chatStatus = document.getElementById('chat-status');

  const prompt = promptInput.value.trim();
  const model = chatModelSelect.value;
  const ragEnabled = chatRagToggle ? chatRagToggle.checked : false;

  if (!prompt || !model) return;

  // Append user message
  appendMessage('user', prompt);
  promptInput.value = '';

  // Disable input & show loading dots
  promptInput.disabled = true;
  chatSendBtn.disabled = true;
  chatStatus.innerText = 'Thinking...';
  chatStatus.className = 'badge warning';

  const loadingDots = document.createElement('div');
  loadingDots.className = 'chat-message assistant loading-bubble';
  loadingDots.innerHTML = `
    <div class="chat-loading-dots" style="display:flex; flex-direction:column; gap:0.4rem; font-family:monospace; font-size:0.72rem; text-align:left;">
      <div class="pipeline-step-active" id="thinking-step-text-widget">🔍 Searching local indices...</div>
      <div style="display:flex; gap:0.25rem; align-self:center; margin-top:0.25rem;">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  chatHistory.appendChild(loadingDots);
  chatHistory.scrollTop = chatHistory.scrollHeight;

  // Cycle thinking steps text
  const steps = [
    "🔍 Indexing local document vectors...",
    "🧠 Injecting RAG prompt context...",
    "⚡ Querying LLM inference engine...",
    "📝 Rendering assistant response..."
  ];
  let currentStep = 0;
  const thinkingInterval = setInterval(() => {
    const stepTextEl = document.getElementById('thinking-step-text-widget');
    if (stepTextEl) {
      currentStep = (currentStep + 1) % steps.length;
      stepTextEl.innerText = steps[currentStep];
    } else {
      clearInterval(thinkingInterval);
    }
  }, 2000);

  try {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model, ragEnabled })
    });
    clearInterval(thinkingInterval);

    // Remove loading dots
    loadingDots.remove();

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Chat request failed');
    }

    const data = await res.json();
    appendMessage('assistant', data.response, data.contextUsed);
    chatStatus.innerText = 'Ready';
    chatStatus.className = 'badge llm-badge active';
  } catch (err) {
    clearInterval(thinkingInterval);
    loadingDots.remove();
    appendMessage('assistant', `Error: ${err.message}`);
    chatStatus.innerText = 'Offline';
    chatStatus.className = 'badge';
  } finally {
    promptInput.disabled = false;
    chatSendBtn.disabled = false;
  }
}

function appendMessage(sender, text, contextUsed = []) {
  const chatHistory = document.getElementById('chat-history');
  if (!chatHistory) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `chat-message ${sender}`;

  let contentHtml = `<div class="message-bubble">${escapeHtml(text)}`;
  
  if (contextUsed && contextUsed.length > 0) {
    contentHtml += `<br><span class="context-tag">📚 Context: ${contextUsed[0]}</span>`;
  }
  contentHtml += `</div>`;

  msgDiv.innerHTML = contentHtml;
  chatHistory.appendChild(msgDiv);
  chatHistory.scrollTop = chatHistory.scrollHeight;
}

// System Process Explorer and AI Diagnostics Variables
let currentProcessSort = 'ram';
let currentProcessFilter = '';
let currentProcessList = [];
let activeConfirmKillPid = null;
let confirmKillTimeout = null;

// Fetch and Cache System Processes
async function fetchSystemProcesses() {
  try {
    const res = await fetch(`/api/system/processes?sortBy=${currentProcessSort}`);
    if (!res.ok) throw new Error('System processes request failed');
    const data = await res.json();
    
    if (data.success && data.processes) {
      currentProcessList = data.processes;
      renderFilteredProcesses();
    }
  } catch (err) {
    console.error('Error fetching system processes:', err);
  }
}

// Filter and Render cached processes
function renderFilteredProcesses() {
  const tbody = document.getElementById('system-process-list');
  const countBadge = document.getElementById('process-count-badge');
  if (!tbody) return;

  const filtered = currentProcessList.filter(p => 
    p.name.toLowerCase().includes(currentProcessFilter.toLowerCase()) ||
    String(p.pid).includes(currentProcessFilter)
  );

  countBadge.innerText = `${filtered.length} Active`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-message">${currentProcessFilter ? 'No matching processes found.' : 'No active processes.'}</td></tr>`;
    return;
  }

  let html = '';
  filtered.forEach(p => {
    // RAM formatting (WorkingSet is returned in MB)
    const ramFormatted = p.ram >= 1024 
      ? `${(p.ram / 1024).toFixed(2)} GB` 
      : `${Math.round(p.ram)} MB`;
      
    // Format CPU time (in seconds)
    const cpuFormatted = p.cpu >= 3600
      ? `${(p.cpu / 3600).toFixed(1)}h`
      : p.cpu >= 60 
        ? `${Math.round(p.cpu / 60)}m` 
        : `${Math.round(p.cpu)}s`;

    html += `
      <tr id="proc-row-${p.pid}">
        <td><strong style="color:var(--text-primary)">${escapeHtml(p.name)}</strong></td>
        <td><small style="font-family:monospace;color:var(--text-secondary)">${p.pid}</small></td>
        <td><span style="font-family:monospace">${cpuFormatted}</span></td>
        <td><span style="font-family:monospace;color:var(--accent-purple)">${ramFormatted}</span></td>
        <td>
          <button class="action-btn btn-kill" title="Kill Process" onclick="triggerProcessKill(${p.pid}, '${escapeHtml(p.name)}', this)">
            Kill
          </button>
        </td>
      </tr>
    `;
  });
  
  tbody.innerHTML = html;
}

// Confirm Kill Handler
function triggerProcessKill(pid, name, buttonEl) {
  if (activeConfirmKillPid === pid) {
    proceedKillProcess(pid, buttonEl);
  } else {
    if (confirmKillTimeout) {
      clearTimeout(confirmKillTimeout);
      const prevBtn = document.querySelector('.btn-kill-confirm');
      if (prevBtn) {
        prevBtn.innerText = 'Kill';
        prevBtn.classList.remove('btn-kill-confirm');
      }
    }
    
    activeConfirmKillPid = pid;
    buttonEl.innerText = 'Confirm?';
    buttonEl.classList.add('btn-kill-confirm');
    
    confirmKillTimeout = setTimeout(() => {
      buttonEl.innerText = 'Kill';
      buttonEl.classList.remove('btn-kill-confirm');
      activeConfirmKillPid = null;
    }, 4000);
  }
}

async function proceedKillProcess(pid, buttonEl) {
  buttonEl.disabled = true;
  buttonEl.innerText = 'Killing...';
  
  try {
    const res = await fetch('/api/system/process/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid })
    });
    
    if (res.ok) {
      buttonEl.innerText = 'Dead';
      const row = document.getElementById(`proc-row-${pid}`);
      if (row) {
        row.style.transition = 'opacity 0.4s ease';
        row.style.opacity = '0';
        setTimeout(() => {
          fetchSystemProcesses();
        }, 400);
      }
    } else {
      const errData = await res.json();
      alert(`Termination failed: ${errData.error || 'Access denied'}`);
      buttonEl.disabled = false;
      buttonEl.innerText = 'Kill';
      buttonEl.classList.remove('btn-kill-confirm');
      activeConfirmKillPid = null;
    }
  } catch (err) {
    alert(`Error: ${err.message}`);
    buttonEl.disabled = false;
    buttonEl.innerText = 'Kill';
    buttonEl.classList.remove('btn-kill-confirm');
    activeConfirmKillPid = null;
  }
}

// Custom Markdown to HTML parser
function renderMarkdown(md) {
  if (!md) return '';
  let html = md;
  
  html = html
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
    
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre style="background: rgba(0, 0, 0, 0.4); border: 1px solid rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 6px; overflow-x: auto; font-family: monospace; font-size: 0.72rem; color: var(--accent-blue); margin: 0.75rem 0;"><code>${code.trim()}</code></pre>`;
  });
  
  html = html.replace(/`([^`]+)`/g, '<code style="background: rgba(0, 242, 254, 0.08); color: var(--accent-blue); padding: 0.15rem 0.35rem; border-radius: 4px; font-family: monospace;">$1</code>');
  
  html = html.replace(/^&gt;\s+(.+)$/gm, '<blockquote style="border-left: 3px solid var(--accent-purple); background: rgba(168, 85, 247, 0.05); padding: 0.5rem 1rem; margin: 0.75rem 0; border-radius: 0 4px 4px 0; font-style: italic; color: var(--text-secondary);">$1</blockquote>');
  
  html = html.replace(/^#\s+(.+)$/gm, '<h1 style="font-family: var(--font-display); font-size: 1.3rem; margin-top: 1.25rem; margin-bottom: 0.75rem; color: var(--accent-blue); border-bottom: 1px solid rgba(0, 242, 254, 0.15); padding-bottom: 0.25rem;">$1</h1>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 style="font-family: var(--font-display); font-size: 1.1rem; margin-top: 1rem; margin-bottom: 0.5rem; color: var(--accent-purple);">$1</h2>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 style="font-family: var(--font-display); font-size: 0.95rem; margin-top: 0.75rem; margin-bottom: 0.25rem; color: var(--accent-pink);">$1</h3>');
  
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong style="color: var(--accent-blue); font-weight: 600;">$1</strong>');
  
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li style="margin-bottom: 0.35rem; list-style: square; margin-left: 1.25rem;">$1</li>');
  
  const paragraphs = html.split('\n');
  let finalHtml = '';
  let inList = false;
  
  for (let line of paragraphs) {
    line = line.trim();
    if (!line) continue;
    
    if (line.startsWith('<li')) {
      if (!inList) {
        finalHtml += '<ul style="margin-bottom: 0.75rem; margin-left: 1rem;">';
        inList = true;
      }
      finalHtml += line;
    } else {
      if (inList) {
        finalHtml += '</ul>';
        inList = false;
      }
      if (!line.startsWith('<h') && !line.startsWith('<pre') && !line.startsWith('<block')) {
        finalHtml += `<p style="margin-bottom: 0.75rem; font-size: 0.82rem; color: var(--text-primary);">${line}</p>`;
      } else {
        finalHtml += line;
      }
    }
  }
  if (inList) finalHtml += '</ul>';
  
  return finalHtml;
}

// AI Diagnostics Audit Handler
async function runAISystemAudit() {
  const modelSelect = document.getElementById('audit-model-select');
  const runBtn = document.getElementById('run-audit-btn');
  const progressDiv = document.getElementById('audit-progress');
  const progressBar = document.getElementById('audit-progress-bar');
  const progressStatus = document.getElementById('audit-progress-status');
  const statusBadge = document.getElementById('ai-diagnostic-status');
  const reportTerminal = document.getElementById('audit-report-terminal');

  const selectedModel = modelSelect.value;
  if (!selectedModel) {
    alert("Please select a local AI model first. Pull models in the Inference Gateway if needed.");
    return;
  }

  runBtn.disabled = true;
  modelSelect.disabled = true;
  progressDiv.classList.remove('hidden');
  statusBadge.innerText = 'Auditing...';
  statusBadge.className = 'badge warning';
  progressBar.style.width = '10%';
  progressBar.classList.add('shimmering-bar');
  
  reportTerminal.innerHTML = `<span style="color:var(--accent-purple)">[System] Initializing AI Performance Diagnostics...</span>`;
  
  const updateProgress = (pct, status) => {
    progressBar.style.width = `${pct}%`;
    progressStatus.innerText = status;
    reportTerminal.innerHTML += `\n<span style="color:var(--accent-blue)">[Scanner] ${status}</span>`;
    reportTerminal.scrollTop = reportTerminal.scrollHeight;
  };

  setTimeout(() => updateProgress(25, "Gathering workstation hardware telemetry..."), 1000);
  setTimeout(() => updateProgress(45, "Scanning CPU per-core load & logical topology..."), 2200);
  setTimeout(() => updateProgress(65, "Resolving active process working sets & threads..."), 3500);
  setTimeout(() => updateProgress(80, "Querying local LLM inference engine..."), 5000);

  try {
    const res = await fetch('/api/system/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Diagnostics audit request failed');
    }

    const data = await res.json();
    progressBar.style.width = '100%';
    progressStatus.innerText = "Audit completed successfully.";
    progressBar.classList.remove('shimmering-bar');
    statusBadge.innerText = 'Audit Complete';
    statusBadge.className = 'badge active';
    
    const renderedReport = renderMarkdown(data.report);
    reportTerminal.innerHTML = renderedReport;
    window.lastGeneratedReport = renderedReport;

    setTimeout(() => {
      progressDiv.classList.add('hidden');
    }, 4000);

  } catch (err) {
    progressBar.classList.remove('shimmering-bar');
    progressBar.style.width = '100%';
    progressStatus.innerText = "Audit failed.";
    statusBadge.innerText = 'Audit Failed';
    statusBadge.className = 'badge offline';
    reportTerminal.innerHTML = `<span style="color:var(--accent-red)">[Error] Audit failed: ${err.message}</span>`;
  } finally {
    runBtn.disabled = false;
    modelSelect.disabled = false;
  }
}

// Fullscreen Modal functions
function openAuditReportViewer() {
  const modal = document.getElementById('audit-report-viewer');
  const modalContent = document.getElementById('audit-report-fullscreen-content');
  if (modal && modalContent) {
    modalContent.innerHTML = window.lastGeneratedReport || 
      '<div style="text-align:center;padding:3rem;color:var(--text-secondary)">No system audit report generated yet. Run a Diagnostics Audit on the dashboard first.</div>';
    modal.classList.remove('hidden');
  }
}

function closeAuditReportViewer() {
  const modal = document.getElementById('audit-report-viewer');
  if (modal) modal.classList.add('hidden');
}

// Tab Switching Management
function initTabNavigation() {
  const tabs = document.querySelectorAll('.nav-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.getAttribute('data-tab');
      
      // Update tab active state
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Show tab content
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      const activeContent = document.getElementById('tab-' + targetTab);
      if (activeContent) {
        activeContent.classList.add('active');
      }
      
      // Redraw canvas if going back to dashboard
      if (targetTab === 'dashboard') {
        setTimeout(drawVitalsChart, 50);
      }
    });
  });
}

// Chat Studio Multi-session Persistence
let chatSessions = [];
let activeSessionId = null;
let selectedPersonaPrompt = "You are a senior code reviewer. Analyze code for bugs, logic flaws, memory leaks, and efficiency. Suggest clean code alternatives.";

function loadChatSessions() {
  const stored = localStorage.getItem('kinetix_chat_sessions');
  if (stored) {
    try {
      chatSessions = JSON.parse(stored);
    } catch (e) {
      chatSessions = [];
    }
  }
  
  if (chatSessions.length === 0) {
    const defaultSession = {
      id: 'session_' + Date.now(),
      title: 'Workstation Chat Init',
      persona: 'Code Architect',
      messages: [
        { sender: 'assistant', text: 'Hello! I am your local AI developer assistant. Select a model and toggle RAG mode to search custom document indexes. How can I help you today?' }
      ]
    };
    chatSessions.push(defaultSession);
    localStorage.setItem('kinetix_chat_sessions', JSON.stringify(chatSessions));
  }
  
  activeSessionId = chatSessions[0].id;
  renderChatSessionsSidebar();
  renderActiveSessionMessages();
}

function renderChatSessionsSidebar() {
  const container = document.getElementById('chat-sessions');
  if (!container) return;
  
  container.innerHTML = '';
  chatSessions.forEach(session => {
    const item = document.createElement('div');
    item.className = `session-item ${session.id === activeSessionId ? 'active' : ''}`;
    item.onclick = () => switchChatSession(session.id);
    
    item.innerHTML = `
      <span class="session-title-text" id="title-text-${session.id}">${escapeHtml(session.title)}</span>
      <div class="session-actions">
        <button class="session-action-btn delete" onclick="event.stopPropagation(); deleteChatSession('${session.id}')" title="Delete Session">🗑️</button>
      </div>
    `;
    container.appendChild(item);
  });
}

function renderActiveSessionMessages() {
  const viewport = document.getElementById('chat-messages-area');
  const titleSpan = document.getElementById('chat-session-title');
  if (!viewport) return;
  
  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  if (!activeSession) return;
  
  if (titleSpan) {
    titleSpan.innerText = `${activeSession.title} (${activeSession.persona || 'General'})`;
  }
  
  viewport.innerHTML = '';
  activeSession.messages.forEach(msg => {
    appendChatBubble(msg.sender, msg.text, msg.contextUsed || [], false);
  });
  viewport.scrollTop = viewport.scrollHeight;
}

function switchChatSession(sessionId) {
  activeSessionId = sessionId;
  renderChatSessionsSidebar();
  renderActiveSessionMessages();
}

function createNewChatSession() {
  const newSession = {
    id: 'session_' + Date.now(),
    title: `Chat Session ${chatSessions.length + 1}`,
    persona: 'General Agent',
    messages: [
      { sender: 'assistant', text: 'New chat session initialized. How can I help you developer?' }
    ]
  };
  chatSessions.push(newSession);
  localStorage.setItem('kinetix_chat_sessions', JSON.stringify(chatSessions));
  
  activeSessionId = newSession.id;
  renderChatSessionsSidebar();
  renderActiveSessionMessages();
}

function deleteChatSession(sessionId) {
  if (chatSessions.length <= 1) {
    alert("Cannot delete the only remaining active chat session.");
    return;
  }
  chatSessions = chatSessions.filter(s => s.id !== sessionId);
  localStorage.setItem('kinetix_chat_sessions', JSON.stringify(chatSessions));
  
  if (activeSessionId === sessionId) {
    activeSessionId = chatSessions[0].id;
  }
  renderChatSessionsSidebar();
  renderActiveSessionMessages();
}

function saveActiveSessionMessages() {
  localStorage.setItem('kinetix_chat_sessions', JSON.stringify(chatSessions));
}

// Bind persona preset buttons
function initPersonaPresets() {
  const buttons = document.querySelectorAll('.persona-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPersonaPrompt = btn.getAttribute('data-prompt');
      
      const activeSession = chatSessions.find(s => s.id === activeSessionId);
      if (activeSession) {
        activeSession.persona = btn.innerText.split(' ').slice(1).join(' ');
        saveActiveSessionMessages();
        renderChatSessionsSidebar();
        const titleSpan = document.getElementById('chat-session-title');
        if (titleSpan) titleSpan.innerText = `${activeSession.title} (${activeSession.persona})`;
      }
    });
  });
}

// Append message to chat studio UI and session history
function appendChatBubble(sender, text, contextUsed = [], save = true) {
  const viewport = document.getElementById('chat-messages-area');
  if (!viewport) return;
  
  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  if (save && activeSession) {
    activeSession.messages.push({ sender, text, contextUsed });
    saveActiveSessionMessages();
  }

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = `chat-message ${sender}`;
  
  let formattedHtml = renderMarkdown(text);
  
  if (contextUsed && contextUsed.length > 0) {
    formattedHtml += `<br><span class="context-tag" style="display:inline-block;margin-top:0.5rem;font-size:0.7rem;color:var(--accent-purple)">📚 Context: ${contextUsed[0]}</span>`;
  }
  
  bubbleDiv.innerHTML = `<div class="message-bubble">${formattedHtml}</div>`;
  viewport.appendChild(bubbleDiv);
  viewport.scrollTop = viewport.scrollHeight;
  
  if (save && sender === 'user' && activeSession && activeSession.messages.length === 3) {
    const words = text.split(' ').slice(0, 3).join(' ');
    activeSession.title = words.length > 20 ? words.slice(0, 20) + '...' : words;
    saveActiveSessionMessages();
    renderChatSessionsSidebar();
  }

  hookCopyCodeButtons(bubbleDiv);

  // Parse HTML/JS/SVG/CSS code blocks from assistant and render in split screen
  if (sender === 'assistant') {
    extractAndLoadArtifact(text);
  }
}

function hookCopyCodeButtons(container) {
  const pres = container.querySelectorAll('pre');
  pres.forEach(pre => {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-copy-code';
    copyBtn.innerText = 'Copy';
    copyBtn.onclick = () => {
      const code = pre.querySelector('code')?.innerText || pre.innerText;
      navigator.clipboard.writeText(code).then(() => {
        copyBtn.innerText = 'Copied!';
        setTimeout(() => copyBtn.innerText = 'Copy', 2000);
      });
    };
    pre.style.position = 'relative';
    pre.appendChild(copyBtn);
  });
}

// Send Chat Studio Prompt to Server
async function sendChatStudioMessage(e) {
  if (e) e.preventDefault();
  
  const inputEl = document.getElementById('chat-studio-input');
  const engineSelect = document.getElementById('chat-engine-select');
  const ragCheckbox = document.getElementById('chat-rag-enabled');
  const sendBtn = document.getElementById('chat-studio-send-btn');
  const viewport = document.getElementById('chat-messages-area');
  
  const prompt = inputEl.value.trim();
  const model = engineSelect.value;
  const ragEnabled = ragCheckbox ? ragCheckbox.checked : false;
  
  if (!prompt || !model) return;
  
  appendChatBubble('user', prompt);
  inputEl.value = '';
  
  inputEl.disabled = true;
  sendBtn.disabled = true;
  
  const loadingDots = document.createElement('div');
  loadingDots.className = 'chat-message assistant loading-bubble';
  loadingDots.innerHTML = `
    <div class="chat-loading-dots" style="display:flex; flex-direction:column; gap:0.4rem; font-family:monospace; font-size:0.75rem; text-align:left;">
      <div class="pipeline-step-active" id="thinking-step-text">🔍 Scanning RAG vector database indexes...</div>
      <div style="display:flex; gap:0.25rem; align-self:center; margin-top:0.25rem;">
        <span></span>
        <span></span>
        <span></span>
      </div>
    </div>
  `;
  viewport.appendChild(loadingDots);
  viewport.scrollTop = viewport.scrollHeight;

  // Cycle high-tech thinking steps text
  const steps = [
    "🔍 Scanning RAG vector database indexes...",
    "🧠 Compiling contextual prompts & developer schemas...",
    "⚡ Initializing local GPU execution threads...",
    "🧬 Running model inference and generating syntax tokens...",
    "📝 Stream-assembling markdown response bubbles..."
  ];
  let currentStep = 0;
  const thinkingInterval = setInterval(() => {
    const stepTextEl = document.getElementById('thinking-step-text');
    if (stepTextEl) {
      currentStep = (currentStep + 1) % steps.length;
      stepTextEl.innerText = steps[currentStep];
    } else {
      clearInterval(thinkingInterval);
    }
  }, 2500);
  
  const finalPromptWithPersona = `System Persona Directive: ${selectedPersonaPrompt}\n\nUser Question: ${prompt}`;
  
  try {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: finalPromptWithPersona, model, ragEnabled })
    });
    
    clearInterval(thinkingInterval);
    loadingDots.remove();
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Chat request failed');
    }
    
    const data = await res.json();
    appendChatBubble('assistant', data.response, data.contextUsed);
  } catch (err) {
    clearInterval(thinkingInterval);
    loadingDots.remove();
    appendChatBubble('assistant', `Failed to obtain LLM response: ${err.message}`);
  } finally {
    inputEl.disabled = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

// Image Generation Studio handlers
let selectedImageStyle = "";
let imageHistory = [];

function initImageStudio() {
  const tags = document.querySelectorAll('.style-tag');
  tags.forEach(tag => {
    tag.addEventListener('click', () => {
      const isActive = tag.classList.contains('active');
      tags.forEach(t => t.classList.remove('active'));
      
      if (isActive) {
        selectedImageStyle = "";
      } else {
        tag.classList.add('active');
        selectedImageStyle = tag.getAttribute('data-style');
      }
    });
  });

  // Advanced parameters slider displays
  const cfgScaleInput = document.getElementById('image-cfg-scale');
  const cfgDisplay = document.getElementById('cfg-value-display');
  if (cfgScaleInput && cfgDisplay) {
    cfgScaleInput.addEventListener('input', (e) => {
      cfgDisplay.innerText = parseFloat(e.target.value).toFixed(1);
    });
  }

  const stepsInput = document.getElementById('image-steps');
  const stepsDisplay = document.getElementById('steps-value-display');
  if (stepsInput && stepsDisplay) {
    stepsInput.addEventListener('input', (e) => {
      stepsDisplay.innerText = e.target.value;
    });
  }

  // Seed toggle handler
  const seedRandomToggle = document.getElementById('seed-random-toggle');
  const seedInput = document.getElementById('image-seed');
  if (seedRandomToggle && seedInput) {
    seedRandomToggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        seedInput.value = '-1';
        seedInput.disabled = true;
        seedInput.style.color = 'var(--text-muted)';
      } else {
        seedInput.value = Math.floor(Math.random() * 10000000).toString();
        seedInput.disabled = false;
        seedInput.style.color = '#fff';
      }
    });
  }

  // Visual Aspect ratio selector cards
  const aspectCards = document.querySelectorAll('.aspect-ratio-card');
  const aspectHidden = document.getElementById('image-aspect');
  aspectCards.forEach(card => {
    card.addEventListener('click', () => {
      aspectCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const ratio = card.getAttribute('data-aspect');
      if (aspectHidden) aspectHidden.value = ratio;
    });
  });

  // Prompt Enhancer click handler
  const enhanceBtn = document.getElementById('btn-enhance-prompt');
  if (enhanceBtn) {
    enhanceBtn.addEventListener('click', enhanceCreativePrompt);
  }
  
  const stored = localStorage.getItem('kinetix_image_history');
  if (stored) {
    try {
      imageHistory = JSON.parse(stored);
      renderImageHistoryGallery();
    } catch(e) {}
  }
  
  const imgForm = document.getElementById('image-generate-form');
  if (imgForm) {
    imgForm.addEventListener('submit', runImageGeneration);
  }
  
  const downloadBtn = document.getElementById('btn-download-gen');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadActiveImage);
  }
  
  const zoomBtn = document.getElementById('btn-zoom-gen');
  if (zoomBtn) {
    zoomBtn.addEventListener('click', zoomActiveImage);
  }
}

async function enhanceCreativePrompt() {
  const promptEl = document.getElementById('image-prompt');
  const enhanceBtn = document.getElementById('btn-enhance-prompt');
  const model = document.getElementById('chat-engine-select')?.value || document.getElementById('chat-model-select')?.value;
  
  if (!model) {
    alert("Please load and select an LLM engine first to optimize the prompt.");
    return;
  }

  const origPrompt = promptEl.value.trim();
  if (!origPrompt) {
    alert("Please enter a basic prompt in the creative prompt box to enhance.");
    return;
  }

  enhanceBtn.disabled = true;
  const originalText = enhanceBtn.innerText;
  enhanceBtn.innerText = "✨ Enhancing...";

  const enhancementPrompt = `You are a professional image generator prompt builder. Enhance the following user description into a detailed Stable Diffusion prompt. Include vivid artistic details, style keyword markers, lighting parameters, and camera quality modifiers. Keep the enhanced response concise, under 80 words, and return ONLY the enhanced prompt. User prompt: "${origPrompt}"`;

  try {
    const res = await fetch('/api/ollama/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: enhancementPrompt, model, ragEnabled: false })
    });
    if (!res.ok) throw new Error("Local LLM request failed.");
    const data = await res.json();
    if (data.success && data.response) {
      promptEl.value = data.response.trim();
    }
  } catch (err) {
    alert(`Failed to optimize prompt: ${err.message}`);
  } finally {
    enhanceBtn.disabled = false;
    enhanceBtn.innerText = originalText;
  }
}

async function runImageGeneration(e) {
  if (e) e.preventDefault();
  
  const promptEl = document.getElementById('image-prompt');
  const negPromptEl = document.getElementById('image-neg-prompt');
  const aspectEl = document.getElementById('image-aspect');
  const styleSelect = document.getElementById('image-style-select');
  const genBtn = document.getElementById('btn-generate-image');
  
  const cfgInput = document.getElementById('image-cfg-scale');
  const stepsInput = document.getElementById('image-steps');
  const seedInput = document.getElementById('image-seed');
  
  const canvasPlaceholder = document.getElementById('image-canvas-placeholder');
  const canvasLoader = document.getElementById('image-canvas-loader');
  const mainImage = document.getElementById('main-studio-image');
  const actionsBar = document.getElementById('image-viewer-actions');
  const loaderStatus = document.getElementById('image-loader-status');
  
  const prompt = promptEl.value.trim();
  if (!prompt) return;
  
  genBtn.disabled = true;
  canvasPlaceholder.classList.add('hidden');
  mainImage.classList.add('hidden');
  actionsBar.classList.add('hidden');
  canvasLoader.classList.remove('hidden');
  
  const updateLoader = (statusText) => {
    loaderStatus.innerText = statusText;
  };
  
  updateLoader("Initializing image diffusion canvas...");
  setTimeout(() => updateLoader("Checking local Stable Diffusion availability..."), 1200);
  setTimeout(() => updateLoader("Synthesizing prompt tensors..."), 2500);
  setTimeout(() => updateLoader("Running latent diffusion denoising steps..."), 4500);
  
  const payload = {
    prompt,
    aspect: aspectEl.value,
    style: selectedImageStyle || styleSelect.value,
    negativePrompt: negPromptEl.value,
    cfgScale: cfgInput ? parseFloat(cfgInput.value) : 7,
    steps: stepsInput ? parseInt(stepsInput.value, 10) : 20,
    seed: seedInput ? seedInput.value : '-1'
  };
  
  try {
    const res = await fetch('/api/image/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || "Generation endpoint error.");
    }
    
    const data = await res.json();
    
    mainImage.src = data.url;
    mainImage.classList.remove('hidden');
    canvasLoader.classList.add('hidden');
    actionsBar.classList.remove('hidden');
    
    const metaInfo = document.getElementById('image-meta-info');
    if (metaInfo) {
      metaInfo.innerText = data.usedLocal ? `Local Stable Diffusion (Aspect ${data.aspect})` : `Online Cloud Fallback (Aspect ${data.aspect})`;
    }
    
    imageHistory.unshift({
      url: data.url,
      prompt: prompt,
      timestamp: data.timestamp,
      meta: metaInfo.innerText,
      cfgScale: data.cfgScale || payload.cfgScale,
      steps: data.steps || payload.steps,
      seed: data.seed !== undefined ? data.seed : payload.seed
    });
    localStorage.setItem('kinetix_image_history', JSON.stringify(imageHistory));
    renderImageHistoryGallery();
    
  } catch (err) {
    canvasLoader.classList.add('hidden');
    canvasPlaceholder.classList.remove('hidden');
    alert(`Failed to generate image asset: ${err.message}`);
  } finally {
    genBtn.disabled = false;
  }
}

function renderImageHistoryGallery() {
  const container = document.getElementById('image-gallery');
  if (!container) return;
  
  container.innerHTML = '';
  if (imageHistory.length === 0) {
    container.innerHTML = `<div style="grid-column:1/-1;text-align:center;font-size:0.75rem;color:var(--text-muted);padding:1rem;">Empty gallery. Generated assets appear here.</div>`;
    return;
  }
  
  imageHistory.forEach((img, idx) => {
    const thumb = document.createElement('div');
    thumb.className = 'gallery-thumb';
    thumb.onclick = () => openImageLightbox(img, idx);
    thumb.innerHTML = `
      <img src="${img.url}" alt="${escapeHtml(img.prompt)}" title="${escapeHtml(img.prompt)}">
      <button type="button" class="gallery-delete-btn" onclick="event.stopPropagation(); deleteGalleryItem(${idx})" title="Delete image from history">🗑️</button>
    `;
    container.appendChild(thumb);
  });
}

let currentLightboxIndex = null;

function openImageLightbox(img, index) {
  currentLightboxIndex = index;
  const modal = document.getElementById('image-lightbox-modal');
  const mainImg = document.getElementById('lightbox-main-img');
  const metaDate = document.getElementById('lightbox-meta-date');
  const metaPrompt = document.getElementById('lightbox-meta-prompt');
  const metaAspect = document.getElementById('lightbox-meta-aspect');
  const metaCfg = document.getElementById('lightbox-meta-cfg');
  const metaSteps = document.getElementById('lightbox-meta-steps');
  const metaSeed = document.getElementById('lightbox-meta-seed');
  const metaSource = document.getElementById('lightbox-meta-source');

  if (modal && img) {
    mainImg.src = img.url;
    metaDate.innerText = `Timestamp: ${new Date(img.timestamp || Date.now()).toLocaleString()}`;
    metaPrompt.innerText = img.prompt;
    metaAspect.innerText = img.aspect || '1:1';
    metaCfg.innerText = parseFloat(img.cfgScale || 7).toFixed(1);
    metaSteps.innerText = img.steps || 20;
    metaSeed.innerText = img.seed !== undefined ? img.seed : '-1';
    metaSource.innerText = img.meta || 'Cloud Fallback Generation';
    modal.classList.remove('hidden');
  }
}

// Function to load gallery image parameters to form inputs
function loadGalleryImageToViewer(img) {
  const canvasPlaceholder = document.getElementById('image-canvas-placeholder');
  const mainImage = document.getElementById('main-studio-image');
  const actionsBar = document.getElementById('image-viewer-actions');
  const metaInfo = document.getElementById('image-meta-info');
  
  canvasPlaceholder.classList.add('hidden');
  mainImage.src = img.url;
  mainImage.classList.remove('hidden');
  actionsBar.classList.remove('hidden');
  
  if (metaInfo) {
    metaInfo.innerText = img.meta || "Generated Layout Asset";
  }
  
  document.getElementById('image-prompt').value = img.prompt;
}

function closeImageLightbox() {
  const modal = document.getElementById('image-lightbox-modal');
  if (modal) modal.classList.add('hidden');
  currentLightboxIndex = null;
}

function copyLightboxPrompt() {
  if (currentLightboxIndex === null) return;
  const img = imageHistory[currentLightboxIndex];
  if (img) {
    navigator.clipboard.writeText(img.prompt).then(() => {
      alert("Prompt copied to clipboard!");
    });
  }
}

function downloadLightboxImage() {
  if (currentLightboxIndex === null) return;
  const img = imageHistory[currentLightboxIndex];
  if (img) {
    const link = document.createElement('a');
    link.href = img.url;
    link.download = img.url.split('/').pop() || 'ai_design_asset.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

function deleteLightboxImage() {
  if (currentLightboxIndex === null) return;
  deleteGalleryItem(currentLightboxIndex);
  closeImageLightbox();
}

function deleteGalleryItem(index) {
  if (confirm("Are you sure you want to delete this generated design asset from your history?")) {
    imageHistory.splice(index, 1);
    localStorage.setItem('kinetix_image_history', JSON.stringify(imageHistory));
    renderImageHistoryGallery();
  }
}

// Global Artifact state variables
let activeArtifactCode = "";
let activeArtifactType = "html";

function extractAndLoadArtifact(text) {
  const htmlMatch = text.match(/```html([\s\S]*?)```/i);
  const svgMatch = text.match(/```(xml|svg)([\s\S]*?)```/i);
  const cssMatch = text.match(/```css([\s\S]*?)```/i);
  const jsMatch = text.match(/```(javascript|js)([\s\S]*?)```/i);

  let code = "";
  let type = "";
  let name = "";

  if (htmlMatch) {
    code = htmlMatch[1].trim();
    type = "html";
    name = "HTML Canvas Web App";
  } else if (svgMatch) {
    const rawSvg = svgMatch[2].trim();
    code = `<!DOCTYPE html><html><head><style>body { display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #0b0f1e; color: #fff; }</style></head><body>${rawSvg}</body></html>`;
    type = "svg";
    name = "SVG Interactive Vector";
  } else if (cssMatch) {
    code = cssMatch[1].trim();
    type = "css";
    name = "CSS Stylesheet Spec";
  } else if (jsMatch) {
    code = jsMatch[1].trim();
    type = "javascript";
    name = "JS Script Widget";
  }

  if (code) {
    activeArtifactCode = code;
    activeArtifactType = type;
    
    const sidebar = document.getElementById('chat-artifacts-sidebar');
    const title = document.getElementById('artifact-active-name');
    const codeBox = document.getElementById('artifact-code-box');
    
    if (sidebar && title && codeBox) {
      title.innerText = name;
      codeBox.innerText = code;
      
      const iframe = document.getElementById('artifact-preview-frame');
      if (iframe) {
        let docContent = code;
        if (type === 'css') {
          docContent = `<!DOCTYPE html><html><head><style>${code}</style></head><body style="padding:2rem;font-family:sans-serif;background:#0b0f1e;color:#fff;"><h3>CSS Spec Sheet Renders</h3><p>Loaded styles successfully.</p></body></html>`;
        } else if (type === 'javascript') {
          docContent = `<!DOCTYPE html><html><head></head><body style="padding:2rem;font-family:sans-serif;background:#0b0f1e;color:#fff;"><h3>JS Widget Sandbox</h3><p>Running script...</p><script>${code}</script></body></html>`;
        }
        
        iframe.srcdoc = docContent;
      }
      
      sidebar.classList.remove('hidden');
      switchArtifactTab('preview');
    }
  }
}

function switchArtifactTab(tab) {
  const previewTab = document.getElementById('artifact-btn-preview');
  const codeTab = document.getElementById('artifact-btn-code');
  const previewPane = document.getElementById('artifact-pane-preview');
  const codePane = document.getElementById('artifact-pane-code');

  if (tab === 'preview') {
    previewTab?.classList.add('active');
    codeTab?.classList.remove('active');
    previewPane?.classList.add('active');
    codePane?.classList.remove('active');
  } else {
    codeTab?.classList.add('active');
    previewTab?.classList.remove('active');
    codePane?.classList.add('active');
    previewPane?.classList.remove('active');
  }
}

function closeArtifactPanel() {
  const sidebar = document.getElementById('chat-artifacts-sidebar');
  if (sidebar) {
    sidebar.classList.add('hidden');
  }
}

function copyArtifactCode() {
  if (activeArtifactCode) {
    navigator.clipboard.writeText(activeArtifactCode).then(() => {
      const copyBtn = document.getElementById('btn-artifact-copy');
      if (copyBtn) {
        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          copyBtn.innerText = "Copy Code";
        }, 2000);
      }
    });
  }
}

function downloadChatTranscript() {
  const activeSession = chatSessions.find(s => s.id === activeSessionId);
  if (!activeSession || activeSession.messages.length === 0) {
    alert("No messages to export.");
    return;
  }

  let markdown = `# Kinetix AI Studio Conversation - ${activeSession.title}\n`;
  markdown += `Persona: ${activeSession.persona || 'General Architect'}\n`;
  markdown += `Timestamp: ${new Date().toLocaleString()}\n\n---\n\n`;

  activeSession.messages.forEach(msg => {
    const role = msg.sender === 'user' ? 'Developer' : 'Kinetix Assistant';
    markdown += `### 👤 ${role}\n${msg.text}\n\n`;
    if (msg.contextUsed && msg.contextUsed.length > 0) {
      markdown += `*📚 Context Used:*\n${msg.contextUsed.join('\n')}\n\n`;
    }
    markdown += `---\n\n`;
  });

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${activeSession.title.replace(/[^a-z0-9_-]/gi, '_')}_transcript.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function downloadActiveImage() {
  const mainImage = document.getElementById('main-studio-image');
  if (!mainImage || !mainImage.src) return;
  
  const link = document.createElement('a');
  link.href = mainImage.src;
  link.download = mainImage.src.split('/').pop() || 'ai_design_asset.jpg';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function zoomActiveImage() {
  const mainImage = document.getElementById('main-studio-image');
  if (!mainImage || !mainImage.src) return;
  window.open(mainImage.src, '_blank');
}

// AI Diagnostics Audit Handler (for Tab & Dashboard widgets)
async function runAISystemAuditTab() {
  const modelSelect = document.getElementById('audit-model-select-tab');
  const runBtn = document.getElementById('run-audit-btn-tab');
  const progressDiv = document.getElementById('audit-progress-tab');
  const progressBar = document.getElementById('audit-progress-bar-tab');
  const progressStatus = document.getElementById('audit-progress-status-tab');
  const statusBadge = document.getElementById('ai-diagnostic-status-tab');
  const reportTerminal = document.getElementById('audit-report-terminal-tab');

  const selectedModel = modelSelect.value;
  if (!selectedModel) {
    alert("Please select a local AI model first. Pull models in the Inference Gateway if needed.");
    return;
  }

  runBtn.disabled = true;
  modelSelect.disabled = true;
  progressDiv.classList.remove('hidden');
  statusBadge.innerText = 'Auditing...';
  statusBadge.className = 'badge warning';
  progressBar.style.width = '10%';
  progressBar.classList.add('shimmering-bar');
  
  reportTerminal.innerHTML = `<span style="color:var(--accent-purple)">[System] Initializing AI Performance Diagnostics...</span>`;
  
  const updateProgress = (pct, status) => {
    progressBar.style.width = `${pct}%`;
    progressStatus.innerText = status;
    reportTerminal.innerHTML += `\n<span style="color:var(--accent-blue)">[Scanner] ${status}</span>`;
    reportTerminal.scrollTop = reportTerminal.scrollHeight;
  };

  setTimeout(() => updateProgress(25, "Gathering workstation hardware telemetry..."), 1000);
  setTimeout(() => updateProgress(45, "Scanning CPU per-core load & logical topology..."), 2200);
  setTimeout(() => updateProgress(65, "Resolving active process working sets & threads..."), 3500);
  setTimeout(() => updateProgress(80, "Querying local LLM inference engine..."), 5000);

  try {
    const res = await fetch('/api/system/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: selectedModel })
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Diagnostics audit request failed');
    }

    const data = await res.json();
    progressBar.style.width = '100%';
    progressStatus.innerText = "Audit completed successfully.";
    progressBar.classList.remove('shimmering-bar');
    statusBadge.innerText = 'Audit Complete';
    statusBadge.className = 'badge active';
    
    const renderedReport = renderMarkdown(data.report);
    reportTerminal.innerHTML = renderedReport;
    window.lastGeneratedReport = renderedReport;

    setTimeout(() => {
      progressDiv.classList.add('hidden');
    }, 4000);

  } catch (err) {
    progressBar.classList.remove('shimmering-bar');
    progressBar.style.width = '100%';
    progressStatus.innerText = "Audit failed.";
    statusBadge.innerText = 'Audit Failed';
    statusBadge.className = 'badge offline';
    reportTerminal.innerHTML = `<span style="color:var(--accent-red)">[Error] Audit failed: ${err.message}</span>`;
  } finally {
    runBtn.disabled = false;
    modelSelect.disabled = false;
  }
}

// Bind helper bindings globally
window.triggerProcessKill = triggerProcessKill;
window.closeAuditReportViewer = closeAuditReportViewer;
window.renderFilteredProcesses = renderFilteredProcesses;
window.runAISystemAudit = runAISystemAudit;
window.openAuditReportViewer = openAuditReportViewer;
window.deleteChatSession = deleteChatSession;
window.switchChatSession = switchChatSession;
window.createNewChatSession = createNewChatSession;
window.runAISystemAuditTab = runAISystemAuditTab;
window.openImageLightbox = openImageLightbox;
window.closeImageLightbox = closeImageLightbox;
window.copyLightboxPrompt = copyLightboxPrompt;
window.downloadLightboxImage = downloadLightboxImage;
window.deleteLightboxImage = deleteLightboxImage;
window.deleteGalleryItem = deleteGalleryItem;
window.switchArtifactTab = switchArtifactTab;
window.closeArtifactPanel = closeArtifactPanel;
window.copyArtifactCode = copyArtifactCode;
window.downloadChatTranscript = downloadChatTranscript;

// ── Node Switching, Roon Player, Subwoofer and Automation controls ──

async function switchNode(nodeId) {
  activeNode = nodeId;
  document.getElementById('tab-mac').classList.toggle('active', nodeId === 'mac');
  document.getElementById('tab-alienware').classList.toggle('active', nodeId === 'alienware');
  logConsole("System", `Switched active node telemetry context to: ${nodeId === 'mac' ? 'MacBook Pro' : 'Alienware RTX'}`);
  pollMeshStatus();
  fetchMetrics();
  fetchPM2();
}

async function pollRoon() {
  try {
    const res = await fetch('/api/roon/status');
    const data = await res.json();
    
    const statusBadge = document.getElementById('roon-status');
    if (!statusBadge) return;
    
    if (data.connected) {
      statusBadge.innerText = 'Connected';
      statusBadge.className = 'badge active';
      
      if (data.now_playing) {
        document.getElementById('roon-title').innerText = data.now_playing.title || 'Unknown Title';
        document.getElementById('roon-artist').innerText = data.now_playing.artist || 'Unknown Artist';
        document.getElementById('roon-album').innerText = data.now_playing.album || '';
        
        const stateBadge = document.getElementById('roon-state');
        stateBadge.innerText = data.now_playing.is_playing ? 'Playing' : 'Paused';
        stateBadge.className = `state-badge ${data.now_playing.is_playing ? 'playing' : 'paused'}`;
        
        const artImg = document.getElementById('roon-art');
        const artPlaceholder = document.getElementById('roon-art-placeholder');
        if (data.now_playing.image_key) {
          artImg.src = `/api/roon/image?key=${data.now_playing.image_key}`;
          artImg.style.display = 'block';
          artPlaceholder.style.display = 'none';
        } else {
          artImg.style.display = 'none';
          artPlaceholder.style.display = 'flex';
        }
      }
      
      if (data.volume != null) {
        document.getElementById('roon-volume-val').innerText = data.volume + '%';
        document.getElementById('roon-volume-slider').value = data.volume;
      }
    } else {
      statusBadge.innerText = 'Offline';
      statusBadge.className = 'badge offline';
      document.getElementById('roon-title').innerText = '—';
      document.getElementById('roon-artist').innerText = '—';
      document.getElementById('roon-album').innerText = '';
      document.getElementById('roon-state').innerText = 'Stopped';
      document.getElementById('roon-state').className = 'state-badge paused';
      document.getElementById('roon-art').style.display = 'none';
      document.getElementById('roon-art-placeholder').style.display = 'flex';
    }
  } catch (err) {
    console.error('Failed to poll Roon:', err);
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

async function loadHudSubProfiles() {
  try {
    const res = await fetch('/api/roon/sub_profiles');
    const data = await res.json();
    
    const select = document.getElementById('hud-sub-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">None Selected</option>';
    allHudSubProfiles = data.profiles || [];
    
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
  if (!logElem) return;
  const timestamp = new Date().toLocaleTimeString();
  
  const cleanMsg = message.replace(/\\033\\[[0-9;]*m/g, '');
  
  const logLine = `[${timestamp}] [${sender}] ${cleanMsg}\n`;
  if (logElem.innerText === "Ready for action. Click a sync button above." || logElem.innerText.startsWith("Ready")) {
    logElem.innerText = logLine;
  } else {
    logElem.innerText += logLine;
  }
  
  const container = logElem.parentElement;
  container.scrollTop = container.scrollHeight;
}

function clearConsoleLog() {
  const logElem = document.getElementById('console-log');
  if (logElem) {
    logElem.innerText = "Ready for action. Click a sync button above.";
  }
}

// Bind helper bindings globally
window.switchNode = switchNode;
window.previewRoonVol = previewRoonVol;
window.setRoonVol = setRoonVol;
window.pbRoon = pbRoon;
window.selectHudSubProfile = selectHudSubProfile;
window.triggerAutomation = triggerAutomation;
window.clearConsoleLog = clearConsoleLog;

// Global tab switching binding
document.addEventListener('DOMContentLoaded', () => {
  const btnNewChat = document.getElementById('btn-new-chat');
  if (btnNewChat) {
    btnNewChat.addEventListener('click', createNewChatSession);
  }
  setupOpsHub();
});

// ── Advanced Operations Hub UI Bindings ─────────────────────────────────────
function setupOpsHub() {
  const opsLog = document.getElementById('ops-log');
  
  function appendOpsLog(text, type = 'info') {
    if (!opsLog) return;
    const time = new Date().toLocaleTimeString();
    let prefix = `\n[${time}] `;
    if (type === 'error') prefix += `[Error] `;
    opsLog.innerText += `${prefix}${text}`;
    opsLog.scrollTop = opsLog.scrollHeight;
  }

  async function triggerOp(endpoint, buttonId, successMsg) {
    const btn = document.getElementById(buttonId);
    if (btn) btn.disabled = true;
    appendOpsLog(`Triggering action...`);
    
    try {
      const res = await fetch(endpoint, { method: endpoint.includes('vault') ? 'GET' : 'POST' });
      const data = await res.json();
      
      if (res.ok && data.success !== false) {
        appendOpsLog(`${successMsg}\nOutput:\n${data.output}`);
      } else {
        appendOpsLog(data.output || 'Execution failed.', 'error');
      }
    } catch (err) {
      appendOpsLog(err.message, 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  const btnStress = document.getElementById('btn-stress-test');
  if (btnStress) {
    btnStress.addEventListener('click', () => {
      triggerOp('/api/ops/stress', 'btn-stress-test', '✓ Stress Test completed.');
    });
  }

  const btnBQ = document.getElementById('btn-setup-bq');
  if (btnBQ) {
    btnBQ.addEventListener('click', () => {
      triggerOp('/api/ops/setup-bq', 'btn-setup-bq', '✓ BigQuery configuration completed.');
    });
  }

  const btnMesh = document.getElementById('btn-test-mesh');
  if (btnMesh) {
    btnMesh.addEventListener('click', () => {
      triggerOp('/api/ops/test-mesh', 'btn-test-mesh', '✓ Mesh Diagnostics sweep completed.');
    });
  }

  const btnVault = document.getElementById('btn-vault-code');
  if (btnVault) {
    btnVault.addEventListener('click', () => {
      triggerOp('/api/ops/vault', 'btn-vault-code', '✓ Security vault access credentials retrieved.');
    });
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Launch application
initialize();
