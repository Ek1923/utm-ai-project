import raw from './personalization.json';

export interface Personalization {
  commander: {
    name: string;
    title: string;
    clearance: string;
    initials: string;
  };
  voice: {
    greeting: string;
    rate: number;
    pitch: number;
    speechLang: string;
  };
  theme: {
    accentColor: string;
    accentRgb: string;
  };
  system: {
    defaultTab: string;
    liveModeLang: string;
    showCommanderInHeader: boolean;
    version: string;
  };
  quickCommands: string[];
  agents: {
    defaultDirect: string;
  };
}

export const p: Personalization = raw as Personalization;

// Apply theme CSS variables to the document root
export function applyTheme() {
  const root = document.documentElement;
  root.style.setProperty('--neon-teal', p.theme.accentColor);
  root.style.setProperty('--border-dim', `rgba(${p.theme.accentRgb},0.12)`);
  root.style.setProperty('--border-glow', `rgba(${p.theme.accentRgb},0.45)`);
}
