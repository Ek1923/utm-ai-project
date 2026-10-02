import { spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getConfig } from './config.js';

const getProjectsDir = () => getConfig().projectsDir;

interface RunMetrics {
  finalLoss: number | null;
  bestAccuracy: number | null;
  epochsCompleted: number;
  exitCode: number;
}

interface TrainingRun {
  runId: number;
  timestamp: string;
  phase: 'train' | 'test';
  metrics: RunMetrics;
  config: Record<string, string | number>;
}

interface TrainingHistory {
  projectName: string;
  runs: TrainingRun[];
}

function safeName(name: string) {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  label: string,
  onStream: (data: object) => void
): Promise<{ exitCode: number; lines: string[] }> {
  return new Promise((resolve) => {
    onStream({ type: 'run_log', data: { text: `▸ ${label}`, level: 'cmd' } });
    const lines: string[] = [];

    const proc = spawn(cmd, args, { cwd, shell: true });

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) {
          lines.push(line);
          onStream({ type: 'run_log', data: { text: line, level: 'stdout' } });
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) {
          lines.push(line);
          onStream({ type: 'run_log', data: { text: line, level: 'stderr' } });
        }
      }
    });

    proc.on('close', (code) => {
      const ok = code === 0;
      onStream({ type: 'run_log', data: { text: ok ? `✓ Klaar (exit 0)` : `✗ Exit code ${code}`, level: ok ? 'success' : 'error' } });
      resolve({ exitCode: code ?? 1, lines });
    });

    proc.on('error', (err) => {
      onStream({ type: 'run_log', data: { text: `❌ Kan niet starten: ${err.message}`, level: 'error' } });
      resolve({ exitCode: 1, lines });
    });
  });
}

function parseMetrics(lines: string[]): Omit<RunMetrics, 'exitCode'> {
  let finalLoss: number | null = null;
  let bestAccuracy: number | null = null;
  let epochsCompleted = 0;

  for (const line of lines) {
    const epochMatch = line.match(/[Ee]poch[:\s]+(\d+)/);
    if (epochMatch) epochsCompleted = parseInt(epochMatch[1]);

    const lossMatch = line.match(/(?:loss|Loss)[:\s=]+([0-9]+\.[0-9]+)/);
    if (lossMatch) finalLoss = parseFloat(lossMatch[1]);

    const accMatch = line.match(/(?:acc|Acc|accuracy|Accuracy)[:\s=]+([0-9]+\.[0-9]+)/);
    if (accMatch) {
      const val = parseFloat(accMatch[1]);
      bestAccuracy = val > 1 ? val / 100 : val;
    }
  }

  return { finalLoss, bestAccuracy, epochsCompleted };
}

