import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'path';
import os from 'os';
import { queryAgent } from './ollama.js';

const DESKTOP = path.join(os.homedir(), 'Desktop');

type StreamFn = (data: object) => void;

function log(onStream: StreamFn, agent: string, msg: string) {
  onStream({ type: 'project_log', data: { agent, message: msg } });
}

function fileWritten(onStream: StreamFn, filePath: string) {
  onStream({ type: 'project_file', data: { file: path.basename(filePath) } });
}

async function ask(agentId: string, prompt: string): Promise<string> {
  try {
    return await queryAgent(agentId, prompt, 0.4);
  } catch {
    return '[Agent unavailable — using default]';
  }
}

// ─── PyTorch file templates ──────────────────────────────────────────────────

function genModelPy(projectName: string, architecture: string): string {
  const className = projectName.replace(/[^a-zA-Z0-9]/g, '') + 'Net';
  return `"""
${className} — Built by FORGE for Project NEXUS
Commander: Baykal
Architecture advice by TACTIX & SPARK
Theory by ATLAS

Architecture notes:
${architecture.slice(0, 600)}
"""

import torch
import torch.nn as nn
import torch.nn.functional as F
from config import CONFIG


class ${className}(nn.Module):
    """Custom neural network built from scratch."""

    def __init__(self):
        super(${className}, self).__init__()
        input_size   = CONFIG["input_size"]
        hidden_sizes = CONFIG["hidden_sizes"]
        output_size  = CONFIG["output_size"]
        dropout      = CONFIG["dropout"]

        # Build layer stack dynamically from config
        layers = []
        prev = input_size
        for i, hidden in enumerate(hidden_sizes):
            layers.append(nn.Linear(prev, hidden))
            layers.append(nn.BatchNorm1d(hidden))
            layers.append(nn.GELU())          # GELU: smoother than ReLU
            if i < len(hidden_sizes) - 1:
                layers.append(nn.Dropout(dropout))
            prev = hidden

        layers.append(nn.Linear(prev, output_size))
        self.network = nn.Sequential(*layers)

        # Residual projection (skip connection from input → output)
        self.residual = (
            nn.Linear(input_size, output_size)
            if input_size != output_size else nn.Identity()
        )

        self._init_weights()

    def _init_weights(self):
        for m in self.modules():
            if isinstance(m, nn.Linear):
                nn.init.kaiming_normal_(m.weight, nonlinearity='relu')
                if m.bias is not None:
                    nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Main path + residual skip connection
        return self.network(x) + self.residual(x)


def build_model() -> ${className}:
    model = ${className}()
    total = sum(p.numel() for p in model.parameters())
    print(f"[NEXUS] ${className} built — {total:,} parameters")
    return model


if __name__ == "__main__":
    model = build_model()
    dummy = torch.randn(4, CONFIG["input_size"])
    out = model(dummy)
    print(f"[NEXUS] Forward pass OK — output shape: {out.shape}")
`;
}

function genConfigPy(projectName: string): string {
  return `"""
Project: ${projectName}
Config — edit these to control your model
"""

CONFIG = {
    # ── Architecture ──────────────────────────────────────
    "input_size":   784,          # e.g. 784 for MNIST (28x28), 3072 for CIFAR-10
    "hidden_sizes": [512, 256, 128],  # layers — add more for deeper network
    "output_size":  10,           # number of classes
    "dropout":      0.3,          # 0.0 = no dropout, 0.5 = aggressive

    # ── Training ──────────────────────────────────────────
    "learning_rate": 0.001,
    "batch_size":    64,
    "epochs":        20,
    "weight_decay":  1e-4,        # L2 regularization

    # ── Paths ─────────────────────────────────────────────
    "checkpoint_dir": "checkpoints",
    "log_dir":        "logs",
}
`;
}

