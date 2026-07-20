module.exports = {
  apps: [{
    name: 'ticket-generator-mcp',
    script: 'server.js',
    instances: 1,
    exec_mode: 'cluster',
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      MCP_TRANSPORT: 'http',
      HOST: '0.0.0.0',
      PORT: 3050,
      // Add your environment variables here or via Fargate task definition
      // TG_API_KEY: 'your_api_key_here',
      CORS_ORIGINS: '',
      RATE_WINDOW_MS: 60000,
      RATE_MAX: 60,
      JSON_LIMIT: '200kb',
      LOG_FORMAT: 'combined',
      // Auth0 OAuth2 (MCP clients only)
      MCP_BASE_URL: 'https://60c1-182-77-79-109.ngrok-free.app',
      AUTH0_ISSUER: 'https://ticket-generator.us.auth0.com/',
      AUTH0_AUDIENCE: 'https://60c1-182-77-79-109.ngrok-free.app',
      TG_MCP_INTERNAL_SECRET: 'change_me_shared_secret'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    // PM2 will keep the app running
    min_uptime: '10s',
    max_restarts: 10,
    // Graceful shutdown
    kill_timeout: 5000,
    wait_ready: true,
    listen_timeout: 3000
  }]
};
