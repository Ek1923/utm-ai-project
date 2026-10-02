# NEXUS — File Structure

## Root
```
nexus/
├── STRUCTURE.md              ← dit bestand
├── .env                      ← environment variables (API keys, poorten)
├── .dockerignore             ← bestanden die Docker negeert
├── Dockerfile                ← Docker build voor productie
├── docker-compose.yml        ← start backend + Ollama samen in containers
├── ecosystem.config.js       ← PM2 process manager config (productie)
├── package.json              ← root-level scripts (start alles tegelijk)
├── tsconfig.json             ← root TypeScript config
├── nexus.db                  ← SQLite database (chat history, training logs)
└── server.log                ← server output log
```

---

## client/ — React + Vite Frontend
```
client/
├── index.html                ← HTML entry point
├── vite.config.ts            ← Vite config: port 5173, proxy /api → 3001, host 0.0.0.0
├── tailwind.config.js        ← Tailwind CSS config
├── postcss.config.js         ← PostCSS (vereist voor Tailwind)
├── tsconfig.json             ← TypeScript config voor client
├── tsconfig.node.json        ← TypeScript config voor Vite node tools
├── package.json              ← dependencies (React, Three.js, Tailwind)
│
└── src/
    ├── main.tsx              ← React entry point, mount App
    ├── App.tsx               ← Router: alle pagina's en navigatie
    ├── index.css             ← globale CSS + Tailwind imports
    │
    ├── types/
    │   └── nexus.ts          ← TypeScript types: Agent, Message, TrainingStatus, etc.
    │
    ├── config/
    │   ├── personalization.json  ← gebruikersnaam, NEXUS naam, kleurthema
    │   └── personalization.ts   ← leest personalization.json, exporteert config
    │
    ├── hooks/
    │   ├── useNexus.ts       ← hoofd AI hook: stuurt berichten, ontvangt antwoorden
    │   ├── useForge.ts       ← FORGE-specifieke hook: code taken, project builder
    │   ├── useAudio.ts       ← audio afspelen voor agent responses
    │   ├── useSpeech.ts      ← spraakherkenning (Web Speech API)
    │   ├── useLiveMode.ts    ← live monitoring modus
    │   └── useStatsStream.ts ← SSE stream voor real-time statistieken
    │
    ├── components/
    │   ├── AgentGrid.tsx         ← grid van alle agents met status indicators
    │   ├── AgentAvatar.tsx       ← avatar per agent (kleur, initialen)
    │   ├── ActivityPanel.tsx     ← live activiteit sidebar
    │   ├── CommandFeed.tsx       ← feed van uitgevoerde PC-acties
    │   ├── MetricsBar.tsx        ← CPU/RAM/GPU metrics balk
    │   ├── NeuralNetView.tsx     ← 3D neural network visualisatie (Three.js)
    │   ├── NeuralOverlay.tsx     ← overlay effecten op de neural view
    │   ├── TickerBar.tsx         ← scrollende info ticker onderaan
    │   ├── ApexVoiceIndicator.tsx ← indicator wanneer APEX spreekt
    │   ├── JarvisUI.tsx          ← JARVIS project interface component
    │   └── LiveModePanel.tsx     ← live mode control panel
    │
    └── pages/
        ├── Command.tsx           ← hoofd chat interface, stuurt berichten naar agents
        ├── ForgeLabPage.tsx      ← QLoRA training dashboard: data collectie, training, stats
        ├── AgentSettingsPage.tsx ← agent instellingen: naam, system prompt, temperatuur
        ├── Settings.tsx          ← algemene NEXUS instellingen
        ├── ApiManagerPage.tsx    ← API keys beheren (OpenAI, Discord, etc.)
        ├── AutomationPage.tsx    ← automatiseringen aanmaken en beheren
        ├── EcosystemPage.tsx     ← overzicht van alle services en hun status
        ├── GraphifyPage.tsx      ← knowledge graph visualisatie
        ├── ScribePage.tsx        ← notities en markdown editor
        └── TradePage.tsx         ← trading/markt pagina
```

---

