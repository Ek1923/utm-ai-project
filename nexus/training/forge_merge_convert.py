"""
FORGE Merge + Camelllo Deploy
Voegt LoRA adapters samen met het base model en zet het GGUF direct in Camelllo.

Camelllo:  C:/Users/eub11/Desktop/Camelllo
Models:    C:/Users/eub11/Desktop/Camelllo/models/<naam>.gguf
Converter: C:/Users/eub11/Desktop/Camelllo/build/_deps/llama-src/convert_hf_to_gguf.py

Gebruik:
  python forge_merge_convert.py              # nieuwste run automatisch
  python forge_merge_convert.py --run forge-v20240618-1430
  python forge_merge_convert.py --list       # toon beschikbare runs
"""

import os
import sys
import shutil
import argparse
import subprocess
from pathlib import Path

try:
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from peft import PeftModel
except ImportError as e:
    print(f'[fout] Ontbrekend package: {e}')
    print('Voer uit: pip install -r nexus/training/requirements.txt')
    sys.exit(1)

# ─── Paden — Camelllo leeft buiten dit project, dus dit is per machine
# instelbaar via de CAMELLLO_DIR env var. Zonder override valt dit terug op
# de locatie van de originele ontwikkelmachine.

CAMELLLO_DIR     = Path(os.environ.get('CAMELLLO_DIR', 'C:/Users/eub11/Desktop/Camelllo'))
CAMELLLO_MODELS  = CAMELLLO_DIR / 'models'
LLAMA_SRC        = CAMELLLO_DIR / 'build' / '_deps' / 'llama-src'
CONVERT_SCRIPT   = LLAMA_SRC / 'convert_hf_to_gguf.py'

CHECKPOINTS_DIR  = Path(__file__).parent / 'checkpoints'
MERGED_DIR       = Path(__file__).parent / 'merged'

BASE_MODEL       = 'deepseek-ai/deepseek-coder-6.7b-instruct'

# Q8_0 = beste kwaliteit die de convert script direct kan produceren
# (geen aparte quantize binary nodig)
QUANT_TYPE       = 'q8_0'


def check_camelllo():
    """Controleer of Camelllo en alle benodigde onderdelen aanwezig zijn."""
    ok = True
    checks = [
        (CAMELLLO_DIR,    'Camelllo directory'),
        (CAMELLLO_MODELS, 'Camelllo models map'),
        (CONVERT_SCRIPT,  'convert_hf_to_gguf.py in Camelllo'),
    ]
    for path, label in checks:
        if path.exists():
            print(f'  ✓ {label}: {path}')
        else:
            print(f'  ✗ {label} NIET GEVONDEN: {path}')
            ok = False
    return ok


def list_runs():
    if not CHECKPOINTS_DIR.exists():
        print('[leeg] Geen training runs gevonden. Voer forge_train.py eerst uit.')
        return
    runs = sorted(CHECKPOINTS_DIR.iterdir(), reverse=True)
    print(f'Beschikbare training runs ({len(runs)}):')
    for r in runs:
        adapters = r / 'lora_adapters'
        model_in_camelllo = CAMELLLO_MODELS / f'{r.name}.gguf'
        if model_in_camelllo.exists():
            status = '✓ In Camelllo'
        elif (MERGED_DIR / r.name).exists():
            status = '~ Gemerged, nog niet geconverteerd'
        elif adapters.exists():
            status = '· Adapters klaar'
        else:
            status = '⚠ Leeg'
        print(f'  {r.name:<40} {status}')

    # Toon ook wat al in Camelllo staat
    print(f'\nModellen in Camelllo ({CAMELLLO_MODELS}):')
    for gguf in sorted(CAMELLLO_MODELS.glob('*.gguf')):
        size_gb = gguf.stat().st_size / 1024**3
        print(f'  {gguf.name:<30} {size_gb:.2f} GB')


def merge_lora(adapter_path: Path, run_name: str) -> Path:
    """Laad base model + LoRA adapters en schrijf merged weights naar disk."""
    merged_path = MERGED_DIR / run_name

    if merged_path.exists():
        print(f'[skip] Merged model al aanwezig: {merged_path}')
        return merged_path

    MERGED_DIR.mkdir(parents=True, exist_ok=True)

    print(f'\n[1/3] Base model laden: {BASE_MODEL}')
    print('      (bij eerste keer: download ~13GB, daarna gecached)')

    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)

    # Laad op CPU — merge hoeft niet op GPU
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype       = torch.float16,
        device_map        = 'cpu',
        trust_remote_code = True,
        low_cpu_mem_usage = True,
    )

    print(f'[2/3] LoRA adapters koppelen: {adapter_path.name}')
    model = PeftModel.from_pretrained(model, str(adapter_path))

    print('[3/3] Adapters samenvoegen met base weights (merge_and_unload)...')
    model = model.merge_and_unload()

    print(f'      Opslaan → {merged_path}')
    model.save_pretrained(str(merged_path), safe_serialization=True)
    tokenizer.save_pretrained(str(merged_path))
    del model  # geheugen vrijmaken

    size_gb = sum(f.stat().st_size for f in merged_path.rglob('*') if f.is_file()) / 1024**3
    print(f'[✓] Merged model opgeslagen ({size_gb:.1f} GB) → {merged_path}')
    return merged_path


