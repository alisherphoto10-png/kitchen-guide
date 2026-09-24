// pm2 start ecosystem.config.js && pm2 save
module.exports = {
  apps: [{
    name: 'zhiguli',
    cwd: __dirname + '/server',
    script: 'src/index.js',
    max_memory_restart: '300M',
    env: { NODE_ENV: 'production' },
  }],
};
