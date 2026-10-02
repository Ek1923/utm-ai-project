import os
import sys
import json
import time
import torch
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    TrainerCallback,
    TrainerState,
    TrainerControl,
    TrainingArguments,
)
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from trl import SFTTrainer, SFTConfig
from data_prep import build_dataset
from config import (
    BASE_MODEL, output_dir, MAX_SEQ_LENGTH,
    LORA_R, LORA_ALPHA, LORA_DROPOUT, TARGET_MODULES,
    EPOCHS, BATCH_SIZE, GRAD_ACCUM_STEPS,
    LEARNING_RATE, LR_SCHEDULER, WARMUP_RATIO,
    LOGGING_STEPS, SEED, LORA_AGENTS,
)


def log(msg: str):
    """Plain log line — server picks this up as training_log."""
    print(msg, flush=True)


def metrics(data: dict):
    """
    Structured metrics line — server parses [METRICS] prefix and emits
    training_metrics SSE event so the UI can update progress bar and loss.
    """
    print(f"[METRICS] {json.dumps(data)}", flush=True)


class LiveMetricsCallback(TrainerCallback):
    """
    Fires on every logging step. Emits a [METRICS] line with:
      step, max_steps, loss, learning_rate, epoch, elapsed_seconds

    The server parses these and pushes them to the ForgeLab UI in real time.
    This is how PyTorch training synchronises with the browser.
    """
    def __init__(self):
        self._start = time.time()

    def on_log(self, args, state: TrainerState, control: TrainerControl, logs=None, **kwargs):
        if not logs:
            return
        metrics({
            'step':     state.global_step,
            'max_steps': state.max_steps,
            'loss':      round(logs.get('loss', 0), 4),
            'lr':        round(logs.get('learning_rate', 0), 6),
            'epoch':     round(state.epoch or 0, 2),
            'elapsed':   round(time.time() - self._start),
        })

    def on_epoch_end(self, args, state: TrainerState, control: TrainerControl, **kwargs):
        epoch = int(state.epoch or 0)
        log(f"[train] Epoch {epoch}/{args.num_train_epochs} complete.")


def train(agent: str):
    if agent not in LORA_AGENTS:
        raise ValueError(f"Unknown LoRA agent: {agent}. Valid: {LORA_AGENTS}")

    out_dir = output_dir(agent)
    os.makedirs(out_dir, exist_ok=True)

    log(f"[train] Loading dataset for '{agent}'...")
    dataset = build_dataset(agent)
    log(f"[train] {len(dataset)} training examples ready.")

    log("[train] Configuring 4-bit quantization (NF4)...")
    bnb_cfg = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type='nf4',           # NF4 = best quality 4-bit format
        bnb_4bit_compute_dtype=torch.bfloat16,  # compute in bfloat16, store in 4-bit
        bnb_4bit_use_double_quant=True,       # quantize the quantization constants too
    )

    log(f"[train] Loading {BASE_MODEL} in 4-bit...")
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        quantization_config=bnb_cfg,
        device_map='auto',
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
    )
    # Prepares the quantized model for training (adds gradient checkpointing etc.)
    model = prepare_model_for_kbit_training(model)

    log("[train] Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    tokenizer.padding_side = 'right'  # required for SFT packing

    log(f"[train] Injecting LoRA adapters (r={LORA_R}, α={LORA_ALPHA})...")
    lora_cfg = LoraConfig(
        r=LORA_R,                     # rank: lower = fewer params, less capacity
        lora_alpha=LORA_ALPHA,         # scaling factor (usually 2×r)
        lora_dropout=LORA_DROPOUT,     # regularisation
        target_modules=TARGET_MODULES, # which attention layers get adapters
        bias='none',
        task_type='CAUSAL_LM',
    )
    model = get_peft_model(model, lora_cfg)

    trainable, total = model.get_nb_trainable_parameters()
    log(f"[train] Trainable: {trainable:,} / {total:,} params ({100*trainable/total:.2f}%)")

    sft_args = SFTConfig(
        output_dir=out_dir,
        num_train_epochs=EPOCHS,
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM_STEPS,
        learning_rate=LEARNING_RATE,
        lr_scheduler_type=LR_SCHEDULER,
        warmup_ratio=WARMUP_RATIO,
        logging_steps=LOGGING_STEPS,
        save_strategy='epoch',
        save_total_limit=1,
        bf16=True,
        tf32=True,
        optim='paged_adamw_8bit',   # memory-efficient AdamW for 4-bit models
        seed=SEED,
        report_to='none',           # disable wandb/tensorboard
        max_seq_length=MAX_SEQ_LENGTH,
        dataset_text_field='text',
        packing=False,
    )

    trainer = SFTTrainer(
        model=model,
        train_dataset=dataset,
        args=sft_args,
        tokenizer=tokenizer,
        callbacks=[LiveMetricsCallback()],
    )

    log(f"[train] Starting training — {EPOCHS} epochs, {len(dataset)} examples...")
    trainer.train()

    log(f"[train] Saving LoRA adapter to {out_dir}")
    trainer.save_model(out_dir)
    tokenizer.save_pretrained(out_dir)
    log("[train] Training complete.")


if __name__ == '__main__':
    agent = sys.argv[1] if len(sys.argv) > 1 else 'jarvis'
    train(agent)
