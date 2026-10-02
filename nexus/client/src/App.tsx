import { useState, useEffect } from 'react';
import { playStartupGreeting } from './hooks/useSpeech';
import { applyTheme } from './config/personalization';
import { TickerBar } from './components/TickerBar';
import { MetricsBar } from './components/MetricsBar';
import { ActivityPanel } from './components/ActivityPanel';
import { Command } from './pages/Command';
import { ForgeLabPage } from './pages/ForgeLabPage';
import { Settings } from './pages/Settings';
import { NeuralNetView } from './components/NeuralNetView';
import { NeuralOverlay } from './components/NeuralOverlay';
import { AgentSettingsPage } from './pages/AgentSettingsPage';
import { ApiManagerPage } from './pages/ApiManagerPage';
import { JarvisUI } from './components/JarvisUI';
import { EcosystemPage }  from './pages/EcosystemPage';
import { AutomationPage } from './pages/AutomationPage';
import { TradePage } from './pages/TradePage';
type Tab = 'command' | 'forge' | 'system' | 'neural' | 'agents' | 'api' | 'automation' | 'trade';

const TABS: { id: Tab; label: string; icon: string; color: string; desc: string }[] = [
  { id: 'command',    label: 'Command',    icon: '◈',   color: '#00d9ff', desc: 'AI Interface'  },
  { id: 'forge',      label: 'Forge Lab',  icon: '</>',  color: '#ff7a2a', desc: 'Training'      },
  { id: 'neural',     label: 'Neural',     icon: '◉',   color: '#a78bfa', desc: 'Topology'      },
  { id: 'automation', label: 'Automation', icon: '↯',   color: '#f43f5e', desc: 'Flows'         },
  { id: 'trade',      label: 'Trade',      icon: '◬',   color: '#22d3a8', desc: 'Terminal'      },
  { id: 'agents',     label: 'Agents',     icon: '⬡',   color: '#fbbf24', desc: 'Profiles'      },
  { id: 'api',        label: 'API',        icon: '⊕',   color: '#38bdf8', desc: 'Manager'       },
  { id: 'system',     label: 'System',     icon: '▣',   color: '#818cf8', desc: 'Config'        },
];

const VALID_TABS = new Set<Tab>(TABS.map(t => t.id));

