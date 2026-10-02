import chokidar from 'chokidar';
import { exec } from 'child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { queryAgent } from './ollama.js';
import { db } from './database.js';

const execAsync = promisify(exec);

let healthScore = 100;
const approvalQueue: ForgeFix[] = [];
let autoApprove = false;
let watching = false;

export interface ForgeFix {
  id: number;
  file: string;
  error: string;
  fix: string;
  diagnosis: string;
  confidence: number;
}

export function startForgeWatcher(watchPaths = ['server/src', 'client/src']) {
  if (watching) return;
  watching = true;
  console.log('🔧 FORGE Watcher starting...');

  const watcher = chokidar.watch(watchPaths, {
    ignored: /node_modules|\.git|dist/,
    awaitWriteFinish: { stabilityThreshold: 1500, pollInterval: 200 },
    ignoreInitial: true,
  });

  watcher.on('change', async filePath => {
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return;
    console.log(`📝 FORGE noticed: ${filePath}`);
    try {
      await execAsync('npx tsc --noEmit --skipLibCheck', { cwd: process.cwd() });
    } catch (err: any) {
      await forgeAutoRepair(filePath, err.stderr ?? err.stdout ?? String(err));
    }
    recalcHealth();
  });

  setInterval(recalcHealth, 10 * 60 * 1000);
  console.log('✅ FORGE Watcher active on:', watchPaths.join(', '));
}

async function forgeAutoRepair(filePath: string, errorMsg: string) {
  console.log(`🔧 FORGE diagnosing: ${filePath}`);
  let fileContent = '';
  try { fileContent = readFileSync(filePath, 'utf-8'); } catch { return; }

  const prompt = `You are FORGE, master TypeScript developer. Fix this error.
File: ${filePath}
Error: ${errorMsg.slice(0, 1000)}
Code:
${fileContent.slice(0, 3000)}

Respond ONLY with JSON: { "diagnosis": "what is wrong", "fixedCode": "complete fixed file content", "confidence": 0.95 }`;

  try {
    const raw = await queryAgent('forge', prompt, 0.3);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in FORGE response');

    const parsed = JSON.parse(jsonMatch[0]);

    if (parsed.confidence > 0.85 && autoApprove) {
      writeFileSync(filePath, parsed.fixedCode, 'utf-8');
      db.prepare(`INSERT INTO forge_fixes (file, error, fix, confidence, auto_approved) VALUES (?, ?, ?, ?, 1)`)
        .run(filePath, errorMsg.slice(0, 500), parsed.fixedCode, parsed.confidence);
      console.log(`✅ FORGE auto-fixed: ${filePath} (confidence ${parsed.confidence})`);
    } else {
      const fix: ForgeFix = {
        id: Date.now(),
        file: filePath,
        error: errorMsg.slice(0, 500),
        fix: parsed.fixedCode,
        diagnosis: parsed.diagnosis,
        confidence: parsed.confidence,
      };
      approvalQueue.push(fix);
      console.log(`⏸️  FORGE queued fix (confidence ${parsed.confidence}) — approve via UI`);
    }
  } catch (err) {
    console.error('❌ FORGE repair failed:', (err as Error).message);
  }
}

function recalcHealth() {
  healthScore = Math.max(50, 100 - approvalQueue.length * 5);
  console.log(`📊 System health: ${healthScore}%`);
}

export function getForgeStatus() {
  return { watching, health: healthScore, approvalQueue: approvalQueue.length, autoApprove };
}

export function getApprovalQueue() {
  return [...approvalQueue];
}

export function toggleAutoApprove() {
  autoApprove = !autoApprove;
  console.log(`🔄 Auto-approve: ${autoApprove}`);
  return autoApprove;
}

export function approveFix(fixId: number) {
  const idx = approvalQueue.findIndex(f => f.id === fixId);
  if (idx === -1) return false;
  const fix = approvalQueue[idx];
  writeFileSync(fix.file, fix.fix, 'utf-8');
  db.prepare(`INSERT INTO forge_fixes (file, error, fix, confidence, auto_approved) VALUES (?, ?, ?, ?, 0)`)
    .run(fix.file, fix.error, fix.fix, fix.confidence);
  approvalQueue.splice(idx, 1);
  recalcHealth();
  console.log(`✅ Approved fix: ${fix.file}`);
  return true;
}
