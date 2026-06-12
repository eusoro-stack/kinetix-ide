const path = require('path');

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
      cwd: 'C:\\Users\\eusor\\Documents\\roon-myclaw', // Update this to local path
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
