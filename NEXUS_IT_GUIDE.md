# NEXUS + CAMELLLO — IT Specialist Guide
> Volledig technisch overzicht van het lokale 8-agent AI-systeem

---

## Inhoudsopgave

1. [Architectuur overzicht](#1-architectuur-overzicht)
2. [Camelllo — C++ Inference Engine](#2-camelllo--c-inference-engine)
3. [CMakeLists.txt uitgelegd](#3-cmakeliststxt-uitgelegd)
4. [NEXUS Server — Node.js/Fastify backend](#4-nexus-server--nodejsfastify-backend)
5. [NEXUS Client — React/Vite frontend](#5-nexus-client--reactvite-frontend)
6. [Agent systeem](#6-agent-systeem)
7. [Database — SQLite](#7-database--sqlite)
8. [Dataflow: van user input tot AI response](#8-dataflow-van-user-input-tot-ai-response)
9. [Vulkan GPU acceleratie](#9-vulkan-gpu-acceleratie)
10. [Bouwen en deployen (rebuild workflow)](#10-bouwen-en-deployen-rebuild-workflow)
11. [Alle API endpoints](#11-alle-api-endpoints)
12. [Configuratie referentie](#12-configuratie-referentie)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Architectuur overzicht

```
┌─────────────────────────────────────────────────────┐
│  Browser  (http://localhost:5173)                   │
│  React + Vite frontend                              │
│  nexus/client/src/                                  │
└────────────────────┬────────────────────────────────┘
                     │  HTTP / SSE streaming
                     ▼
┌─────────────────────────────────────────────────────┐
│  NEXUS Server  (http://localhost:3001)              │
│  Node.js 22 + Fastify + TypeScript                  │
│  nexus/server/src/                                  │
│  • orchestrator.ts  ← routing + agent management   │
│  • ollama.ts        ← Camelllo communicatie         │
│  • database.ts      ← SQLite (nexus.db)             │
└────────────────────┬────────────────────────────────┘
                     │  HTTP POST /api/generate (NDJSON stream)
                     ▼
┌─────────────────────────────────────────────────────┐
│  Camelllo  (http://localhost:11500)                 │
│  C++17 + llama.cpp + cpp-httplib + nlohmann/json    │
│  Desktop\Camelllo\camelllo.exe                      │
│  • laadt .gguf modellen uit ./models/               │
│  • runt inferentie op CPU + Vulkan GPU              │
└────────────────────┬────────────────────────────────┘
                     │  llama.cpp API (libllama.a)
                     ▼
┌─────────────────────────────────────────────────────┐
│  GGUF modellen  (Desktop\Camelllo\models\)          │
│  phi3.5.gguf          — 3.82B Q4_K_M               │
│  deepseek-coder.gguf  — 6.70B Q4_K_M (optioneel)  │
└─────────────────────────────────────────────────────┘
```

### Technologieën

| Component    | Technologie              | Versie   | Poort |
|-------------|--------------------------|----------|-------|
| Camelllo    | C++17, llama.cpp b5184   | 1.0.0    | 11500 |
| NEXUS Server| Node.js, Fastify, TS     | 0.1.0    | 3001  |
| NEXUS Client| React 18, Vite, TS       | —        | 5173  |
| Database    | SQLite (node:sqlite)     | built-in | —     |
| GPU backend | Vulkan (RTX 4060)        | —        | —     |

---

## 2. Camelllo — C++ Inference Engine

Camelllo is een **eigen C++ HTTP server** gebouwd bovenop llama.cpp. Het vervangt Ollama maar is 100% Ollama-API-compatibel (zelfde endpoints, zelfde JSON formaat).

### Bestandsstructuur

```
Desktop\Camelllo\
├── camelllo.exe          ← het draaiende programma (gekopieerd vanuit build/)
├── CMakeLists.txt        ← build configuratie (zie sectie 3)
├── camelllo_crash.log    ← stderr redirect — GGML_ASSERT berichten landen hier
├── models\
│   └── phi3.5.gguf       ← het LLM model (zet hier .gguf bestanden neer)
├── src\
│   ├── config.hpp        ← alle runtime instellingen als struct
│   ├── main.cpp          ← entry point, CLI arg parsing, tray init
│   ├── model_manager.cpp ← laad/unload van .gguf modellen
│   ├── model_manager.hpp
│   ├── inference.cpp     ← tokenisatie, batching, sampling, generatie loop
│   ├── inference.hpp
│   ├── server.cpp        ← alle HTTP routes (httplib)
│   ├── tray.cpp          ← Windows system tray icon
│   └── tray.hpp
└── build\                ← CMake build output (gegenereerd)
    ├── camelllo.exe      ← nieuw gebouwde binary (POST_BUILD kopieert dit omhoog)
    └── _deps\
        ├── llama-src\    ← llama.cpp broncode (gefetcht door CMake)
        ├── httplib-src\  ← cpp-httplib header
        └── json-src\     ← nlohmann/json header
```

### src/config.hpp — Configuratie struct

```cpp
struct BmxConfig {
    std::string host      = "127.0.0.1";
    uint16_t    port      = 11500;       // Camelllo's poort (Ollama = 11434)
    std::string models_dir= "./models";  // map met .gguf bestanden

    int32_t n_gpu_layers  = 0;    // GPU layers (0 = puur CPU; Vulkan: zet op 99)
    int32_t n_ctx         = 1024; // context window: tokens prompt + response samen
    int32_t n_batch       = 512;  // max tokens per batch (prefill)
    int32_t n_ubatch      = 256;  // micro-batch voor decode
    int32_t n_threads     = 16;   // CPU threads (Ryzen 7 7435HS = 8 cores / 16 threads)

    float   temperature   = 0.7f; // creativiteit (0.0 = deterministisch, 1.0 = wild)
    float   top_p         = 0.9f; // nucleus sampling drempel
    int32_t max_tokens    = 512;  // max output tokens
    bool    verbose       = false;// llama.cpp logging aan/uit
};
```

Alle waarden zijn **defaults** — je kunt ze overschrijven via CLI flags:
```
camelllo.exe --ctx 2048 --threads 8 --port 11500 --load phi3.5
```

### src/main.cpp — Entry point

1. Opent `camelllo_crash.log` als stderr redirect (GGML crashes komen hierin)
2. Parst CLI argumenten → vult `BmxConfig`
3. Initialiseert llama.cpp backend (`llama_backend_init()`)
4. Suppressed INFO/DEBUG logs, behoudt ERROR logs
5. Start Windows system tray op main thread
6. Start HTTP server op background thread

### src/model_manager.cpp — Model beheer

- Scant `./models/` map voor `.gguf` bestanden
- `load(name)`: laadt een model met `llama_model_load_from_file()`
  - `use_mmap = false` — **kritisch fix**: voorkomt `PrefetchVirtualMemory unavailable` crash op MinGW Windows build
- `get(name)`: geeft pointer terug naar geladen `llama_model*`
- `unload(name)`: roept `llama_model_free()` aan
- Thread-safe via `std::mutex`

### src/inference.cpp — De kern van het systeem

Dit is waar tokens gegenereerd worden. De flow:

```
prompt (string)
    ↓ llama_tokenize()
tokens: vector<llama_token>
    ↓ chunked batch processing (chunks van n_batch)
llama_decode() × N chunks  ← vult KV cache
    ↓ sampler chain
llama_sampler_sample() → token
    ↓ herhaal tot EOG of max_tokens
    ↓ llama_token_to_piece() → string stuk
output stream (via TokenCallback)
```

**Kritische fixes aanwezig in deze code:**

1. **Chunked prompt processing** — de prompt wordt in stukken van `n_batch` grootte verwerkt zodat grote prompts het batch buffer niet overflow-en:
```cpp
int p_pos = 0;
while (p_pos < n_tokens) {
    batch.n_tokens = 0;
    int chunk_end = std::min(p_pos + cfg_.n_batch, n_tokens);
    for (int i = p_pos; i < chunk_end; i++)
        batch_add(tokens[i], i, i == n_tokens - 1);
    llama_decode(ctx, batch);
    p_pos = chunk_end;
}
```

2. **KV-cache position guard** — stopt generatie voordat de KV-cache vol raakt en GGML_ABORT triggert:
```cpp
const int max_pos = (int)cfg_.n_ctx - 1;
for (int i = 0; i < max_tokens; i++) {
    if (n_pos >= max_pos) break;  // nooit de KV cache overflow laten bereiken
    // ... sampling
}
```

### src/server.cpp — HTTP routes

Gebruikt `cpp-httplib` als embedded HTTP server (single-header, geen dependencies).

Alle endpoints — zie [sectie 11](#11-alle-api-endpoints) voor details.

De Ollama-compatibele `/api/generate` gebruikt **NDJSON streaming**:
- Per token wordt één JSON object op een nieuwe regel geschreven
- `{"model":"phi3.5","response":"word","done":false}\n`
- Laatste lijn: `{"model":"phi3.5","response":"","done":true}\n`

### src/tray.cpp — Windows system tray

- Laat Camelllo als achtergrondprogramma draaien (zichtbaar in systeemvak)
- Rechter-klik menu: laad model, toon status, afsluiten
- Gebruikt `Win32 Shell_NotifyIcon API`

---

## 3. CMakeLists.txt uitgelegd

```cmake
cmake_minimum_required(VERSION 3.18)
project(camelllo VERSION 1.0.0 LANGUAGES CXX C)
set(CMAKE_CXX_STANDARD 17)
```
Vereist C++17 (voor `std::optional`, `std::string_view`, structured bindings).

### GPU backend opties

```cmake
option(BMX_CUDA   "Enable NVIDIA CUDA (RTX 4060)"  OFF)
option(BMX_VULKAN "Enable Vulkan (fallback GPU)"   OFF)
```

Bij configuratie activeer je een backend:
```bash
# Vulkan (huidig — werkend)
cmake -B build -G "MinGW Makefiles" -DBMX_VULKAN=ON

# CUDA (vereist CUDA Toolkit geïnstalleerd)
cmake -B build -G "MinGW Makefiles" -DBMX_CUDA=ON
```

Als `BMX_VULKAN=ON` wordt `GGML_VULKAN=ON` doorgegeven aan llama.cpp's eigen CMake — die compileert dan de Vulkan shaders automatisch.

### FetchContent — automatisch dependencies downloaden

```cmake
FetchContent_Declare(llama
  GIT_REPOSITORY https://github.com/ggerganov/llama.cpp.git
  GIT_TAG        b5184     # specifieke commit voor stabiliteit
  GIT_SHALLOW    TRUE      # alleen tip, geen volledige git history
)
set(LLAMA_BUILD_TESTS    OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER   OFF CACHE BOOL "" FORCE)
FetchContent_MakeAvailable(llama)   # downloadt + compileert llama.cpp
```

Hetzelfde voor `cpp-httplib` (v0.16.0) en `nlohmann/json` (v3.11.3) — beide zijn header-only dus ze compileren niet zelf.

### Executable definitie

```cmake
add_executable(camelllo
  src/main.cpp
  src/model_manager.cpp
  src/inference.cpp
  src/server.cpp
  src/tray.cpp
)
```

### Include directories

```cmake
target_include_directories(camelllo PRIVATE
  src
  ${llama_SOURCE_DIR}/include        # llama.h
  ${llama_SOURCE_DIR}/ggml/include   # ggml.h
)
```

### Link libraries

```cmake
target_link_libraries(camelllo PRIVATE
  llama                           # libllama.a — de inference bibliotheek
  ggml                            # libggml.a  — de tensor engine
  httplib::httplib                # header-only HTTP server
  nlohmann_json::nlohmann_json    # header-only JSON
)

# Windows specifiek
target_link_libraries(camelllo PRIVATE ws2_32 crypt32 shell32)
# ws2_32  = Winsock (TCP/IP)
# crypt32 = cryptografie
# shell32 = voor tray/shell functies
```

### Compile definities

```cmake
target_compile_definitions(camelllo PRIVATE
  CPPHTTPLIB_THREAD_POOL_COUNT=8   # 8 parallelle HTTP worker threads
  CPPHTTPLIB_NO_EXCEPTIONS         # geen C++ exceptions in httplib
  _WIN32_WINNT=0x0A00              # target Windows 10+
)
```

### Post-build copy

```cmake
add_custom_command(TARGET camelllo POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E copy
    $<TARGET_FILE:camelllo>         # build/camelllo.exe
    "${CMAKE_SOURCE_DIR}/camelllo.exe"  # Desktop\Camelllo\camelllo.exe
  COMMENT "Camelllo engine built → camelllo.exe"
)
```

**Let op:** Als `camelllo.exe` draait tijdens het bouwen mislukt deze copy step — make verwijdert dan ook de build output. Altijd Camelllo stoppen vóór een rebuild.

### Compleet rebuild commando

```powershell
# Vanuit Desktop\Camelllo\:
Stop-Process -Name "camelllo" -Force -ErrorAction SilentlyContinue

# Eerste keer (met Vulkan):
cmake -B build -G "MinGW Makefiles" -DBMX_VULKAN=ON -DCMAKE_BUILD_TYPE=Release

# Altijd daarna:
cmake --build build --config Release --target camelllo -j8
```

---

## 4. NEXUS Server — Node.js/Fastify backend

**Locatie:** `Desktop\utm_AI_Project\nexus\server\`
**Poort:** 3001
**Tech stack:** Node.js 22, Fastify, TypeScript, SQLite (node:sqlite built-in)

### Starten

```bash
cd nexus/server
npm run dev   # tsx watch mode (hot-reload)
# of
npm run build && npm start  # productie
```

### src/index.ts — Entry point

Initialiseert alles in volgorde:
1. SQLite database (`initDatabase()`)
2. CORS middleware
3. Registreert alle route handlers
4. Healthcheck op `GET /health`
5. Start op poort 3001
6. Start FORGE file watcher

### Routestructuur

| Route bestand          | Base path        | Functie                                    |
|------------------------|------------------|--------------------------------------------|
| `routes/command.ts`    | `/command`       | Hoofd AI chat endpoint (SSE stream)        |
| `routes/agents.ts`     | `/agents`        | Agent status, profielen ophalen            |
| `routes/feedback.ts`   | `/feedback`      | User ratings opslaan voor training         |
| `routes/forge.ts`      | `/forge`         | FORGE code assistant                       |
| `routes/training.ts`   | `/training`      | Model training runs starten/status         |
| `routes/config.ts`     | `/config`        | Systeem instellingen lezen/schrijven        |
| `routes/voice.ts`      | `/voice`         | Text-to-speech synthesis                   |
| `routes/ecosystem.ts`  | `/ecosystem`     | Ideeën genereren, research, marktanalyse   |
| `routes/automation.ts` | `/automation`    | Geautomatiseerde taak flows                |
| `routes/discord.ts`    | `/discord`       | Discord bot integratie                     |
| `routes/system-control`| `/system`        | PC control (apps openen, screenshots etc.) |
| `routes/trading.ts`    | `/trading`       | Crypto trading strategies                  |
| `routes/notes.ts`      | `/notes`         | Notities opslaan                           |
| `routes/maps.ts`       | `/maps`          | Geocoding via OpenStreetMap                |
| `routes/integrations.ts`| `/integrations` | Externe service koppelingen                |
| `routes/bot-apis.ts`   | `/bot`           | Bot API management                         |

### services/orchestrator.ts — Het brein

De orchestrator verwerkt elke user message:

```
1. Keyword routing (instant, geen model call):
   • "debug/fix/code"  → forge
   • "idea/brainstorm" → spark
   • "plan/roadmap"    → tactix
   • "explain/what is" → atlas
   • "nexus/system"    → nexus_ui
   • alles ander       → vega

2. Prompt opbouwen:
   fullPrompt = systemPrompt + locationCtx + forgeCtx + historyCtx + "\nUser: " + prompt + "\n\nAssistant:"

3. streamAgent() aanroepen:
   POST http://localhost:11500/api/generate
   {model: "phi3.5", prompt: fullPrompt, stream: true, options: {temperature, num_predict: 512}}

4. NDJSON tokens forwarden naar SSE client:
   onStream({type: 'token', data: {agent, token}})

5. Als 2+ agents reageerden → APEX-2 synthese:
   streamAgent('apex1', synthPrompt, 0.35, ...)
```

### services/ollama.ts — Camelllo communicatie

```typescript
// Non-streaming (voor ecosystem routes)
export async function queryAgent(modelId, prompt, temperature=0.7): Promise<string> {
  const response = await axios.post(`${url()}/api/generate`, {
    model: resolveModel(modelId),  // "apex1" → "phi3.5"
    prompt,
    stream: false,
    options: { temperature, num_predict: 512 }
  });
  return response.data.response;
}

// Streaming (voor chat)
export async function streamAgent(modelId, prompt, temperature, onToken): Promise<void> {
  const response = await axios.post(..., { responseType: 'stream' });
  // Parse NDJSON lijn voor lijn
  // Roep onToken() aan voor elk token stuk
}
```

Model name mapping (agent ID → GGUF bestandsnaam):
```
apex1, apex2, spark, atlas, tactix, vega, nexus_ui → "phi3.5"
forge → "deepseek-coder"
```

### services/config.ts — Systeem configuratie

Instellingen worden geladen in volgorde:
1. Defaults (hardcoded)
2. `nexus/server/data/system-config.json` (bestand)
3. Environment variables (overschrijven alles)

Belangrijke instelling: `ollamaUrl = "http://localhost:11500"` — dit is het Camelllo adres.

---

## 5. NEXUS Client — React/Vite frontend

**Locatie:** `Desktop\utm_AI_Project\nexus\client\`
**Poort:** 5173 (Vite dev server)

### Starten

```bash
cd nexus/client
npm run dev   # Vite dev server op port 5173
```

### src/App.tsx — Root component

Beheert:
- Actief tabblad (opgeslagen in `localStorage`)
- Overlay modes: Jarvis, Neural, Ecosystem
- Sidebar navigatie
- Header met status pills (Server, Camelllo, Forge)

Tabs en hun componenten:

| Tab         | Component            | Functie                            |
|-------------|---------------------|------------------------------------|
| Command     | `Command.tsx`        | Hoofd AI chat interface            |
| Forge Lab   | `ForgeLabPage.tsx`   | FORGE training & code lab          |
| Neural      | `NeuralNetView.tsx`  | Visualisatie agent netwerk         |
| Automation  | `AutomationPage.tsx` | Geautomatiseerde flows             |
| Trade       | `TradePage.tsx`      | Crypto trading terminal            |
| Agents      | `AgentSettingsPage`  | Agent profielen bewerken           |
| API         | `ApiManagerPage.tsx` | Externe API sleutels                |
| System      | `Settings.tsx`       | Systeem instellingen               |

Overlay modes (linker sidebar onderkant):

| Knop   | Overlay               |
|--------|-----------------------|
| ECO    | `EcosystemPage.tsx`   |
| NET    | `NeuralOverlay.tsx`   |
| JARVIS | `JarvisUI.tsx`        |

### hooks/useNexus.ts — Hoofd hook

Beheert de verbinding met de NEXUS server:
- Stuurt berichten via `POST /command/stream` (SSE)
- Verwerkt inkomende event types: `routing`, `token`, `agent_response`, `synthesis_token`, `done`, `error`
- Houdt chat history bij
- Beheert agent streaming states

### pages/Command.tsx — Chat interface

- Input box voor user messages
- Per-agent response kolommen
- Real-time token streaming weergave
- Routing announcement display
- Action tag detectie en uitvoering (NEXUS_ACTION)

### pages/EcosystemPage.tsx — Pixel-art RPG ecosystem

Canvas-gebaseerde visualisatie van het agent systeem:
- Pixel-art RPG town stijl (Stardew Valley geïnspireerd)
- Elke agent is een sprite op de kaart
- **Opdrachten systeem**: toont echte user commands, niet nep taken
  - Per command: type, status (bezig/klaar/fout), voortgang per agent
  - Live progress bar tijdens generatie
- **DATASETS panel**: toont echte dataset statistieken

### components/JarvisUI.tsx — Jarvis overlay

Volledig scherm AI assistent mode:
- Spreekt direct met `apex1` in "JARVIS persona" mode
- Kort, gesproken-vriendelijke antwoorden
- Ondersteunt computer control actions

---

## 6. Agent systeem

### De 8 agents (allemaal phi3.5 als model)

| Agent ID  | Naam      | Specialiteit               | Temperature |
|-----------|-----------|----------------------------|-------------|
| `apex1`   | APEX-1    | Router (kiest welke agents)| 0.2         |
| `apex2`   | APEX-2    | Quality controller/synthese| 0.2         |
| `forge`   | FORGE     | Code, scripting, technisch | 0.4         |
| `spark`   | SPARK     | Creatief, brainstorm       | 0.9         |
| `atlas`   | ATLAS     | Kennis, research, feiten   | 0.4         |
| `tactix`  | TACTIX    | Planning, strategie        | 0.4         |
| `vega`    | VEGA      | Generalist, casual chat    | 0.6         |
| `nexus_ui`| NEXUS-UI  | NEXUS zelf uitleggen       | 0.5         |

### Routing logica

Routing is **keyword-gebaseerd** (geen model call nodig):
```
"debug/fix/bug/code/typescript/python/c++" → forge
"idea/brainstorm/creatief/invent"          → spark
"plan/roadmap/strategie/milestone"         → tactix
"explain/what is/how does/research"        → atlas
"nexus/agent/system"                       → nexus_ui
alles anders                               → vega

"team nexus" / "nexus team"               → alle 6 non-apex agents tegelijk
```

### Computer action tags

Agents kunnen acties uitvoeren op de PC via tags aan het einde van hun antwoord:
```
[NEXUS_ACTION:open_app:notepad]
[NEXUS_ACTION:run_command:Get-Process]
[NEXUS_ACTION:take_screenshot:]
[NEXUS_ACTION:write_file:C:\pad|inhoud]
```

De system-control route (`routes/system-control.ts`) pakt deze tags op en voert ze uit via PowerShell/Windows API.

---

## 7. Database — SQLite

**Bestand:** `nexus/server/nexus.db`
**Gebruikt:** Node.js 22 built-in `node:sqlite` (geen externe dependency!)

### Tabellen

```sql
command_log      -- elke user prompt + routing beslissing + agent responses
feedback         -- user ratings (thumbs up/down) voor training
forge_fixes      -- automatische code fixes door FORGE
training_runs    -- bijgehouden training sessies
trade_strategies -- crypto trading strategie outputs
```

### Data bekijken

```powershell
# SQLite CLI (als geïnstalleerd):
sqlite3 nexus\server\nexus.db ".tables"
sqlite3 nexus\server\nexus.db "SELECT * FROM command_log ORDER BY timestamp DESC LIMIT 5;"

# Of via de NEXUS API:
GET http://localhost:3001/training/stats
```

---

## 8. Dataflow: van user input tot AI response

```
1. USER typt in Command.tsx input box
           ↓
2. useNexus.ts stuurt:
   POST http://localhost:3001/command/stream
   Body: {prompt, sessionId, location?}
           ↓
3. routes/command.ts ontvangt, opent SSE verbinding,
   roept processCommand() aan in orchestrator.ts
           ↓
4. orchestrator.ts:
   a) keyword routing → kiest agent(s)
   b) onStream({type:'routing', data:{agents, announcement}})
   c) buildForgeContext() als forge agent
   d) bouwt fullPrompt: systemPrompt + context + history + userPrompt
           ↓
5. streamAgent() in ollama.ts:
   POST http://localhost:11500/api/generate
   {model:"phi3.5", prompt:fullPrompt, stream:true, options:{temperature, num_predict:512}}
           ↓
6. Camelllo (camelllo.exe) op poort 11500:
   a) resolve_ollama("forge") → "deepseek-coder" of "phi3.5"
   b) ensure_model() → laad model als nog niet geladen
   c) engine.generate(model, p, callback)
   d) inference.cpp: tokenize → batch decode → sample loop
   e) per token: NDJSON line schrijven naar HTTP response
   {"model":"phi3.5","response":"Hallo","done":false}
           ↓
7. ollama.ts ontvangt NDJSON stream:
   - parseert lijn voor lijn
   - roept onToken(token) aan
   - orchestrator roept onStream({type:'token', data:{agent, token}}) aan
           ↓
8. routes/command.ts stuurt SSE event naar browser:
   data: {"type":"token","data":{"agent":"forge","token":"Hallo"}}
           ↓
9. useNexus.ts hook in browser ontvangt event,
   update React state → component re-renders → token verschijnt in UI
           ↓
10. Na alle tokens:
    - agent_response event met volledige tekst
    - Als 2+ agents: apex1 synthese run
    - done event → loading state uit
    - SQLite: command opgeslagen in command_log
```

---

## 9. Vulkan GPU acceleratie

De huidige `camelllo.exe` is **gebouwd met Vulkan** (RTX 4060).

### Hoe werkt Vulkan in llama.cpp?

1. **GGML Vulkan backend** compileert Vulkan compute shaders (GLSL → SPIR-V)
2. Matrix multiplicaties (het zware werk van attention + FFN) lopen op GPU
3. CPU doet tokenisatie, sampling, en KV-cache management
4. Model gewichten worden gekopieerd naar GPU VRAM

### GPU layers instelling

In `config.hpp`: `n_gpu_layers = 0` (default = alles op CPU)

Om GPU te gebruiken, start Camelllo met:
```
camelllo.exe --gpu-layers 99
```
`99` = offload zo veel mogelijk layers (llama.cpp beperkt automatisch tot wat past).

Voor phi3.5 (3.82B Q4_K_M ≈ 2.4 GB): past volledig in RTX 4060 (8 GB VRAM).

**Vereiste:** Vulkan SDK geïnstalleerd (`vulkan.lunarg.com`).

### Verschil CPU vs Vulkan

| Modus   | Tokens/sec (phi3.5 Q4) | Latency eerste token |
|---------|------------------------|----------------------|
| CPU     | ~3-8 t/s               | ~1-2 sec             |
| Vulkan  | ~20-50 t/s             | ~0.5 sec             |

---

## 10. Bouwen en deployen (rebuild workflow)

### Vereisten

- **MSYS2 MinGW64**: `C:\msys64\mingw64\bin\` in PATH
  - g++, gcc, cmake, ninja/make beschikbaar
- **Vulkan SDK**: geïnstalleerd en in PATH
- **Git**: voor FetchContent (downloads llama.cpp automatisch)

### Eerste keer bouwen (clean)

```powershell
# Zorg dat Camelllo NIET draait
Stop-Process -Name "camelllo" -Force -ErrorAction SilentlyContinue

cd C:\Users\eub11\Desktop\Camelllo

# Optioneel: clean build directory
Remove-Item build -Recurse -Force

# Configureer (eenmalig)
cmake -B build -G "MinGW Makefiles" -DBMX_VULKAN=ON -DCMAKE_BUILD_TYPE=Release

# Bouw
cmake --build build --config Release --target camelllo -j8
```

### Daarna (incrementeel)

```powershell
Stop-Process -Name "camelllo" -Force -ErrorAction SilentlyContinue
Set-Location "C:\Users\eub11\Desktop\Camelllo"
cmake --build build --config Release --target camelllo -j8
# POST_BUILD kopieert automatisch naar camelllo.exe
```

### Camelllo starten na rebuild

```powershell
Start-Process "C:\Users\eub11\Desktop\Camelllo\camelllo.exe" `
  -WorkingDirectory "C:\Users\eub11\Desktop\Camelllo"

# Health check:
Invoke-WebRequest http://localhost:11500/health | Select-Object -ExpandProperty Content
```

### NEXUS servers starten

```powershell
# Backend (terminal 1):
cd C:\Users\eub11\Desktop\utm_AI_Project\nexus\server
npm run dev

# Frontend (terminal 2):
cd C:\Users\eub11\Desktop\utm_AI_Project\nexus\client
npm run dev
```

Open browser: `http://localhost:5173`

---

## 11. Alle API endpoints

### Camelllo (poort 11500)

#### Ollama-compatibele endpoints

| Methode | Endpoint        | Beschrijving                          |
|---------|-----------------|---------------------------------------|
| GET     | `/health`       | `{"status":"ok","engine":"Camelllo"}` |
| GET     | `/api/tags`     | Lijst beschikbare modellen            |
| GET     | `/api/ps`       | Geladen modellen                      |
| POST    | `/api/generate` | Genereer tekst (streaming of volledig)|
| POST    | `/api/show`     | Model details                         |

**POST /api/generate body:**
```json
{
  "model": "phi3.5",
  "prompt": "Jouw vraag hier",
  "stream": true,
  "options": {
    "temperature": 0.7,
    "num_predict": 512
  }
}
```

**Streaming response (NDJSON):**
```
{"model":"phi3.5","created_at":"1234567890","response":"Hallo","done":false}
{"model":"phi3.5","created_at":"1234567890","response":" wereld","done":false}
{"model":"phi3.5","created_at":"1234567890","response":"","done":true}
```

#### Camelllo-eigen endpoints

| Methode | Endpoint                 | Beschrijving                |
|---------|--------------------------|-----------------------------|
| GET     | `/camelllo/models`       | Lijst met .gguf bestanden   |
| POST    | `/camelllo/load`         | Laad specifiek model        |
| DELETE  | `/camelllo/models/:name` | Unload model                |
| GET     | `/camelllo/ps`           | Draaiende modellen          |
| POST    | `/camelllo/generate`     | Direct generate (SSE format)|

#### OpenAI-compatibel

| Methode | Endpoint                  | Beschrijving              |
|---------|---------------------------|---------------------------|
| POST    | `/v1/chat/completions`    | Chat completions (OpenAI) |

### NEXUS Server (poort 3001)

| Methode | Endpoint                | Beschrijving                        |
|---------|-------------------------|-------------------------------------|
| GET     | `/health`               | Server status                       |
| POST    | `/command/stream`       | Hoofd AI chat (SSE stream)          |
| GET     | `/agents`               | Agent profielen                     |
| POST    | `/feedback`             | Rating opslaan                      |
| GET     | `/config`               | Systeem instellingen                |
| POST    | `/config`               | Instellingen updaten                |
| POST    | `/ecosystem/ideas`      | Ideeën genereren                    |
| POST    | `/ecosystem/research`   | Research uitvoeren                  |
| POST    | `/ecosystem/market`     | Marktanalyse                        |
| POST    | `/system/execute`       | PC actie uitvoeren                  |
| POST    | `/voice/synthesize`     | TTS genereren                       |
| GET     | `/training/stats`       | Training statistieken               |
| POST    | `/training/start`       | Training run starten                |

---

## 12. Configuratie referentie

### Camelllo CLI flags

```
--host <addr>       bind adres           (default: 127.0.0.1)
--port <port>       luister poort        (default: 11500)
--models <dir>      .gguf model map      (default: ./models)
--gpu-layers <n>    GPU layers offload   (default: 0 = CPU, 99 = alles)
--ctx <n>           context grootte      (default: 1024)
--threads <n>       CPU threads          (default: 16)
--load <model>      auto-laad bij start  (bijv: --load phi3.5)
--no-tray           geen systeem tray
--verbose           llama.cpp logging aan
```

### NEXUS Server environment variables

```env
PORT=3001                              # Server poort
OLLAMA_URL=http://localhost:11500      # Camelllo adres
CAMELLLO_URL=http://localhost:11500    # Alias voor OLLAMA_URL
GITHUB_TOKEN=ghp_...                  # GitHub PAT voor FORGE GitHub search
VOICE_ENABLED=true                    # Text-to-speech aan/uit
```

### system-config.json (via /config endpoint of bestand)

```json
{
  "port": 3001,
  "ollamaUrl": "http://localhost:11500",
  "maxConversationHistory": 6,
  "defaultLanguage": "nl",
  "voiceEnabled": true,
  "requireActionConfirmation": true,
  "requireSendConfirmation": true,
  "autoTrainOnFeedback": true,
  "githubToken": ""
}
```

---

## 13. Troubleshooting

### Camelllo start niet

```powershell
# Check of poort al bezet is:
netstat -ano | findstr 11500

# Check crash log:
Get-Content C:\Users\eub11\Desktop\Camelllo\camelllo_crash.log -Tail 30
```

### Model laad crash (`PrefetchVirtualMemory unavailable`)

**Al opgelost** in `model_manager.cpp`:
```cpp
params.use_mmap = false;  // FIX: voorkomt crash op MinGW Windows build
```
Als het terugkomt: check of de juiste binary draait (check timestamp).

### Generatie aborts / ECONNRESET

Oorzaken en fixes:
1. **Batch overflow** → opgelost: chunked processing in `inference.cpp`
2. **KV-cache overflow** → opgelost: `if (n_pos >= max_pos) break;`
3. **Onbekende assert** → check `camelllo_crash.log` voor exacte GGML_ASSERT bericht

### NEXUS server verbindt niet met Camelllo

```powershell
# Test directe verbinding:
Invoke-WebRequest http://localhost:11500/health
# Verwacht: {"status":"ok","engine":"Camelllo"}

# Check of Camelllo draait:
Get-Process -Name "camelllo"
```

### Tekst genereert maar niets verschijnt in UI

Check:
1. NEXUS server draait op poort 3001: `Invoke-WebRequest http://localhost:3001/health`
2. Browser console op errors (F12 → Console)
3. Network tab in DevTools: check of `/command/stream` SSE events ontvangt
4. `ollama.ts` parsed NDJSON: elke lijn moet `{"response":"..."}` bevatten

### Vulkan werkt niet (geen GPU versnelling)

```powershell
# Check of Vulkan SDK geïnstalleerd is:
Get-Command vulkaninfo -ErrorAction SilentlyContinue
vulkaninfo 2>$null | Select-String "GPU id"

# Check of Camelllo Vulkan libraries laadt:
# Start met --verbose en check logs
```

Hercompileer als Vulkan DLLs missen:
```powershell
Stop-Process -Name "camelllo" -Force -ErrorAction SilentlyContinue
cmake --build C:\Users\eub11\Desktop\Camelllo\build --config Release --target camelllo -j8
```

### Frontend laadt niet

```powershell
# Check of Vite draait:
netstat -ano | findstr 5173

# Herstart:
cd C:\Users\eub11\Desktop\utm_AI_Project\nexus\client
npm run dev
```

### Database corrupt of weg

```powershell
# Verwijder en laat opnieuw aanmaken:
Remove-Item "C:\Users\eub11\Desktop\utm_AI_Project\nexus\server\nexus.db"
# Herstart server — initDatabase() maakt alles opnieuw aan
```

---

## Snelle referentie — alle poorten

| Service      | Poort | URL                          |
|-------------|-------|------------------------------|
| Camelllo    | 11500 | http://localhost:11500       |
| NEXUS Server| 3001  | http://localhost:3001        |
| NEXUS Client| 5173  | http://localhost:5173        |
| (Ollama ref)| 11434 | niet gebruikt — vervangen door Camelllo |

## Snelle referentie — bestandspaden

| Wat                    | Pad                                                              |
|------------------------|------------------------------------------------------------------|
| Camelllo executable    | `Desktop\Camelllo\camelllo.exe`                                  |
| Camelllo crash log     | `Desktop\Camelllo\camelllo_crash.log`                            |
| Camelllo modellen      | `Desktop\Camelllo\models\*.gguf`                                 |
| NEXUS server source    | `Desktop\utm_AI_Project\nexus\server\src\`                      |
| NEXUS client source    | `Desktop\utm_AI_Project\nexus\client\src\`                      |
| SQLite database        | `Desktop\utm_AI_Project\nexus\server\nexus.db`                  |
| Systeem config         | `Desktop\utm_AI_Project\nexus\server\data\system-config.json`   |
| CMakeLists.txt         | `Desktop\Camelllo\CMakeLists.txt`                                |
| Build output           | `Desktop\Camelllo\build\camelllo.exe`                           |
