export interface RoutingDecision {
  agents: string[];
  reasoning: string;
  announcement: string;
}

export interface AgentResponse {
  agent: string;
  response: string;
}

export interface ForgeStatus {
  watching: boolean;
  health: number;
  approvalQueue: number;
  autoApprove: boolean;
}

export interface ForgeFix {
  id: number;
  file: string;
  error: string;
  fix: string;
  diagnosis: string;
  confidence: number;
}

export interface MapData {
  found: boolean;
  query: string;
  result: { display_name: string; lat: string; lon: string; type: string; address: Record<string,string>; boundingbox: string[] } | null;
  mapUrl: string;
  embedUrl: string;
  directionsUrl: string;
}

export interface NexusMessage {
  role: 'user' | 'routing' | 'agent' | 'apex2' | 'synthesis' | 'error' | 'training' | 'project' | 'run' | 'map';
  content: string;
  agent?: string;
  timestamp: number;
  meta?: Record<string, string>;
  mapData?: MapData;
}

export interface StreamEvent {
  type: 'routing' | 'voice' | 'agent_response' | 'verdict' | 'done' | 'error' | 'token' | 'direct_start' | 'training_log' | 'training_done' | 'project_log' | 'project_file' | 'project_done' | 'run_log' | 'run_done' | 'map' | 'synthesis_start' | 'synthesis_token' | 'synthesis_done';
  data: any;
}

export type AgentId = 'apex1' | 'apex2' | 'forge' | 'spark' | 'atlas' | 'tactix' | 'vega' | 'nexus_ui';

export const AGENT_COLORS: Record<string, string> = {
  apex1: 'text-teal-300',
  apex2: 'text-purple-300',
  forge: 'text-orange-300',
  spark: 'text-yellow-300',
  atlas: 'text-blue-300',
  tactix: 'text-green-300',
  vega: 'text-pink-300',
  nexus_ui: 'text-cyan-300',
};
