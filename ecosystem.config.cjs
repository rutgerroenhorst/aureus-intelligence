/**
 * PM2 process manager config for long-running local operation.
 *   pnpm add -g pm2   (once)
 *   pm2 start ecosystem.config.cjs   # starts worker + web with auto-restart
 *   pm2 logs        # tail logs
 *   pm2 stop all    # graceful stop (sends SIGINT → worker shuts down cleanly)
 *
 * Both processes restart automatically on crash (equivalent to Docker's
 * restart: unless-stopped). The worker handles SIGINT/SIGTERM gracefully.
 */
module.exports = {
  apps: [
    {
      name: "aureus-worker",
      cwd: __dirname,
      script: "node_modules/.bin/tsx",
      args: "apps/worker/src/run.ts start",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 3000,
      kill_timeout: 8000, // give the worker time to finish its cycle on stop
      env: { NODE_ENV: "production" },
      out_file: "logs/worker.out.log",
      error_file: "logs/worker.err.log",
    },
    {
      name: "aureus-web",
      cwd: __dirname,
      script: "node_modules/.bin/next",
      args: "start -p 3000",
      autorestart: true,
      max_restarts: 50,
      restart_delay: 2000,
      env: { NODE_ENV: "production" },
      out_file: "logs/web.out.log",
      error_file: "logs/web.err.log",
    },
  ],
};
