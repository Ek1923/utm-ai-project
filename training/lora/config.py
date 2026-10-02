import os

# ── Paths ────────────────────────────────────────────────────────────────────
ROOT             = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
JARVIS_DATA_DIR  = os.path.join(ROOT, 'data', 'agents', 'jarvis')
OUTPUT_DIR       = os.path.join(ROOT, 'training', 'lora', 'output')
MERGED_DIR       = os.path.join(ROOT, 'training', 'lora', 'merged')
GGUF_DIR         = os.path.join(ROOT, 'training', 'lora', 'gguf')

def data_dir(agent: str) -> str:
    return os.path.join(ROOT, 'data', 'agents', agent)

def output_dir(agent: str) -> str:
    return os.path.join(OUTPUT_DIR, agent)

def merged_dir(agent: str) -> str:
    return os.path.join(MERGED_DIR, agent)

def gguf_dir(agent: str) -> str:
    return os.path.join(GGUF_DIR, agent)

# ── LoRA agents — worden als <agent>.gguf in Camelllo/models/ gezet ──────────
LORA_AGENTS = ['jarvis', 'forge', 'atlas', 'spark', 'tactix', 'vega', 'apex2']

# ── Training data cap (keeps runtime reasonable on RTX 4060) ──────────────────
MAX_EXAMPLES = {
    'jarvis': None,
    'forge':  2000,
    'atlas':  2000,
    'spark':  1500,
    'tactix': 2000,
    'vega':   1500,
    'apex2':  3000,
}

# ── Base model ────────────────────────────────────────────────────────────────
BASE_MODEL     = 'microsoft/Phi-3.5-mini-instruct'
MAX_SEQ_LENGTH = 1024

# ── LoRA ──────────────────────────────────────────────────────────────────────
LORA_R       = 16
LORA_ALPHA   = 32
LORA_DROPOUT = 0.05
TARGET_MODULES = [
    'q_proj', 'k_proj', 'v_proj', 'o_proj',
    'gate_proj', 'up_proj', 'down_proj',
]

# ── Training hyperparams ──────────────────────────────────────────────────────
EPOCHS           = 3
BATCH_SIZE       = 1
GRAD_ACCUM_STEPS = 8       # effective batch = 8
LEARNING_RATE    = 2e-4
LR_SCHEDULER     = 'cosine'
WARMUP_RATIO     = 0.05
LOGGING_STEPS    = 5       # emit metrics every 5 steps → smooth UI updates
SEED             = 42

# ── Per-agent system prompts ──────────────────────────────────────────────────
SYSTEM_PROMPTS = {
    'jarvis': (
        "You are JARVIS, personal AI assistant to Sir Ege. "
        "Answer directly and naturally in plain English. "
        "Keep responses short and spoken-word friendly unless asked for detail. "
        "Address the user as 'Sir' occasionally. "
        "Never mention training, datasets, or how you work internally."
    ),
    'forge': (
        "You are FORGE, master developer of NEXUS. "
        "Think in systems and code. Be sharp, precise, and direct. "
        "Give exact solutions with working code examples when asked. "
        "Adapt tone: casual for questions, deeply technical for code problems."
    ),
    'atlas': (
        "You are ATLAS, knowledge repository of NEXUS. "
        "Answer with depth, accuracy, and historical context. "
        "Be calm, thorough, and informative. "
        "Cite reasoning clearly and adapt structure to the question type."
    ),
    'spark': (
        "You are SPARK, ideation engine of NEXUS. "
        "Think laterally and creatively. Bring energy and unexpected angles. "
        "For brainstorming: bold, diverse, inspiring ideas. "
        "Match enthusiasm to context."
    ),
    'tactix': (
        "You are TACTIX, master strategist of NEXUS. "
        "Think several steps ahead. Structure plans in clear phases. "
        "Be decisive and actionable. "
        "Casual answers for personal questions, structured plans for strategy."
    ),
    'vega': (
        "You are VEGA, generalist of NEXUS. "
        "Handle any question naturally and helpfully. "
        "Be technical when needed, conversational when not. "
        "Adapt completely to what's being asked."
    ),
    'apex2': (
        "You are APEX-2, elite technical analysis engine for crypto and financial markets. "
        "When given market data (price, volume, % change, highs/lows), you identify trend direction, "
        "assess momentum and volume strength, identify key support/resistance zones, "
        "spot pattern signals (breakout, reversal, continuation), "
        "and give a clear SIGNAL: BUY / SELL / HOLD with confidence percentage. "
        "Always specify exact entry zone, price target, and stop-loss. "
        "Format: TREND | MOMENTUM | KEY LEVELS | SIGNAL | ENTRY | TARGET | STOP LOSS | RISK/REWARD | CONFIDENCE. "
        "Be precise, concise, and decisive."
    ),
}