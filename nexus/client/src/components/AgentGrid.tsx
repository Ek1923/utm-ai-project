import { useState } from 'react';
import { AgentAvatar } from './AgentAvatar';

const AGENTS = [
  { id: 'apex1',  name: 'APEX-1',  color: '#00ffd5', accuracy: 99, role: 'GENERAL' },
  { id: 'apex2',  name: 'APEX-2',  color: '#b400ff', accuracy: 97, role: 'GENERAL' },
  { id: 'forge',  name: 'FORGE',   color: '#ff6b00', accuracy: 96, role: 'CODE' },
  { id: 'spark',  name: 'SPARK',   color: '#ffb800', accuracy: 94, role: 'IDEEËN' },
  { id: 'atlas',  name: 'ATLAS',   color: '#00b4ff', accuracy: 98, role: 'KENNIS' },
  { id: 'tactix', name: 'TACTIX',  color: '#00ff9d', accuracy: 95, role: 'STRATEGIE' },
  { id: 'vega',   name: 'VEGA',    color: '#ff2d55', accuracy: 93, role: 'VICE-GEN' },
  { id: 'optic',  name: 'OPTIC',   color: '#a78bfa', accuracy: 91, role: 'DATA' },
  { id: 'jarvis', name: 'JARVIS',  color: '#c8a86b', accuracy: 90, role: 'PROJECTS' },
];

interface AgentGridProps {
  activeAgents?: string[];
}

export function AgentGrid({ activeAgents = [] }: AgentGridProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      className="flex items-stretch border-b shrink-0"
      style={{
        borderColor: 'rgba(0,255,213,0.1)',
        background: 'rgba(0,4,12,0.95)',
        height: '112px',
        overflow: 'hidden',
      }}
    >
      {AGENTS.map((agent, i) => {
        const isActive = activeAgents.includes(agent.id);
        const isHovered = hovered === agent.id;
        const dimmed = hovered !== null && !isHovered;

        return (
          <div
            key={agent.id}
            onMouseEnter={() => setHovered(agent.id)}
            onMouseLeave={() => setHovered(null)}
            className="flex flex-col items-center justify-center relative"
            style={{
              flex: isHovered ? '3 0 0' : '1 0 0',
              padding: '6px 4px 5px',
              borderRight: i < AGENTS.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              background: isHovered
                ? `${agent.color}22`
                : isActive
                ? `${agent.color}18`
                : `${agent.color}09`,
              boxShadow: isHovered
                ? `inset 0 0 40px ${agent.color}22, 0 0 20px ${agent.color}15`
                : isActive
                ? `inset 0 0 24px ${agent.color}18`
                : 'none',
              opacity: dimmed ? 0.3 : 1,
              transition: 'flex 0.28s cubic-bezier(0.34,1.56,0.64,1), opacity 0.18s ease, background 0.2s ease, box-shadow 0.2s ease',
              cursor: 'default',
              overflow: 'hidden',
            }}
          >
            {/* Top color bar */}
            <div
              className="absolute top-0 left-0 right-0"
              style={{
                height: isHovered ? '3px' : isActive ? '2px' : '0px',
                background: agent.color,
                boxShadow: (isHovered || isActive) ? `0 0 ${isHovered ? 12 : 8}px ${agent.color}` : 'none',
                transition: 'height 0.18s ease',
              }}
            />

            {/* Active ping dot */}
            {isActive && !isHovered && (
              <div
                className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full animate-ping"
                style={{ background: agent.color }}
              />
            )}

            {/* Avatar */}
            <AgentAvatar id={agent.id} size={46} active={isActive || isHovered} />

            {/* Name + accuracy row on hover */}
            <div className="flex items-center gap-1 justify-center">
              <div
                className="font-mono font-bold tracking-wider text-center whitespace-nowrap"
                style={{
                  fontSize: isHovered ? '13px' : '13px',
                  marginTop: '3px',
                  color: (isHovered || isActive) ? agent.color : agent.color + '99',
                  textShadow: (isHovered || isActive) ? `0 0 ${isHovered ? 12 : 8}px ${agent.color}` : 'none',
                  letterSpacing: '0.08em',
                  transition: 'color 0.18s ease',
                }}
              >
                {agent.name}
              </div>
              {isHovered && (
                <div
                  className="font-mono font-bold whitespace-nowrap"
                  style={{ fontSize: '10px', color: agent.color, marginTop: '3px', opacity: 0.8 }}
                >
                  {agent.accuracy}%
                </div>
              )}
            </div>

            {/* Role */}
            <div
              className="font-mono text-center whitespace-nowrap"
              style={{
                fontSize: '8px',
                color: isHovered ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.45)',
                letterSpacing: '0.06em',
                lineHeight: 1,
                transition: 'color 0.18s ease',
              }}
            >
              {agent.role}
            </div>

            {/* Progress bar */}
            <div className="w-full mt-1.5 overflow-hidden" style={{ height: '5px', background: 'rgba(255,255,255,0.04)', borderRadius: '4px' }}>
              <div
                style={{
                  width: `${agent.accuracy}%`,
                  height: '100%',
                  background: agent.color,
                  boxShadow: (isHovered || isActive) ? `0 0 6px ${agent.color}` : 'none',
                  transition: 'width 1s ease, box-shadow 0.18s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
