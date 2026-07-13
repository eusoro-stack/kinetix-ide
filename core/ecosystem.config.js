const path = require('path');
const os = require('os');
const fs = require('fs');

const winVenvPython = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
const unixVenvPython = path.join(__dirname, '..', '.venv', 'bin', 'python');
let pythonInterpreter = 'python';

if (fs.existsSync(winVenvPython)) {
  pythonInterpreter = winVenvPython;
} else if (fs.existsSync(unixVenvPython)) {
  pythonInterpreter = unixVenvPython;
}

module.exports = {
  apps: [
    {
      name: 'kinetix-console',
      script: './interface/server.js', // Located inside /interface
      cwd: path.join(__dirname, '..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      }
    },
    {
      name: 'kinetix-telemetry',
      script: 'telemetry.py',
      interpreter: pythonInterpreter,
      args: ['--interval', '5'],
      cwd: path.join(__dirname, '..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '100M',
      env: {
        PYTHONUNBUFFERED: '1'
      }
    },
    {
      name: 'kinetix-rag-sync',
      script: 'scripts/rag_agent_worker.py',
      interpreter: pythonInterpreter,
      args: ['--watch'],
      cwd: path.join(__dirname, '..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      env: {
        PYTHONUNBUFFERED: '1'
      }
    },
    {
      name: 'kinetix-media-bridge',
      script: 'node',
      args: ['index.js'],
      cwd: path.join(os.homedir(), 'Documents', 'roon-myclaw'), // Dynamic home directory path
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '150M',
      env: {
        NODE_ENV: 'production'
      }
    },
    {
      name: 'kinetix-health-check',
      script: 'scripts/custom_health_check.py',
      interpreter: pythonInterpreter,
      cwd: path.join(__dirname, '..'),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '80M',
      env: {
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      }
    }
  ]
};