export default function App() {
  const [activeTab,  setActiveTab]  = useState<Tab>(() => {
    const saved = localStorage.getItem('nexus_tab') as Tab;
    return VALID_TABS.has(saved) ? saved : 'command';
  });
  const [jarvisMode,     setJarvisMode]     = useState(false);
  const [neuralMode,     setNeuralMode]     = useState(false);
  const [ecosystemMode,  setEcosystemMode]  = useState(false);
  const [phoneMode,      setPhoneMode]      = useState(() => window.innerWidth < 768);

  useEffect(() => {
    applyTheme();
    const t = setTimeout(playStartupGreeting, 800);
    return () => clearTimeout(t);
  }, []);

  const switchTab = (tab: Tab) => {
    setActiveTab(tab);
    localStorage.setItem('nexus_tab', tab);
  };

  const active = TABS.find(t => t.id === activeTab)!;

  if (phoneMode) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'rgba(8,12,22,1)' }}>
        {jarvisMode     && <JarvisUI      onClose={() => setJarvisMode(false)} />}
        {neuralMode     && <NeuralOverlay onClose={() => setNeuralMode(false)} />}
        {ecosystemMode  && <EcosystemPage onClose={() => setEcosystemMode(false)} />}

        {/* Phone header */}
        <header style={{
          height: '48px', background: 'rgba(10,16,28,0.98)',
          borderBottom: '1px solid rgba(0,190,255,0.1)',
          display: 'flex', alignItems: 'center', padding: '0 14px', gap: '8px', flexShrink: 0,
        }}>
          <span style={{ fontSize: '14px', fontWeight: 700, color: '#00d9ff', fontFamily: 'monospace' }}>NEXUS</span>
          <span style={{ color: 'rgba(100,140,180,0.3)', fontSize: '12px' }}>/</span>
          <span style={{ fontSize: '14px', color: active.color, fontWeight: 600 }}>{active.label}</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={() => setPhoneMode(false)}
            style={{ background: 'rgba(0,217,255,0.1)', border: '1px solid rgba(0,217,255,0.2)', borderRadius: '8px', color: '#00d9ff', fontSize: '11px', padding: '4px 10px', cursor: 'pointer' }}
          >🖥 Desktop</button>
        </header>

        {/* Content */}
        <div className="phone-content">
          {activeTab === 'command'    && <Command />}
          {activeTab === 'forge'      && <ForgeLabPage />}
          {activeTab === 'system'     && <Settings />}
          {activeTab === 'neural'     && <NeuralNetView />}
          {activeTab === 'agents'     && <AgentSettingsPage />}
          {activeTab === 'api'        && <ApiManagerPage />}
          {activeTab === 'automation' && <AutomationPage />}
          {activeTab === 'trade'      && <TradePage />}
        </div>

        {/* Bottom nav */}
        <nav style={{
          height: '60px', background: 'rgba(10,16,28,0.98)',
          borderTop: '1px solid rgba(0,190,255,0.1)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-around',
          flexShrink: 0, padding: '0 4px',
        }}>
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => switchTab(tab.id)}
                style={{
                  flex: 1, height: '52px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '3px',
                  background: isActive ? `${tab.color}14` : 'transparent',
                  border: 'none', borderRadius: '10px', cursor: 'pointer',
                  color: isActive ? tab.color : 'rgba(100,140,180,0.45)',
                }}
              >
                <span style={{ fontSize: '16px' }}>{tab.icon}</span>
                <span style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.03em' }}>{tab.label.slice(0, 5).toUpperCase()}</span>
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {jarvisMode     && <JarvisUI      onClose={() => setJarvisMode(false)} />}
      {neuralMode     && <NeuralOverlay onClose={() => setNeuralMode(false)} />}
      {ecosystemMode  && <EcosystemPage onClose={() => setEcosystemMode(false)} />}

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <nav style={{
        width: '64px',
        background: 'rgba(10,16,28,0.95)',
        borderRight: '1px solid rgba(0,190,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: '12px',
        paddingBottom: '12px',
        gap: '1px',
        flexShrink: 0,
        zIndex: 20,
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
      }}>
        {/* Logo mark */}
        <div style={{
          width: '36px', height: '36px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: '10px',
          background: 'rgba(0,217,255,0.1)',
          border: '1px solid rgba(0,217,255,0.18)',
          fontSize: '14px', fontWeight: 700,
          color: '#00d9ff',
          marginBottom: '14px',
          fontFamily: "'Cascadia Code', 'Consolas', monospace",
          flexShrink: 0,
          letterSpacing: '-0.02em',
        }}>N</div>

        {/* Nav items */}
        {TABS.map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <div key={tab.id} style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => switchTab(tab.id)}
                title={tab.label}
                style={{
                  width: '48px', height: '44px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: '2px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: 'none', outline: 'none',
                  background: isActive ? `${tab.color}14` : 'transparent',
                  color: isActive ? tab.color : 'rgba(100,140,180,0.5)',
                  transition: 'all 0.18s',
                  position: 'relative',
                }}
                onMouseEnter={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'rgba(0,190,255,0.06)';
                    e.currentTarget.style.color = 'rgba(160,210,255,0.75)';
                  }
                }}
                onMouseLeave={e => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'rgba(100,140,180,0.5)';
                  }
                }}
              >
                <span style={{
                  fontFamily: "'Cascadia Code', 'Consolas', monospace",
                  fontSize: '12px', lineHeight: 1,
                  filter: isActive ? `drop-shadow(0 0 5px ${tab.color}80)` : 'none',
                  transition: 'filter 0.18s',
                }}>{tab.icon}</span>
                <span style={{
                  fontSize: '8px', fontWeight: 600,
                  letterSpacing: '0.04em',
                  color: isActive ? `${tab.color}cc` : 'rgba(100,140,180,0.38)',
                  lineHeight: 1,
                  transition: 'color 0.18s',
                }}>{tab.label.slice(0, 5).toUpperCase()}</span>
              </button>

              {/* Active left indicator */}
              {isActive && (
                <div style={{
                  position: 'absolute',
                  left: '0px', top: '18%', bottom: '18%',
                  width: '2px',
                  background: `linear-gradient(180deg, transparent, ${tab.color}cc, transparent)`,
                  borderRadius: '0 2px 2px 0',
                }} />
              )}
            </div>
          );
        })}

        <div style={{ flex: 1 }} />

        {/* Divider */}
        <div style={{ width: '32px', height: '1px', background: 'rgba(0,190,255,0.08)', margin: '6px 0' }} />

        {/* Phone mode toggle */}
        <button
          onClick={() => setPhoneMode(true)}
          title="Phone Mode"
          style={{
            width: '48px', height: '44px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            borderRadius: '10px', cursor: 'pointer', border: 'none', outline: 'none',
            background: 'transparent',
            color: 'rgba(100,140,180,0.45)',
            transition: 'all 0.18s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(0,190,255,0.06)'; e.currentTarget.style.color = 'rgba(160,210,255,0.75)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(100,140,180,0.45)'; }}
        >
          <span style={{ fontSize: '13px' }}>📱</span>
          <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.04em', color: 'rgba(100,140,180,0.3)' }}>PHONE</span>
        </button>

        {/* Ecosystem toggle */}
        <button
          onClick={() => setEcosystemMode(v => !v)}
          title="Ecosystem"
          style={{
            width: '48px', height: '44px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            borderRadius: '10px', cursor: 'pointer', border: 'none', outline: 'none',
            background: ecosystemMode ? 'rgba(160,255,100,0.12)' : 'transparent',
            color: ecosystemMode ? '#a0ff64' : 'rgba(100,140,180,0.45)',
            transition: 'all 0.18s',
          }}
          onMouseEnter={e => { if (!ecosystemMode) e.currentTarget.style.background = 'rgba(0,190,255,0.06)'; }}
          onMouseLeave={e => { if (!ecosystemMode) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '13px', filter: ecosystemMode ? 'drop-shadow(0 0 5px #a0ff64)' : 'none' }}>⬡</span>
          <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.04em', color: ecosystemMode ? '#a0ff6499' : 'rgba(100,140,180,0.3)' }}>ECO</span>
        </button>

        {/* Neural toggle */}
        <button
          onClick={() => setNeuralMode(v => !v)}
          title="Neural Overlay"
          style={{
            width: '48px', height: '44px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            borderRadius: '10px', cursor: 'pointer', border: 'none', outline: 'none',
            background: neuralMode ? 'rgba(167,139,250,0.12)' : 'transparent',
            color: neuralMode ? '#a78bfa' : 'rgba(100,140,180,0.45)',
            transition: 'all 0.18s',
          }}
          onMouseEnter={e => { if (!neuralMode) e.currentTarget.style.background = 'rgba(0,190,255,0.06)'; }}
          onMouseLeave={e => { if (!neuralMode) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '13px', filter: neuralMode ? 'drop-shadow(0 0 5px #a78bfa)' : 'none' }}>⬡</span>
          <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.04em', color: neuralMode ? '#a78bfa99' : 'rgba(100,140,180,0.3)' }}>NET</span>
        </button>

        {/* Jarvis toggle */}
        <button
          onClick={() => setJarvisMode(v => !v)}
          title="JARVIS AI"
          style={{
            width: '48px', height: '44px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2px',
            borderRadius: '10px', cursor: 'pointer', border: 'none', outline: 'none',
            background: jarvisMode ? 'rgba(0,217,255,0.12)' : 'transparent',
            color: jarvisMode ? '#00d9ff' : 'rgba(100,140,180,0.45)',
            transition: 'all 0.18s',
          }}
          onMouseEnter={e => { if (!jarvisMode) e.currentTarget.style.background = 'rgba(0,190,255,0.06)'; }}
          onMouseLeave={e => { if (!jarvisMode) e.currentTarget.style.background = 'transparent'; }}
        >
          <span style={{ fontSize: '13px', filter: jarvisMode ? 'drop-shadow(0 0 5px #00d9ff)' : 'none' }}>◎</span>
          <span style={{ fontSize: '8px', fontWeight: 600, letterSpacing: '0.04em', color: jarvisMode ? '#00d9ff99' : 'rgba(100,140,180,0.3)' }}>JARVIS</span>
        </button>
      </nav>

      {/* ── Right: header + ticker + content ─────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden' }}>

        {/* Top header bar */}
        <header style={{
          height: '44px',
          background: 'rgba(10,16,28,0.95)',
          borderBottom: '1px solid rgba(0,190,255,0.07)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 18px',
          gap: '10px',
          flexShrink: 0,
          backdropFilter: 'blur(28px)',
          WebkitBackdropFilter: 'blur(28px)',
        }}>
          {/* Breadcrumb */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ fontSize: '11px', color: 'rgba(100,140,180,0.4)', fontWeight: 500, letterSpacing: '0.06em' }}>
              NEXUS
            </span>
            <span style={{ color: 'rgba(100,140,180,0.2)', fontSize: '11px' }}>/</span>
            <span style={{ fontSize: '13px', color: active.color, fontWeight: 600 }}>
              {active.label}
            </span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Status pills */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {[
              { label: 'Server',   color: '#22d3a8' },
              { label: 'Camelllo', color: '#00d9ff' },
              { label: 'Forge',    color: '#ff7a2a' },
            ].map(s => (
              <div key={s.label} style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '3px 9px', borderRadius: '20px',
                background: `${s.color}09`, border: `1px solid ${s.color}18`,
              }}>
                <div style={{
                  width: '5px', height: '5px', borderRadius: '50%',
                  background: s.color,
                  animation: 'dot-pulse 2.5s ease-in-out infinite',
                }} />
                <span style={{ fontSize: '10px', fontWeight: 500, color: `${s.color}99`, letterSpacing: '0.02em' }}>
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </header>

        {/* Ticker */}
        <TickerBar />

        {/* Metrics */}
        <MetricsBar />

        {/* Main content */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          {/* Page content */}
          <div style={{ flex: '1 1 0', minWidth: 0 }}>
            {activeTab === 'command'    && <Command />}
            {activeTab === 'forge'      && <ForgeLabPage />}
            {activeTab === 'system'     && <Settings />}
            {activeTab === 'neural'     && <NeuralNetView />}
            {activeTab === 'agents'     && <AgentSettingsPage />}
            {activeTab === 'api'        && <ApiManagerPage />}
            {activeTab === 'automation' && <AutomationPage />}
            {activeTab === 'trade'      && <TradePage />}
          </div>

          {/* Right sidebar — agent activity (command tab only) */}
          {activeTab === 'command' && (
            <div style={{
              width: '255px', flexShrink: 0,
              borderLeft: '1px solid rgba(0,190,255,0.07)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
            }}>
              <div style={{ flex: '1 1 0', minHeight: 0, borderBottom: '1px solid rgba(0,190,255,0.07)', overflow: 'hidden' }}>
                <ActivityPanel type="agents" title="AGENT ACTIVITY" subtitle="LIVE" />
              </div>
              <div style={{ flex: '1 1 0', minHeight: 0, overflow: 'hidden' }}>
                <ActivityPanel type="system" title="SYSTEM" subtitle="TELEMETRY" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
