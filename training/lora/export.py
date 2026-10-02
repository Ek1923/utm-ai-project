"""
Export pipeline — Camelllo GGUF only. Geen Ollama.

Flow:
  1. Merge LoRA adapters → float16 safetensors  (training/lora/merged/<agent>/)
  2. Convert merged model → Q8_0 GGUF           (training/lora/gguf/<agent>/<agent>.gguf)
  3. Kopieer GGUF → Camelllo/models/<agent>.gguf
  4. POST /camelllo/load  →  model direct beschikbaar
"""

import os
import sys
import gc
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

from config import BASE_MODEL, output_dir, merged_dir, gguf_dir, LORA_AGENTS

# ── Vaste paden ───────────────────────────────────────────────────────────────
_HERE            = Path(__file__).parent
CONVERT_SCRIPT   = Path(r"C:\Users\eub11\Desktop\Camelllo\build\_deps\llama-src\convert_hf_to_gguf.py")
CAMELLLO_MODELS  = Path(r"C:\Users\eub11\Desktop\Camelllo\models")
CAMELLLO_URL     = "http://localhost:11500"
VENV_PYTHON      = _HERE.parent / ".venv" / "Scripts" / "python.exe"


def log(msg: str):
    print(msg, flush=True)


def _run(cmd: list[str | Path], cwd: Path | None = None):
    cmd_s = [str(c) for c in cmd]
    log(f"[export] $ {' '.join(cmd_s)}")
    proc = subprocess.run(cmd_s, capture_output=True, text=True, cwd=str(cwd) if cwd else None)
    if proc.stdout:
        for line in proc.stdout.splitlines():
            log(f"[export]   {line}")
    if proc.stderr:
        for line in proc.stderr.splitlines()[:60]:   # max 60 stderr lines
            print(f"[export] ! {line}", file=sys.stderr, flush=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed (exit {proc.returncode}): {' '.join(cmd_s)}")


# ── Stap 1: Merge LoRA adapters ───────────────────────────────────────────────
def merge_adapters(agent: str):
    adapter_path = output_dir(agent)
    merge_path   = merged_dir(agent)
    os.makedirs(merge_path, exist_ok=True)

    # Free GPU memory left over from training before loading base model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
    gc.collect()

    log(f"[export] Laad base model (bfloat16, cpu)...")
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.bfloat16,
        device_map='cpu',
        low_cpu_mem_usage=True,
        trust_remote_code=True,
    )
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)

    log(f"[export] Laad LoRA adapter: {adapter_path}")
    model = PeftModel.from_pretrained(base, adapter_path, device_map='cpu')

    log("[export] Merge adapters in base weights...")
    model = model.merge_and_unload()
    gc.collect()

    log(f"[export] Sla merged model op → {merge_path}")
    model.save_pretrained(merge_path, safe_serialization=True, max_shard_size='2GB')
    tokenizer.save_pretrained(merge_path)

    del model, base
    gc.collect()
    log("[export] Merge klaar — RAM vrijgemaakt.")


# ── Stap 2: Converteer naar GGUF ──────────────────────────────────────────────
def convert_to_gguf(agent: str) -> Path:
    merge_path = Path(merged_dir(agent))
    out_dir    = Path(gguf_dir(agent))
    out_dir.mkdir(parents=True, exist_ok=True)

    gguf_path = out_dir / f"{agent}.gguf"

    if not CONVERT_SCRIPT.exists():
        raise FileNotFoundError(
            f"convert_hf_to_gguf.py niet gevonden op:\n  {CONVERT_SCRIPT}\n"
            "Controleer of Camelllo build aanwezig is."
        )

    log(f"[export] Converteer {agent} → GGUF Q8_0...")
    log(f"[export]   input:  {merge_path}")
    log(f"[export]   output: {gguf_path}")

    _run(
        [VENV_PYTHON, CONVERT_SCRIPT, merge_path, "--outtype", "q8_0", "--outfile", gguf_path],
        cwd=CONVERT_SCRIPT.parent,   # zodat convert script zijn gguf-py module vindt
    )

    size_mb = gguf_path.stat().st_size // 1_000_000
    log(f"[export] GGUF klaar: {gguf_path.name}  ({size_mb} MB)")
    return gguf_path


# ── Stap 3: Zet GGUF in Camelllo/models/ ─────────────────────────────────────
def deploy_to_camelllo(agent: str, gguf_path: Path):
    CAMELLLO_MODELS.mkdir(parents=True, exist_ok=True)
    dest = CAMELLLO_MODELS / f"{agent}.gguf"

    log(f"[export] Kopieer → {dest}")
    shutil.copy2(gguf_path, dest)

    size_mb = dest.stat().st_size // 1_000_000
    log(f"[export] Gedeployed: {dest.name}  ({size_mb} MB)")


# ── Stap 4: Laad model in Camelllo via API ────────────────────────────────────
def load_in_camelllo(agent: str):
    url     = f"{CAMELLLO_URL}/camelllo/load"
    payload = json.dumps({"model": agent}).encode()
    req     = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode()
            log(f"[export] Camelllo load: {body}")
            log(f"[export] ✓ {agent} is live in Camelllo op port 11500.")
    except Exception as e:
        log(f"[export] Camelllo niet bereikbaar ({e})")
        log(f"[export] Model staat klaar in {CAMELLLO_MODELS}/{agent}.gguf")
        log(f"[export] Start Camelllo opnieuw — hij pikt het model automatisch op.")


# ── Hoofd export functie ──────────────────────────────────────────────────────
def export(agent: str):
    log(f"[export] === EXPORT: {agent.upper()} → Camelllo GGUF ===")
    merge_adapters(agent)
    gguf_path = convert_to_gguf(agent)
    deploy_to_camelllo(agent, gguf_path)
    load_in_camelllo(agent)
    log(f"[export] === KLAAR: {agent}.gguf actief in Camelllo ===")


if __name__ == '__main__':
    agent = sys.argv[1] if len(sys.argv) > 1 else 'jarvis'
    if agent not in LORA_AGENTS:
        print(f"Onbekende agent: {agent}. Kies uit: {LORA_AGENTS}", file=sys.stderr)
        sys.exit(1)
    export(agent)
