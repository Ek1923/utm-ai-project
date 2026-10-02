import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { initDatabase } from './services/database.js';
import { commandRoutes } from './routes/command.js';
import { voiceRoutes } from './routes/voice.js';
import { agentRoutes } from './routes/agents.js';
import { feedbackRoutes } from './routes/feedback.js';
import { forgeRoutes } from './routes/forge.js';
import { trainingRoutes } from './routes/training.js';
import { integrationRoutes } from './routes/integrations.js';
import { mapsRoutes } from './routes/maps.js';
import { configRoutes } from './routes/config.js';
import { automationRoutes } from './routes/automation.js';
import { discordRoutes }        from './routes/discord.js';
import { systemControlRoutes }  from './routes/system-control.js';
import { botApiRoutes }         from './routes/bot-apis.js';
import { tradingRoutes }        from './routes/trading.js';
import { notesRoutes }          from './routes/notes.js';
import { ecosystemRoutes }      from './routes/ecosystem.js';
import { startForgeWatcher }    from './services/forge-watcher.js';
import { detectAndFixInferenceUrl } from './services/ollama.js';
import { getConfig } from './services/config.js';

const fastify = Fastify({ logger: { level: 'info' } });

async function start() {
  try {
    // Init database
    initDatabase();

    // Self-configure the inference backend URL for whichever machine/drive
    // this bundle currently runs on (Camelllo vs Ollama, different ports)
    await detectAndFixInferenceUrl();

    // Register CORS
    await fastify.register(cors, { origin: true });

    // Register routes
    await fastify.register(commandRoutes);
    await fastify.register(voiceRoutes);
    await fastify.register(agentRoutes);
    await fastify.register(feedbackRoutes);
    await fastify.register(forgeRoutes);
    await fastify.register(trainingRoutes);
    await fastify.register(integrationRoutes);
    await fastify.register(mapsRoutes);
    await fastify.register(configRoutes);
    await fastify.register(automationRoutes);
    await fastify.register(discordRoutes);
    await fastify.register(systemControlRoutes);
    await fastify.register(botApiRoutes);
    await fastify.register(tradingRoutes);
    await fastify.register(notesRoutes);
    await fastify.register(ecosystemRoutes);

    // Health check
    fastify.get('/health', async () => ({ status: 'ok', system: 'NEXUS', version: '0.1.0' }));

    // In production (Docker), serve the built client from client/dist
    const clientDist = path.resolve(__dirname, '../../../client/dist');
    if (process.env.NODE_ENV === 'production' && fs.existsSync(clientDist)) {
      await fastify.register(fastifyStatic, { root: clientDist, prefix: '/' });
      fastify.setNotFoundHandler((_req, reply) => {
        reply.sendFile('index.html');
      });
      console.log('   Static client: serving from client/dist');
    }

    // Start server
    const port = parseInt(process.env.PORT ?? '3001', 10);
    await fastify.listen({ port, host: '0.0.0.0' });

    console.log(`\n✅ NEXUS Backend running on http://localhost:${port}`);
    console.log('   Agents: apex1, apex2, forge, spark, atlas, tactix, vega, nexus_ui');
    console.log(`   Ollama: ${getConfig().ollamaUrl}\n`);

    // Start FORGE file watcher
    startForgeWatcher();

  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

start();
