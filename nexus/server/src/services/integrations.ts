import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

const DATA_FILE = path.resolve(process.cwd(), 'data', 'integrations.json');

export interface ApiIntegration {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  apiKey: string;
  type: string;
  enabled: boolean;
  agents: string[];
  calls: number;
  lastUsed: string | null;
  createdAt: string;
}

function ensureFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf-8');
}

export function loadIntegrations(): ApiIntegration[] {
  ensureFile();
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveIntegrations(list: ApiIntegration[]) {
  ensureFile();
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2), 'utf-8');
}

export function createIntegration(data: Omit<ApiIntegration, 'id' | 'calls' | 'lastUsed' | 'createdAt'>): ApiIntegration {
  const list = loadIntegrations();
  const item: ApiIntegration = {
    ...data,
    id: randomUUID(),
    calls: 0,
    lastUsed: null,
    createdAt: new Date().toISOString(),
  };
  list.push(item);
  saveIntegrations(list);
  return item;
}

export function updateIntegration(id: string, patch: Partial<ApiIntegration>): ApiIntegration | null {
  const list = loadIntegrations();
  const idx = list.findIndex(i => i.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, id };
  saveIntegrations(list);
  return list[idx];
}

export function deleteIntegration(id: string): boolean {
  const list = loadIntegrations();
  const filtered = list.filter(i => i.id !== id);
  if (filtered.length === list.length) return false;
  saveIntegrations(filtered);
  return true;
}

export function recordApiCall(id: string) {
  const list = loadIntegrations();
  const idx = list.findIndex(i => i.id === id);
  if (idx !== -1) {
    list[idx].calls += 1;
    list[idx].lastUsed = new Date().toISOString();
    saveIntegrations(list);
  }
}

export function getAgentIntegrations(agentId: string): ApiIntegration[] {
  return loadIntegrations().filter(i => i.enabled && i.agents.includes(agentId));
}