function readConfig(projectDir: string): Record<string, string | number> {
  const configPath = join(projectDir, 'config.py');
  if (!existsSync(configPath)) return {};

  const out: Record<string, string | number> = {};
  for (const line of readFileSync(configPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)\s*=\s*([^\s#]+)/);
    if (m) {
      const n = Number(m[2]);
      out[m[1]] = isNaN(n) ? m[2] : n;
    }
  }
  return out;
}

function updateConfig(
  projectDir: string,
  updates: Record<string, number>,
  onStream: (data: object) => void
) {
  const configPath = join(projectDir, 'config.py');
  if (!existsSync(configPath)) return;

  let content = readFileSync(configPath, 'utf-8');
  for (const [key, value] of Object.entries(updates)) {
    const formatted = value < 0.01 ? value.toExponential(2) : String(value);
    content = content.replace(new RegExp(`^(${key}\\s*=\\s*).*$`, 'm'), `$1${formatted}`);
    onStream({ type: 'run_log', data: { text: `  ↳ ${key} = ${formatted}`, level: 'improve' } });
  }
  writeFileSync(configPath, content, 'utf-8');
}

function computeImprovements(
  history: TrainingHistory,
  onStream: (data: object) => void
): Record<string, number> {
  const trainRuns = history.runs.filter(r => r.phase === 'train');
  if (trainRuns.length === 0) return {};

  const last = trainRuns[trainRuns.length - 1];
  const prev = trainRuns.length > 1 ? trainRuns[trainRuns.length - 2] : null;
  const updates: Record<string, number> = {};

  onStream({ type: 'run_log', data: { text: `\n🧠 FORGE analyseert ${trainRuns.length} eerdere run(s)...`, level: 'improve' } });

  const epochs = Number(last.config.NUM_EPOCHS ?? 10);
  const lr = Number(last.config.LEARNING_RATE ?? 3e-4);
  const hidden = Number(last.config.HIDDEN_DIM ?? 256);
  const batch = Number(last.config.BATCH_SIZE ?? 32);

  if (!prev) {
    // First run complete: give it more epochs next time
    updates.NUM_EPOCHS = epochs + 5;
    onStream({ type: 'run_log', data: { text: `  ↑ Run #1 klaar → meer epochs (${epochs} → ${epochs + 5})`, level: 'improve' } });
  } else {
    const lastLoss = last.metrics.finalLoss;
    const prevLoss = prev.metrics.finalLoss;

    if (lastLoss !== null && prevLoss !== null) {
      const pct = ((prevLoss - lastLoss) / prevLoss) * 100;

      if (pct > 1) {
        // Loss still falling nicely → more epochs
        updates.NUM_EPOCHS = epochs + 5;
        onStream({ type: 'run_log', data: { text: `  ↑ Loss daalt ${pct.toFixed(1)}% → epochs +5 (${epochs} → ${epochs + 5})`, level: 'improve' } });
      } else if (pct > 0) {
        // Tiny improvement → lower LR to squeeze more out
        const newLR = parseFloat((lr * 0.5).toExponential(2));
        updates.LEARNING_RATE = newLR;
        updates.NUM_EPOCHS = epochs + 3;
        onStream({ type: 'run_log', data: { text: `  ↓ Loss verbetert traag (${pct.toFixed(2)}%) → LR /2, epochs +3`, level: 'improve' } });
      } else {
        // No improvement → much lower LR, reset epochs
        const newLR = parseFloat((lr * 0.1).toExponential(2));
        updates.LEARNING_RATE = newLR;
        onStream({ type: 'run_log', data: { text: `  ↓ Loss stagneert → LR ×0.1 (${lr.toExponential(2)} → ${newLR.toExponential(2)})`, level: 'improve' } });
      }
    }

    // If accuracy is high, grow the model
    const acc = last.metrics.bestAccuracy;
    if (acc !== null && acc > 0.88 && hidden < 512) {
      updates.HIDDEN_DIM = hidden + 64;
      onStream({ type: 'run_log', data: { text: `  ↑ Accuracy ${(acc * 100).toFixed(1)}% → model groter (hidden_dim ${hidden} → ${hidden + 64})`, level: 'improve' } });
    }

    // If accuracy is low after 2+ runs, try smaller batch (more gradient updates)
    const acc2 = last.metrics.bestAccuracy;
    if (acc2 !== null && acc2 < 0.60 && trainRuns.length >= 2 && batch > 8) {
      updates.BATCH_SIZE = Math.max(8, batch / 2);
      onStream({ type: 'run_log', data: { text: `  ↓ Accuracy laag → kleinere batch (${batch} → ${updates.BATCH_SIZE})`, level: 'improve' } });
    }
  }

  return updates;
}

function loadHistory(projectDir: string, projectName: string): TrainingHistory {
  const histFile = join(projectDir, 'training_history.json');
  if (existsSync(histFile)) {
    try { return JSON.parse(readFileSync(histFile, 'utf-8')); } catch { /* ignore */ }
  }
  return { projectName, runs: [] };
}

function saveHistory(projectDir: string, history: TrainingHistory) {
  writeFileSync(join(projectDir, 'training_history.json'), JSON.stringify(history, null, 2), 'utf-8');
}

export async function runProject(
  name: string,
  phase: 'train' | 'test',
  onStream: (data: object) => void
) {
  const folder = safeName(name);
  const projectDir = join(getProjectsDir(), folder);

  if (!existsSync(projectDir)) {
    onStream({ type: 'run_log', data: { text: `❌ Project map niet gevonden: ${projectDir}`, level: 'error' } });
    onStream({ type: 'run_log', data: { text: `  Gebruik eerst "start project ${name}" om het te bouwen.`, level: 'info' } });
    onStream({ type: 'run_done', data: { success: false, projectDir } });
    return;
  }

  const history = loadHistory(projectDir, name);
  const trainCount = history.runs.filter(r => r.phase === 'train').length;

  onStream({ type: 'run_log', data: { text: `📁 Project: ${projectDir}`, level: 'info' } });
  onStream({ type: 'run_log', data: { text: `📊 Geschiedenis: ${trainCount} training${trainCount !== 1 ? 's' : ''} voltooid`, level: 'info' } });

  // Before training: FORGE improves the config
  if (phase === 'train' && trainCount > 0) {
    const improvements = computeImprovements(history, onStream);
    if (Object.keys(improvements).length > 0) {
      onStream({ type: 'run_log', data: { text: `\n⚙ config.py aanpassen voor slimmere training:`, level: 'improve' } });
      updateConfig(projectDir, improvements, onStream);
      onStream({ type: 'run_log', data: { text: `✓ Config bijgewerkt\n`, level: 'success' } });
    }
  }

  const currentConfig = readConfig(projectDir);

  // pip install
  const reqFile = join(projectDir, 'requirements.txt');
  if (existsSync(reqFile)) {
    onStream({ type: 'run_log', data: { text: `📦 Packages installeren...`, level: 'info' } });
    await runCmd('pip', ['install', '-r', 'requirements.txt', '--quiet', '--disable-pip-version-check'], projectDir, 'pip install -r requirements.txt', onStream);
  }

  // Run main script
  const script = phase === 'test' ? 'evaluate.py' : 'train.py';
  onStream({ type: 'run_log', data: { text: `\n🚀 ${phase === 'train' ? 'Training' : 'Evaluatie'} starten (run #${trainCount + 1})...`, level: 'info' } });

  const { exitCode, lines } = await runCmd('python', [script], projectDir, `python ${script}`, onStream);

  // Save metrics + history
  const metrics = parseMetrics(lines);
  const run: TrainingRun = {
    runId: history.runs.length + 1,
    timestamp: new Date().toISOString(),
    phase,
    metrics: { ...metrics, exitCode },
    config: currentConfig,
  };
  history.runs.push(run);
  saveHistory(projectDir, history);

  // Run summary
  onStream({ type: 'run_log', data: { text: `\n📈 Run #${run.runId} opgeslagen in training_history.json`, level: 'improve' } });
  if (metrics.epochsCompleted > 0)
    onStream({ type: 'run_log', data: { text: `  Epochs voltooid : ${metrics.epochsCompleted}`, level: 'stdout' } });
  if (metrics.finalLoss !== null)
    onStream({ type: 'run_log', data: { text: `  Finale loss     : ${metrics.finalLoss.toFixed(6)}`, level: 'stdout' } });
  if (metrics.bestAccuracy !== null)
    onStream({ type: 'run_log', data: { text: `  Accuracy        : ${(metrics.bestAccuracy * 100).toFixed(2)}%`, level: 'stdout' } });

  const nextHint = phase === 'train'
    ? `Volgende keer "run project ${name}" → FORGE past config automatisch aan`
    : `Gebruik "run project ${name}" om verder te trainen`;

  onStream({ type: 'run_log', data: { text: `\n✓ KLAAR — ${nextHint}`, level: 'success' } });
  onStream({ type: 'run_done', data: { success: exitCode === 0, projectDir, phase } });
}
