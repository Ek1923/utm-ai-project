export default {
  apps: [
    {
      name: 'nexus-backend',
      script: 'server/src/index.ts',
      interpreter: 'tsx',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        OLLAMA_URL: 'http://localhost:11434',
      },
      watch: false,
      max_memory_restart: '500M',
    },
    {
      name: 'nexus-frontend',
      script: 'npm',
      args: 'run dev:client',
      cwd: './client',
      env: { NODE_ENV: 'development' },
      watch: false,
    },
  ],
};
