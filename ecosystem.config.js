const fs = require('fs');

// Load env vars like PUPPETEER_EXECUTABLE_PATH from .env for pm2
if (fs.existsSync('.env')) {
  require('dotenv').config({ path: '.env' });
}

module.exports = {
  apps: [
    {
      name: 'grab-fetcher',
      script: 'src/index.js',
      instances: 1,
      autorestart: true,
      // Headless Chrome on the merchant portal typically sits 300-600MB RSS.
      // The previous 512M ceiling tripped mid-poll, forcing a fresh login every
      // few cycles and risking Grab rate limiting.
      max_memory_restart: '1G',
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
