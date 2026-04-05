module.exports = {
  apps: [
    {
      name: 'grab-fetcher',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      restart_delay: 10000,
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
      env_file: '.env',
      time: true,
    },
    {
      name: 'grab-api',
      script: 'src/api/server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '256M',
      restart_delay: 10000,
      env_file: '.env',
      time: true,
    },
  ],
};
