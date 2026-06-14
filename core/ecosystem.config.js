const path = require('path');
const os = require('os');
const fs = require('fs');

const venvPythonPath = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
const pythonInterpreter = fs.existsSync(venvPythonPath) ? venvPythonPath : 'python';

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
      script: 'python',
      args: ['scripts/rag_agent_worker.py', '--watch'],
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
    }
  ]
};
