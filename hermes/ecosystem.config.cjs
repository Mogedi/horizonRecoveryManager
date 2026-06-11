// PM2 process config for the Hermes Discord bot.
//   pm2 start ecosystem.config.cjs   (run from ~/hermes on the VPS)
// node_args loads hermes/.env natively (Node 20.6+ --env-file), so no dotenv dependency.
module.exports = {
  apps: [
    {
      name: 'hermes-bot',
      script: 'src/bot.js',
      cwd: '/home/mo/hermes',
      node_args: '--env-file=.env',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      out_file: '/home/mo/hermes/logs/bot.out.log',
      error_file: '/home/mo/hermes/logs/bot.err.log',
    },
  ],
}