function genTrainPy(projectName: string): string {
  const className = projectName.replace(/[^a-zA-Z0-9]/g, '') + 'Net';
  return `"""
Training script — ${projectName}
Run: python train.py
"""

import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset, random_split
import os
from model import build_model
from config import CONFIG


def train():
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[NEXUS] Device: {device}")

    # ── Load your data here ───────────────────────────────────────────────────
    # Replace with your real dataset. Example uses random tensors:
    N = 1000
    X = torch.randn(N, CONFIG["input_size"])
    y = torch.randint(0, CONFIG["output_size"], (N,))
    dataset = TensorDataset(X, y)

    train_size = int(0.8 * len(dataset))
    val_size   = len(dataset) - train_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    train_loader = DataLoader(train_ds, batch_size=CONFIG["batch_size"], shuffle=True)
    val_loader   = DataLoader(val_ds,   batch_size=CONFIG["batch_size"])
    # ─────────────────────────────────────────────────────────────────────────

    model     = build_model().to(device)
    optimizer = optim.AdamW(
        model.parameters(),
        lr=CONFIG["learning_rate"],
        weight_decay=CONFIG["weight_decay"]
    )
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=CONFIG["epochs"])
    criterion = nn.CrossEntropyLoss()

    os.makedirs(CONFIG["checkpoint_dir"], exist_ok=True)
    best_val_loss = float("inf")

    for epoch in range(1, CONFIG["epochs"] + 1):
        # ── Train ────────────────────────────────────────────────────────────
        model.train()
        total_loss, correct, total = 0.0, 0, 0
        for X_batch, y_batch in train_loader:
            X_batch, y_batch = X_batch.to(device), y_batch.to(device)
            optimizer.zero_grad()
            outputs = model(X_batch)
            loss = criterion(outputs, y_batch)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total_loss += loss.item() * X_batch.size(0)
            correct    += (outputs.argmax(1) == y_batch).sum().item()
            total      += X_batch.size(0)

        train_acc  = correct / total
        train_loss = total_loss / total

        # ── Validate ─────────────────────────────────────────────────────────
        model.eval()
        val_loss, val_correct, val_total = 0.0, 0, 0
        with torch.no_grad():
            for X_batch, y_batch in val_loader:
                X_batch, y_batch = X_batch.to(device), y_batch.to(device)
                outputs = model(X_batch)
                loss = criterion(outputs, y_batch)
                val_loss    += loss.item() * X_batch.size(0)
                val_correct += (outputs.argmax(1) == y_batch).sum().item()
                val_total   += X_batch.size(0)

        val_acc  = val_correct / val_total
        val_loss = val_loss / val_total

        scheduler.step()

        print(f"Epoch {epoch:3d}/{CONFIG['epochs']} | "
              f"Train loss: {train_loss:.4f} acc: {train_acc:.3f} | "
              f"Val loss: {val_loss:.4f} acc: {val_acc:.3f}")

        # ── Save best ────────────────────────────────────────────────────────
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            ckpt = os.path.join(CONFIG["checkpoint_dir"], "best_model.pt")
            torch.save(model.state_dict(), ckpt)
            print(f"  [NEXUS] Checkpoint saved: {ckpt}")

    print("[NEXUS] Training complete.")


if __name__ == "__main__":
    train()
`;
}

function genEvaluatePy(projectName: string): string {
  return `"""
Evaluation — ${projectName}
Run: python evaluate.py
"""

import torch
from model import build_model
from config import CONFIG


def evaluate(checkpoint_path="checkpoints/best_model.pt"):
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = build_model().to(device)
    model.load_state_dict(torch.load(checkpoint_path, map_location=device))
    model.eval()
    print(f"[NEXUS] Model loaded from {checkpoint_path}")

    # Replace with your real test data
    X_test = torch.randn(100, CONFIG["input_size"])
    y_test = torch.randint(0, CONFIG["output_size"], (100,))

    with torch.no_grad():
        outputs = model(X_test.to(device))
        preds = outputs.argmax(1).cpu()
        acc = (preds == y_test).float().mean().item()

    print(f"[NEXUS] Test accuracy: {acc:.3%}")
    return acc


if __name__ == "__main__":
    evaluate()
`;
}

function genRequirements(): string {
  return `torch>=2.0.0
torchvision>=0.15.0
numpy>=1.24.0
matplotlib>=3.7.0
tqdm>=4.65.0
`;
}

function genBuildReport(
  projectName: string,
  tactixPlan: string,
  sparkIdeas: string,
  atlasExplain: string,
  forgeNotes: string
): string {
  const now = new Date().toLocaleString('nl-NL');
  return `# ${projectName} — Build Report

**Built by:** Project NEXUS Multi-Agent System
**Commander:** Baykal
**Date:** ${now}

---

## TACTIX — Architecture Plan

${tactixPlan}

---

## SPARK — Innovation Ideas

${sparkIdeas}

---

## ATLAS — Theory & Explanation

${atlasExplain}

---

## FORGE — Build Notes

${forgeNotes}

---

## Files Created

| File | Purpose |
|---|---|
| \`model.py\` | The neural network class (nn.Module) |
| \`train.py\` | Full training loop with validation |
| \`config.py\` | All hyperparameters — edit this first |
| \`evaluate.py\` | Load checkpoint and test accuracy |
| \`requirements.txt\` | Python dependencies |

## How to Run

\`\`\`bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Edit config.py for your data (input_size, output_size, etc.)

# 3. Add your dataset to train.py (replace the random tensor section)

# 4. Train
python train.py

# 5. Evaluate
python evaluate.py
\`\`\`

## Architecture at a Glance

\`\`\`
Input → Linear → BatchNorm → GELU → Dropout
      → Linear → BatchNorm → GELU → Dropout
      → ...
      → Linear (output)
      + Residual skip connection (input → output)
\`\`\`

*This model was built from scratch by your NEXUS agents. It belongs to you.*
`;
}

