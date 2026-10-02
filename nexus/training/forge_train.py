"""
FORGE Training Script — DeepSeek Coder QLoRA
Hardware target: RTX 4060 Ti 16GB VRAM
Base model: deepseek-ai/deepseek-coder-6.7b-instruct
Methode: QLoRA (4-bit base + LoRA adapters)

Gebruik:
  python forge_train.py                    # train met standaard settings
  python forge_train.py --epochs 5         # meer epochs
  python forge_train.py --data custom.jsonl
"""

import os
import sys
import json
import argparse
from pathlib import Path
from datetime import datetime

# ─── Zorg dat packages beschikbaar zijn ───────────────────────────────────────
try:
    import torch
    from datasets import Dataset
    from transformers import (
        AutoTokenizer, AutoModelForCausalLM,
        TrainingArguments, BitsAndBytesConfig,
        TrainerCallback,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training, TaskType
    from trl import SFTTrainer
except ImportError as e:
    print(f'[fout] Ontbrekend package: {e}')
    print('Voer eerst uit: pip install -r nexus/training/requirements.txt')
    sys.exit(1)

# ─── Config ───────────────────────────────────────────────────────────────────

BASE_MODEL   = 'deepseek-ai/deepseek-coder-6.7b-instruct'
DATA_FILE    = Path(__file__).parent / 'data' / 'forge_samples.jsonl'
OUTPUT_BASE  = Path(__file__).parent / 'checkpoints'
LOG_FILE     = Path(__file__).parent / 'forge_train.log'

# Ideale LoRA settings voor DeepSeek Coder 6.7B op 16GB VRAM
LORA_CONFIG = dict(
    r              = 64,          # rank — hogere rank = meer capaciteit
    lora_alpha     = 128,         # schaling (typisch 2x rank)
    lora_dropout   = 0.05,
    bias           = 'none',
    task_type      = TaskType.CAUSAL_LM,
    target_modules = [            # alle aandachts + feed-forward lagen
        'q_proj', 'k_proj', 'v_proj', 'o_proj',
        'gate_proj', 'up_proj', 'down_proj',
    ],
)

TRAIN_CONFIG = dict(
    num_train_epochs            = 3,
    per_device_train_batch_size = 1,
    gradient_accumulation_steps = 8,    # effectieve batch: 8
    learning_rate               = 2e-4,
    max_seq_length              = 1024,
    warmup_ratio                = 0.05,
    lr_scheduler_type           = 'cosine',
    optim                       = 'paged_adamw_8bit',
    fp16                        = False,
    bf16                        = True,   # RTX 4060 Ti ondersteunt bf16
    logging_steps               = 10,
    save_steps                  = 200,
    save_total_limit            = 3,
    dataloader_num_workers      = 2,
    report_to                   = 'none',
)

# ─── Prompt template ──────────────────────────────────────────────────────────

def format_prompt(sample: dict) -> str:
    instruction = sample.get('instruction', '')
    inp         = sample.get('input', '')
    output      = sample.get('output', '')

    if inp:
        return (
            f'### Instructie:\n{instruction}\n\n'
            f'### Context:\n{inp}\n\n'
            f'### Code:\n{output}\n'
        )
    return (
        f'### Instructie:\n{instruction}\n\n'
        f'### Code:\n{output}\n'
    )

# ─── Logging callback ─────────────────────────────────────────────────────────

class ForgeProgressCallback(TrainerCallback):
    def __init__(self, total_steps: int):
        self.total   = total_steps
        self.log_fh  = open(LOG_FILE, 'a')
        self._write(f'[{datetime.now().isoformat()}] Training gestart — {total_steps} stappen')

    def _write(self, msg: str):
        print(msg)
        self.log_fh.write(msg + '\n')
        self.log_fh.flush()

    def on_log(self, args, state, control, logs=None, **kwargs):
        if logs and 'loss' in logs:
            step = state.global_step
            pct  = (step / self.total * 100) if self.total else 0
            msg  = (
                f'  stap {step:>5}/{self.total} ({pct:5.1f}%)'
                f'  loss={logs["loss"]:.4f}'
                f'  lr={logs.get("learning_rate", 0):.2e}'
            )
            self._write(msg)

    def on_train_end(self, args, state, control, **kwargs):
        self._write(f'[{datetime.now().isoformat()}] Training klaar')
        self.log_fh.close()

# ─── Data loader ──────────────────────────────────────────────────────────────

def load_dataset(data_file: Path, max_samples: int | None = None) -> Dataset:
    samples = []
    with open(data_file, 'r', encoding='utf-8') as f:
        for i, line in enumerate(f):
            if max_samples and i >= max_samples:
                break
            try:
                obj = json.loads(line.strip())
                samples.append({'text': format_prompt(obj)})
            except json.JSONDecodeError:
                continue

    print(f'[data] {len(samples)} samples geladen uit {data_file.name}')
    return Dataset.from_list(samples)

# ─── Quantization config ──────────────────────────────────────────────────────

def get_bnb_config() -> BitsAndBytesConfig:
    return BitsAndBytesConfig(
        load_in_4bit               = True,
        bnb_4bit_quant_type        = 'nf4',       # NormalFloat4 — beste kwaliteit
        bnb_4bit_compute_dtype     = torch.bfloat16,
        bnb_4bit_use_double_quant  = True,         # dubbele kwantisering bespaart ~0.4 bits extra
    )

# ─── Main train ───────────────────────────────────────────────────────────────

def train(args: argparse.Namespace):
    run_name   = f'forge-v{datetime.now().strftime("%Y%m%d-%H%M")}'
    output_dir = OUTPUT_BASE / run_name
    output_dir.mkdir(parents=True, exist_ok=True)

    print('══════════════════════════════════════════')
    print('  FORGE Training — DeepSeek Coder 6.7B')
    print(f'  Run: {run_name}')
    print(f'  Output: {output_dir}')
    print('══════════════════════════════════════════')

    # GPU check
    if not torch.cuda.is_available():
        print('[waarschuwing] Geen CUDA GPU gevonden — training zal erg traag zijn op CPU')
    else:
        gpu = torch.cuda.get_device_properties(0)
        vram_gb = gpu.total_memory / 1024**3
        print(f'[GPU] {gpu.name} — {vram_gb:.1f}GB VRAM')

    # 1. Tokenizer
    print(f'\n[1/5] Tokenizer laden: {BASE_MODEL}')
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = 'right'

    # 2. Model (4-bit quantized)
    print(f'[2/5] Model laden in 4-bit (QLoRA)...')
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config = get_bnb_config(),
        device_map          = 'auto',
        trust_remote_code   = True,
        torch_dtype         = torch.bfloat16,
    )
    model = prepare_model_for_kbit_training(model)

    # 3. LoRA
    print('[3/5] LoRA adapters koppelen...')
    lora_cfg = LoraConfig(**LORA_CONFIG)
    model    = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # 4. Dataset
    print(f'[4/5] Data laden: {args.data}')
    dataset = load_dataset(Path(args.data), max_samples=args.max_samples)

    # Bereken stappen voor progress callback
    eff_batch = TRAIN_CONFIG['per_device_train_batch_size'] * TRAIN_CONFIG['gradient_accumulation_steps']
    steps_per_epoch = max(1, len(dataset) // eff_batch)
    total_steps     = steps_per_epoch * args.epochs

    # 5. Trainer
    print('[5/5] Trainer configureren...')
    train_args = TrainingArguments(
        output_dir = str(output_dir),
        **{**TRAIN_CONFIG, 'num_train_epochs': args.epochs},
    )

    trainer = SFTTrainer(
        model         = model,
        tokenizer     = tokenizer,
        train_dataset = dataset,
        dataset_text_field = 'text',
        max_seq_length     = TRAIN_CONFIG['max_seq_length'],
        args               = train_args,
        callbacks          = [ForgeProgressCallback(total_steps)],
    )

    print(f'\n[start] {len(dataset)} samples × {args.epochs} epochs = ~{total_steps} stappen')
    print('  LoRA rank:    64  |  alpha: 128')
    print('  Batch:        2   |  grad accum: 8  (effectief: 16)')
    print('  LR:           2e-4  |  scheduler: cosine')
    print('  Quantization: 4-bit NF4 + double quant')
    print()

    trainer.train()

    # Sla adapters op
    adapter_path = output_dir / 'lora_adapters'
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f'\n[opgeslagen] LoRA adapters → {adapter_path}')
    print(f'Voer nu uit: python forge_merge_convert.py --run {run_name}')

    return str(adapter_path)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='FORGE QLoRA Training — DeepSeek Coder 6.7B')
    parser.add_argument('--data',        default=str(DATA_FILE),   help='JSONL training data bestand')
    parser.add_argument('--epochs',      type=int, default=3,      help='Aantal epochs (default 3)')
    parser.add_argument('--max-samples', type=int, default=None,   help='Max aantal samples (debug)')
    args = parser.parse_args()

    if not Path(args.data).exists():
        print(f'[fout] Data bestand niet gevonden: {args.data}')
        print('Voer eerst uit: python forge_scraper.py')
        sys.exit(1)

    train(args)