## server/ — Fastify Backend (Node.js + TypeScript)
```
server/
├── package.json              ← dependencies (Fastify, better-sqlite3, axios, tsx)
│
└── src/
    ├── index.ts              ← entrypoint: registreert alle routes, start server op poort 3001
    │
    ├── agents/
    │   └── profiles.ts       ← AGENT PROFIELEN: system prompts, temperatuur, rollen voor alle agents
    │                           (apex1, apex2, forge, spark, atlas, tactix, vega, optic, jarvis)
    │
    ├── routes/               ← HTTP endpoints (alle /api/... routes)
    │   ├── command.ts        ← POST /api/command — verwerkt gebruikersbericht, routeert naar agent
    │   ├── agents.ts         ← GET/POST /api/agents — agent lijst, model info
    │   ├── training.ts       ← /api/training/* — data collectie, QLoRA training, archiveren
    │   ├── voice.ts          ← /api/voice/* — spraak input/output
    │   ├── forge.ts          ← /api/forge/* — code taken, project builder endpoints
    │   ├── feedback.ts       ← /api/feedback — thumbs up/down opslaan
    │   ├── integrations.ts   ← /api/integrations — externe diensten koppelen
    │   ├── config.ts         ← /api/config — systeem configuratie lezen/schrijven
    │   ├── automation.ts     ← /api/automation — automatiseringen CRUD
    │   ├── discord.ts        ← /api/discord — Discord bot integratie
    │   ├── system-control.ts ← /api/system — PC acties uitvoeren (NEXUS_ACTION tags)
    │   ├── bot-apis.ts       ← /api/bot — externe bot API koppelingen
    │   ├── trading.ts        ← /api/trading — markt/trading data
    │   ├── notes.ts          ← /api/notes — notities opslaan/ophalen
    │   ├── maps.ts           ← /api/maps — kaart/locatie functionaliteit
    │   └── ecosystem.ts      ← /api/ecosystem — service health checks
    │
    └── services/             ← business logic (geen HTTP, puur logica)
        ├── orchestrator.ts   ← APEX-1 routing: bepaalt welke agent(s) een taak krijgen
        ├── ollama.ts         ← communiceert met Ollama API (phi3.5, deepseek-coder modellen)
        ├── database.ts       ← SQLite setup: chat_messages, training_runs, feedback tabellen
        ├── modelfile-builder.ts ← bouwt Ollama Modelfiles, leest dataset info per agent
        ├── data-collector.ts ← haalt trainingsdata op (Wikipedia, StackOverflow, GitHub, HuggingFace)
        ├── stats-emitter.ts  ← SSE broadcast voor live statistieken naar de frontend
        ├── config.ts         ← leest/schrijft server/data/system-config.json
        ├── automation.ts     ← voert automatiseringsregels uit
        ├── integrations.ts   ← beheert externe API koppelingen
        ├── forge-context.ts  ← bouwt context op voor FORGE (code bestanden, project info)
        ├── forge-trainer.ts  ← FORGE-specifieke training helpers
        ├── forge-watcher.ts  ← file watcher: detecteert code wijzigingen voor FORGE
        ├── project-builder.ts ← JARVIS: bouwt complete projecten (websites, webshops)
        ├── project-runner.ts ← JARVIS: voert projecten uit, beheert processen
        ├── agent-trainer.ts  ← algemene training helpers
        ├── tools.ts          ← tool definities die agents kunnen aanroepen
        ├── maps.ts           ← kaart/locatie logica
        └── voice.ts          ← spraak verwerking logica
```

---

## data/ — Configuratie & Runtime Data
```
data/
├── system-config.json        ← systeem instellingen (ook in server/data/)
├── integrations.json         ← opgeslagen API koppelingen
└── collector-plugins.json    ← welke data bronnen aan/uit zijn
                                { wikipedia, stackoverflow, devto, github_readme,
                                  huggingface, arxiv, hackernews }
```

## data/agents/ — Trainingsdata (runtime gegenereerd)
```
data/agents/
├── forge/
│   ├── forge_wikipedia_*.jsonl   ← Q&A paren per bron
│   ├── forge_stackoverflow_*.jsonl
│   └── archive/                  ← na training hierheen verplaatst
│       └── 1234567890_forge_*.jsonl
├── atlas/
├── spark/
├── tactix/
├── vega/
├── optic/
├── jarvis/
├── apex1/
└── apex2/
```

---

## ollama/ — Ollama Modelfiles
```
ollama/
├── modelfiles/       ← bronbestanden (handmatig bewerkt)
│   ├── APEX1.Modelfile
│   ├── APEX2.Modelfile
│   ├── ATLAS.Modelfile
│   ├── FORGE.Modelfile
│   ├── NEXUS_UI.Modelfile  ← legacy, zelfde model als OPTIC
│   ├── SPARK.Modelfile
│   ├── TACTIX.Modelfile
│   └── VEGA.Modelfile
│
└── built/            ← na `ollama create` gegenereerd
    ├── APEX1.Modelfile
    ├── APEX2.Modelfile
    ├── ATLAS.Modelfile
    ├── FORGE.Modelfile
    ├── NEXUS_UI.Modelfile
    ├── TACTIX.Modelfile
    └── VEGA.Modelfile
```

---

## training/ — QLoRA Training Pipeline (Python)
```
training/
├── requirements.txt          ← Python packages: transformers, peft, bitsandbytes, torch
├── forge_train.py            ← hoofd training script: laadt JSONL, QLoRA fine-tune, opslaan adapter
├── forge_merge_convert.py    ← merget LoRA adapter met base model, converteert naar GGUF
└── forge_scraper.py          ← legacy data scraper (vervangen door data-collector.ts)
```

---

## scripts/ — Setup Scripts
```
scripts/
├── setup.ps1           ← installeert alles: Node, Python, Ollama, dependencies
├── download_phi.ps1    ← downloadt phi3.5.gguf model
└── create_models.ps1   ← maakt alle Ollama modellen aan via `ollama create`
```

---

## Agents & Rollen

| Agent   | Model       | Rol                                      |
|---------|-------------|------------------------------------------|
| APEX-1  | phi3.5      | General Commander — routeert alle taken  |
| APEX-2  | phi3.5      | Strategic General — quality & analyse    |
| FORGE   | deepseek    | Code, bugs, scripts, terminal            |
| SPARK   | phi3.5      | Creativiteit, ideeën, schrijven          |
| ATLAS   | phi3.5      | Feiten, research, uitleg                 |
| TACTIX  | phi3.5      | Plannen, strategieën, roadmaps           |
| VEGA    | phi3.5      | Vice-General — chat, fallback            |
| OPTIC   | phi3.5      | Data analyse, ML, HuggingFace, statistieken |
| JARVIS  | phi3.5      | Project executor — websites, webshops    |

---

## Poorten

| Service   | Poort |
|-----------|-------|
| Frontend  | 5173  |
| Backend   | 3001  |
| Ollama    | 11434 |
| Camelllo  | 11500 |