// ─── Main builder ────────────────────────────────────────────────────────────

export async function buildProject(projectName: string, onStream: StreamFn) {
  const safe = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
  const projectDir = path.join(DESKTOP, safe);

  log(onStream, 'nexus', `Building project: "${safe}"`);
  log(onStream, 'nexus', `Target: ${projectDir}`);

  // Create directory
  if (!existsSync(projectDir)) {
    mkdirSync(projectDir, { recursive: true });
    log(onStream, 'forge', `Directory created: ${projectDir}`);
  } else {
    log(onStream, 'forge', `Directory already exists — updating files.`);
  }

  // ── Step 1: TACTIX plans the architecture ──────────────────────────────────
  log(onStream, 'tactix', 'Designing neural network architecture...');
  const tactixPrompt = `You are TACTIX, master planner of NEXUS.
Design a neural network architecture for a project called "${safe}".
Specify concisely:
- Input size and what it represents
- Number of hidden layers and sizes
- Output size and what it represents
- Key design choices (activation, regularization, skip connections)
- What kind of data/task this network is best suited for
Keep response under 200 words. Be specific with numbers.`;

  const tactixPlan = await ask('tactix', tactixPrompt);
  log(onStream, 'tactix', tactixPlan.slice(0, 300) + (tactixPlan.length > 300 ? '...' : ''));

  // ── Step 2: SPARK adds innovations ────────────────────────────────────────
  log(onStream, 'spark', 'Generating innovative features...');
  const sparkPrompt = `You are SPARK, ideation engine of NEXUS.
Suggest 3 specific innovations to make the "${safe}" neural network unique.
Focus on things that actually work in PyTorch:
- Residual connections
- Attention mechanisms
- Custom loss functions
- Data augmentation tricks
- Learning rate scheduling
Be concise — one sentence per idea.`;

  const sparkIdeas = await ask('spark', sparkPrompt);
  log(onStream, 'spark', sparkIdeas.slice(0, 200) + (sparkIdeas.length > 200 ? '...' : ''));

  // ── Step 3: ATLAS explains the theory ─────────────────────────────────────
  log(onStream, 'atlas', 'Documenting theory...');
  const atlasPrompt = `You are ATLAS, knowledge repository of NEXUS.
In 3 short paragraphs, explain:
1. What neural networks are and how they learn
2. What makes the "${safe}" architecture appropriate
3. What the user needs to understand to train it successfully
Write for a 15-year-old who is learning. Keep it clear.`;

  const atlasExplain = await ask('atlas', atlasPrompt);
  log(onStream, 'atlas', 'Theory documented.');

  // ── Step 4: FORGE writes all files ────────────────────────────────────────
  log(onStream, 'forge', 'Writing PyTorch source files...');

  const architecture = `TACTIX plan:\n${tactixPlan}\n\nSPARK innovations:\n${sparkIdeas}`;
  const forgeNotes = `FORGE built this model based on TACTIX's architecture plan and SPARK's innovation suggestions. The model uses GELU activation (smoother gradient flow), BatchNorm (stable training), residual skip connections (faster convergence), AdamW optimizer with cosine annealing schedule, and gradient clipping to prevent exploding gradients.`;

  // Write all 5 project files
  const files: [string, string][] = [
    ['config.py',        genConfigPy(safe)],
    ['model.py',         genModelPy(safe, architecture)],
    ['train.py',         genTrainPy(safe)],
    ['evaluate.py',      genEvaluatePy(safe)],
    ['requirements.txt', genRequirements()],
    ['BUILD_REPORT.md',  genBuildReport(safe, tactixPlan, sparkIdeas, atlasExplain, forgeNotes)],
  ];

  for (const [filename, content] of files) {
    const fullPath = path.join(projectDir, filename);
    writeFileSync(fullPath, content, 'utf-8');
    fileWritten(onStream, fullPath);
    log(onStream, 'forge', `Written: ${filename}`);
    await new Promise(r => setTimeout(r, 200));
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  log(onStream, 'nexus', `Project "${safe}" complete.`);
  log(onStream, 'nexus', `Location: ${projectDir}`);
  log(onStream, 'nexus', 'Next step: edit config.py, add your data to train.py, then run: python train.py');

  onStream({ type: 'project_done', data: { projectName: safe, projectDir } });
}
