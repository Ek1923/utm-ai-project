import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, '../../../nexus.db');

export const db = new DatabaseSync(DB_PATH);

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt TEXT NOT NULL,
      routing TEXT,
      responses TEXT,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      prompt TEXT,
      response TEXT,
      rating INTEGER,
      comment TEXT,
      used_in_training INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS forge_fixes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file TEXT,
      error TEXT,
      fix TEXT,
      confidence REAL,
      auto_approved INTEGER DEFAULT 0,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS training_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent TEXT NOT NULL,
      type TEXT NOT NULL,
      pairs_added INTEGER DEFAULT 0,
      success INTEGER DEFAULT 1,
      timestamp DATETIME DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS trade_strategies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL DEFAULT 'BTC',
      apex2_analysis TEXT NOT NULL,
      tactix_strategy TEXT NOT NULL,
      market_snapshot TEXT,
      rating INTEGER DEFAULT 0,
      outcome TEXT DEFAULT 'pending',
      pnl_pct REAL,
      timestamp DATETIME DEFAULT (datetime('now'))
    );
  `);

  console.log('✅ Database initialized:', DB_PATH);
}