def convert_to_camelllo(merged_path: Path, model_name: str) -> Path:
    """
    Converteer HuggingFace model → GGUF en zet het direct in Camelllo/models/.
    Gebruikt de convert_hf_to_gguf.py die al in Camelllo zit.
    """
    dest_gguf = CAMELLLO_MODELS / f'{model_name}.gguf'

    if dest_gguf.exists():
        size_gb = dest_gguf.stat().st_size / 1024**3
        print(f'[skip] Model al in Camelllo: {dest_gguf.name} ({size_gb:.2f} GB)')
        return dest_gguf

    print(f'\n[convert] {merged_path.name} → {dest_gguf.name}')
    print(f'          Script: {CONVERT_SCRIPT}')
    print(f'          Type:   {QUANT_TYPE.upper()} (beste kwaliteit zonder aparte build)')

    result = subprocess.run([
        sys.executable,
        str(CONVERT_SCRIPT),
        str(merged_path),
        '--outfile', str(dest_gguf),
        '--outtype', QUANT_TYPE,
    ], capture_output=False, text=True)   # capture_output=False zodat je progress ziet

    if result.returncode != 0:
        print(f'[fout] Conversie mislukt (exit code {result.returncode})')
        sys.exit(1)

    size_gb = dest_gguf.stat().st_size / 1024**3
    print(f'[✓] GGUF → Camelllo/models/{dest_gguf.name} ({size_gb:.2f} GB)')
    return dest_gguf


def run(adapter_path: Path, run_name: str, model_name: str):
    print('══════════════════════════════════════════════')
    print('  FORGE → Camelllo Deploy')
    print(f'  Run:        {run_name}')
    print(f'  Model naam: {model_name}')
    print(f'  Camelllo:   {CAMELLLO_DIR}')
    print('══════════════════════════════════════════════')

    # Check Camelllo bereikbaar
    print('\n[check] Camelllo structuur:')
    if not check_camelllo():
        print('\n[fout] Camelllo ontbreekt of heeft een andere structuur.')
        sys.exit(1)

    # Merge LoRA
    merged = merge_lora(adapter_path, run_name)

    # Convert + deploy
    gguf = convert_to_camelllo(merged, model_name)

    print(f'\n══ Klaar ══')
    print(f'  Model:   {gguf}')
    print(f'  Grootte: {gguf.stat().st_size / 1024**3:.2f} GB')
    print()
    print('Camelllo laadt het model automatisch bij de volgende aanvraag.')
    print(f'NEXUS agent FORGE gebruikt nu model: "{model_name}"')
    print()
    print(f'In NEXUS backend — zorg dat FORGE agent dit model gebruikt:')
    print(f'  model: "{model_name}"  (in agentConfig of .env)')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FORGE LoRA Merge + Camelllo Deploy')
    group  = parser.add_mutually_exclusive_group()
    group.add_argument('--run',      help='Naam van training run (bijv. forge-v20240618-1430)')
    group.add_argument('--adapters', help='Direct pad naar LoRA adapters map')
    group.add_argument('--list',     action='store_true', help='Toon beschikbare runs en Camelllo modellen')
    parser.add_argument('--name',    default='forge', help='Model naam in Camelllo (default: forge)')
    args = parser.parse_args()

    if args.list:
        list_runs()
        sys.exit(0)

    if args.run:
        adapter_path = CHECKPOINTS_DIR / args.run / 'lora_adapters'
        run_name     = args.run
    elif args.adapters:
        adapter_path = Path(args.adapters)
        run_name     = adapter_path.parent.name
    else:
        # Automatisch nieuwste run
        runs = sorted(CHECKPOINTS_DIR.iterdir()) if CHECKPOINTS_DIR.exists() else []
        if not runs:
            print('[fout] Geen training runs. Voer forge_train.py eerst uit.')
            sys.exit(1)
        latest       = runs[-1]
        adapter_path = latest / 'lora_adapters'
        run_name     = latest.name
        print(f'[auto] Nieuwste run: {run_name}')

    if not adapter_path.exists():
        print(f'[fout] Adapters niet gevonden: {adapter_path}')
        print('Voer forge_train.py eerst uit.')
        sys.exit(1)

    run(adapter_path, run_name, model_name=args.name)
