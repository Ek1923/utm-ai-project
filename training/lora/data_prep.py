import os
import json
import glob
import random
from datasets import Dataset
from config import data_dir, MAX_EXAMPLES, SYSTEM_PROMPTS, LORA_AGENTS

# Phi-3.5-mini chat template format
def _format_example(prompt: str, response: str, system: str) -> str:
    return (
        f"<|system|>\n{system}<|end|>\n"
        f"<|user|>\n{prompt}<|end|>\n"
        f"<|assistant|>\n{response}<|end|>"
    )


def _load_jsonl(path: str) -> list[dict]:
    records = []
    with open(path, encoding='utf-8') as f:
        for lineno, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as e:
                print(f"[data_prep] SKIP {os.path.basename(path)}:{lineno} — {e}")
                continue
            if 'prompt' not in obj or 'response' not in obj:
                continue
            records.append({'prompt': str(obj['prompt']), 'response': str(obj['response'])})
    return records


def load_agent_pairs(agent: str) -> list[dict]:
    if agent not in LORA_AGENTS:
        raise ValueError(f"'{agent}' is not a LoRA agent. Valid: {LORA_AGENTS}")

    agent_dir = data_dir(agent)
    if not os.path.isdir(agent_dir):
        raise FileNotFoundError(f"No data directory for agent '{agent}': {agent_dir}")

    files = sorted(glob.glob(os.path.join(agent_dir, '*.jsonl')))
    if not files:
        raise FileNotFoundError(f"No JSONL files in {agent_dir}")

    pairs: list[dict] = []
    for fpath in files:
        loaded = _load_jsonl(fpath)
        print(f"[data_prep] {os.path.basename(fpath):45s}  {len(loaded):>5} pairs")
        pairs.extend(loaded)

    # Shuffle so we don't train in file order (avoids bias)
    random.seed(42)
    random.shuffle(pairs)

    # Apply per-agent cap
    cap = MAX_EXAMPLES.get(agent)
    if cap and len(pairs) > cap:
        pairs = pairs[:cap]
        print(f"[data_prep] Capped at {cap} examples")

    print(f"[data_prep] Agent '{agent}': {len(pairs)} training examples total")
    return pairs


def build_dataset(agent: str) -> Dataset:
    pairs  = load_agent_pairs(agent)
    system = SYSTEM_PROMPTS[agent]
    texts  = [
        {'text': _format_example(p['prompt'], p['response'], system)}
        for p in pairs
    ]
    return Dataset.from_list(texts)


if __name__ == '__main__':
    import sys
    agent = sys.argv[1] if len(sys.argv) > 1 else 'jarvis'
    ds = build_dataset(agent)
    print(f"\nDataset ready: {len(ds)} examples")
    print("Sample:\n" + ds[0]['text'][:400])