"""
Entry point for the NEXUS QLoRA fine-tuning pipeline.

Usage:
    python pipeline.py --agent forge
    python pipeline.py --agent jarvis --skip-export
    python pipeline.py --agent atlas  --skip-train

Stdout format:
    Normal lines   → picked up by server as training_log
    [METRICS] {...} → parsed by server, emitted as training_metrics SSE event
"""

import sys
import argparse
import time
import traceback
from config import LORA_AGENTS


def sse_log(event: str, data: str):
    ts = time.strftime('%H:%M:%S')
    print(f"[{ts}] [{event.upper()}] {data}", flush=True)


def run_stage(name: str, fn):
    sse_log('stage', f'Starting {name}...')
    t0 = time.time()
    try:
        fn()
        sse_log('stage', f'{name} complete ({time.time() - t0:.1f}s)')
    except Exception as e:
        sse_log('error', f'{name} FAILED: {e}')
        traceback.print_exc()
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='NEXUS QLoRA training pipeline')
    parser.add_argument('--agent',       required=True, choices=LORA_AGENTS,
                        help=f'Agent to train. One of: {LORA_AGENTS}')
    parser.add_argument('--skip-train',  action='store_true', help='Skip training, only export')
    parser.add_argument('--skip-export', action='store_true', help='Skip export, only train')
    args = parser.parse_args()

    sse_log('pipeline', f"NEXUS QLoRA pipeline started for agent '{args.agent}'")

    if not args.skip_train:
        from train import train
        run_stage('TRAIN', lambda: train(args.agent))
    else:
        sse_log('pipeline', 'Training skipped (--skip-train)')

    if not args.skip_export:
        from export import export
        run_stage('EXPORT', lambda: export(args.agent))
    else:
        sse_log('pipeline', 'Export skipped (--skip-export)')

    sse_log('pipeline', f"All stages complete. '{args.agent}' model is ready in Ollama.")


if __name__ == '__main__':
    main()