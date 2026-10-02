import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import type { TrainingMetrics } from './NeuralOverlay';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass }    from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { useStatsStream } from '../hooks/useStatsStream';
import type { AgentStats } from '../hooks/useStatsStream';

// ── Agent definitions ────────────────────────────────────────────────────────
const BASE_NODES: Record<string, number> = {
  apex1: 48, apex2: 32, forge: 56, spark: 40,
  atlas: 52, tactix: 36, vega: 30, nexus_ui: 28,
  phi35: 80, deepseek: 72,
};

const AGENT_DEFS = [
  { id: 'apex1',    name: 'APEX-1',   color: 0x00ffd5, hex: '#00ffd5', role: 'ORCHESTRATOR', size: 0.85 },
  { id: 'apex2',    name: 'APEX-2',   color: 0xb400ff, hex: '#b400ff', role: 'QUALITY',      size: 0.60 },
  { id: 'forge',    name: 'FORGE',    color: 0xff6b00, hex: '#ff6b00', role: 'DEVELOPER',    size: 0.78 },
  { id: 'spark',    name: 'SPARK',    color: 0xffb800, hex: '#ffb800', role: 'IDEATION',     size: 0.65 },
  { id: 'atlas',    name: 'ATLAS',    color: 0x00b4ff, hex: '#00b4ff', role: 'KNOWLEDGE',    size: 0.75 },
  { id: 'tactix',   name: 'TACTIX',   color: 0x00ff9d, hex: '#00ff9d', role: 'PLANNING',     size: 0.62 },
  { id: 'vega',   name: 'VEGA',   color: 0xff2d55, hex: '#ff2d55', role: 'VICE-GEN',   size: 0.55 },
  { id: 'optic',  name: 'OPTIC',  color: 0xa78bfa, hex: '#a78bfa', role: 'DATA',       size: 0.52 },
  { id: 'jarvis', name: 'JARVIS', color: 0xc8a86b, hex: '#c8a86b', role: 'PROJECTS',   size: 0.50 },
  { id: 'phi35',    name: 'PHI-3.5',  color: 0xff66cc, hex: '#ff66cc', role: 'BASE MODEL',   size: 0.90 },
  { id: 'deepseek', name: 'DEEPSEEK', color: 0x44aaff, hex: '#44aaff', role: 'CODE ENGINE',  size: 0.82 },
];

function computeNodes(id: string, stats: Record<string, AgentStats>): number {
  const base = BASE_NODES[id] ?? 30;
  const s = stats[id];
  if (!s) return base;
  return base + s.feedback * 2 + s.trained * 4
    + Math.floor(s.commands / 10) + (s.trainRuns ?? 0) * 6
    + Math.floor((s.collectedPairs ?? 0) / 5);
}

// Parse real param size string → number in billions (e.g. "6.7B" → 6.7)
function parseParams(paramSize: string): number | null {
  const n = parseFloat(paramSize);
  return Number.isFinite(n) ? n : null;
}

// Real LoRA adapter parameter count per model, based on forge_train.py config:
// rank=64, 7 target modules (q,k,v,o,gate,up,down), per 32 layers
// Formula: Σ_layers Σ_modules (rank × dim_in + rank × dim_out)
// DeepSeek Coder 6.7B: hidden=4096, intermediate=11008
//   attn (q,k,v,o): 4 × 64 × (4096+4096) × 32 = 0.067B
//   ffn (gate,up,down): 3 × 64 × (4096+11008) × 32 = 0.093B
//   total adapters ≈ 0.160B
// Phi-3.5 3.8B: hidden=3072, intermediate=8192
//   attn: 4 × 64 × (3072+3072) × 32 = 0.050B
//   ffn: 3 × 64 × (3072+8192) × 32 = 0.069B
//   total adapters ≈ 0.119B
const LORA_ADAPTER_B: Record<string, number> = {
  'deepseek-coder': 0.160,
  'phi3.5':         0.119,
};

// Map agent id → model name for adapter lookup
const AGENT_BASE_MODEL: Record<string, string> = {
  forge: 'deepseek-coder',
  apex1: 'phi3.5', apex2: 'phi3.5', spark: 'phi3.5',
  atlas: 'phi3.5', tactix: 'phi3.5', vega: 'phi3.5', nexus_ui: 'phi3.5',
};

// Fibonacci sphere distribution — beautiful 3D spread
function fibSphere(i: number, n: number, r: number): [number, number, number] {
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));
  const y      = 1 - (i / (n - 1)) * 2;
  const rad    = Math.sqrt(1 - y * y);
  const theta  = GOLDEN * i;
  return [Math.cos(theta) * rad * r, y * r * 0.75, Math.sin(theta) * rad * r];
}

function fmtElapsed(s: number) {
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${Math.floor(s % 60)}s` : `${Math.floor(s)}s`;
}
function lossColor(l: number) {
  return l <= 0 ? '#555' : l < 1.2 ? '#00ff9d' : l < 2.0 ? '#ffb800' : '#ff2d55';
}

// ── Component ────────────────────────────────────────────────────────────────
interface NeuralNetViewProps {
  activeAgents?:    string[];
  trainingAgents?:  string[];
  trainingMetrics?: Record<string, TrainingMetrics>;
}

export function NeuralNetView({ activeAgents = [], trainingAgents = [], trainingMetrics = {} }: NeuralNetViewProps) {
  const mountRef    = useRef<HTMLDivElement>(null);
  const animRef     = useRef<number>(0);
  const activeRef   = useRef(activeAgents);
  const trainingRef = useRef(trainingAgents);
  const metricsRef  = useRef(trainingMetrics);
  const isDragging  = useRef(false);
  const lastMouse   = useRef({ x: 0, y: 0 });
  const rotRef      = useRef({ x: 0.14, y: 0 });
  const autoRotRef  = useRef(true);

  const stream = useStatsStream();
  const [stats,          setStats]          = useState<Record<string, AgentStats>>({});
  const [hovered,        setHovered]        = useState<string | null>(null);
  const [selectedAgent,  setSelectedAgent]  = useState<string | null>(null);
  const [nodeFlashes,    setNodeFlashes]    = useState<Record<string, { value: number; key: number }>>({});
  const [modelParams,    setModelParams]    = useState<Record<string, { paramSize: string; family: string; quantization: string }>>({});
  const prevNodesRef     = useRef<Record<string, number>>({});
  const hasFlashedOnOpen = useRef(false);

  useEffect(() => { activeRef.current   = activeAgents;   }, [activeAgents]);
  useEffect(() => { trainingRef.current = trainingAgents; }, [trainingAgents]);
  useEffect(() => { metricsRef.current  = trainingMetrics; }, [trainingMetrics]);

  // Auto-deselect 4s after training stops
  useEffect(() => {
    if (selectedAgent && !trainingAgents.includes(selectedAgent) && !trainingMetrics[selectedAgent]) {
      const t = setTimeout(() => setSelectedAgent(null), 4000);
      return () => clearTimeout(t);
    }
  }, [trainingAgents, trainingMetrics, selectedAgent]);

  const handleAgentClick = useCallback((agentId: string, isTraining: boolean) => {
    if (!isTraining && !trainingMetrics[agentId]) return;
    setSelectedAgent(p => p === agentId ? null : agentId);
  }, [trainingMetrics]);
  useEffect(() => { if (stream?.stats) setStats(stream.stats); }, [stream]);

  // Fetch real model params from Ollama via server
  useEffect(() => {
    fetch('/api/models/params')
      .then(r => r.json())
      .then(d => setModelParams(d.params ?? {}))
      .catch(() => {});
  }, []);

  const AGENTS = AGENT_DEFS.map(a => {
    const paramSize    = modelParams[a.id]?.paramSize    ?? '...';
    const baseParams   = parseParams(paramSize);
    const trainRuns    = stats[a.id]?.trainRuns ?? 0;
    const modelKey     = AGENT_BASE_MODEL[a.id] ?? 'phi3.5';
    // Adapter params only exist when training has been done and not yet merged
    const adapterB     = trainRuns > 0 ? (LORA_ADAPTER_B[modelKey] ?? 0) : 0;
    const totalParams  = baseParams !== null ? baseParams + adapterB : null;
    return {
      ...a,
      nodes:        computeNodes(a.id, stats),
      paramSize,
      family:       modelParams[a.id]?.family       ?? '...',
      quantization: modelParams[a.id]?.quantization ?? '...',
      baseParams,
      adapterParams: trainRuns > 0 ? adapterB : null,
      totalParams,
    };
  });

  // Node flash badges — fires ONCE on open, never again during this session
  useEffect(() => {
    if (hasFlashedOnOpen.current) return;
    if (Object.keys(stats).length === 0) return; // wait for first real data

    hasFlashedOnOpen.current = true;

    AGENTS.forEach(agent => {
      const cur  = agent.nodes;
      const prev = prevNodesRef.current[agent.id];
      if (prev !== undefined && cur > prev) {
        const diff = cur - prev;
        const key  = Date.now() + Math.random();
        setNodeFlashes(p => ({ ...p, [agent.id]: { value: diff, key } }));
        setTimeout(() => setNodeFlashes(p => {
          const next = { ...p };
          if (next[agent.id]?.key === key) delete next[agent.id];
          return next;
        }), 2800);
      }
      prevNodesRef.current[agent.id] = cur;
    });
  }, [stats]);

  // ── THREE.js scene ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const W = el.clientWidth, H = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.toneMapping       = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace   = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    // Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x00020a);
    scene.fog        = new THREE.FogExp2(0x00020a, 0.0016);

    // Camera
    const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 600);
    camera.position.set(0, 10, 52);
    camera.lookAt(0, 0, 0);

    // ── Bloom postprocessing ─────────────────────────────────────────────
    const composer  = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(W, H),
      0.9,   // strength — strakker, minder wazig
      0.28,  // radius — tight glow, niet breed uitlopen
      0.12,  // threshold — alleen het felste gloeit
    );
    composer.addPass(bloomPass);

    // ── Lighting ─────────────────────────────────────────────────────────
    scene.add(new THREE.AmbientLight(0x000a1a, 1.5));
    const ptLights: [number, [number,number,number], number][] = [
      [0x00ffd5, [ 0,  22,  0],  8],
      [0xff6b00, [-22,  8, 12],  5],
      [0x7700ff, [ 22,  8,-12],  5],
      [0x00b4ff, [  0,-16, 20],  3],
      [0xb400ff, [  0, 16,-20],  2.5],
      [0xffb800, [-14, -8, -8],  2],
      [0x00ff9d, [ 14,  4,  6],  2],
    ];
    ptLights.forEach(([color, pos, intensity]) => {
      const pl = new THREE.PointLight(color, intensity, 120);
      pl.position.set(...pos);
      scene.add(pl);
    });

    // ── Background: starfield layers ─────────────────────────────────────
    function makeStars(count: number, spread: number, size: number, color: number, opacity: number) {
      const geo = new THREE.BufferGeometry();
      const verts: number[] = [];
      for (let i = 0; i < count; i++) {
        verts.push(
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
          (Math.random() - 0.5) * spread,
        );
      }
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const mat = new THREE.PointsMaterial({ color, size, transparent: true, opacity, sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false });
      scene.add(new THREE.Points(geo, mat));
    }
    makeStars(10000, 500, 0.18, 0x3355aa, 0.8);
    makeStars(3000,  400, 0.35, 0x6688cc, 0.6);
    makeStars(800,   300, 0.6,  0x00ffd5, 0.4);  // teal accent
    makeStars(400,   250, 0.7,  0xb400ff, 0.35); // purple accent
    makeStars(200,   200, 0.9,  0xffffff, 0.5);  // bright whites

    // Nebula dust cloud
    const nebulaGeo = new THREE.BufferGeometry();
    const nebulaVerts: number[] = [];
    for (let i = 0; i < 6000; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      const r     = 60 + Math.random() * 80;
      nebulaVerts.push(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.4,
        r * Math.sin(phi) * Math.sin(theta),
      );
    }
    nebulaGeo.setAttribute('position', new THREE.Float32BufferAttribute(nebulaVerts, 3));
    scene.add(new THREE.Points(nebulaGeo, new THREE.PointsMaterial({
      color: 0x002244, size: 1.5, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    // ── Grid floor ────────────────────────────────────────────────────────
    const grid = new THREE.GridHelper(200, 100, 0x001833, 0x000d1f);
    grid.position.y = -18;
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity     = 0.6;
    scene.add(grid);

    // ── NEXUS Core ────────────────────────────────────────────────────────
    const coreGroup = new THREE.Group();
    scene.add(coreGroup);

    // Multi-layer glowing core
    const coreLayers = [
      { r: 0.5, emissive: 0x00ffd5, intensity: 4.0, metalness: 0.95, roughness: 0.0 },
      { r: 0.9, emissive: 0x0044ff, intensity: 2.0, metalness: 0.9,  roughness: 0.05 },
    ];
    const coreInner = coreLayers.map(layer => {
      const geo = new THREE.IcosahedronGeometry(layer.r, 3);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x00ffd5, emissive: new THREE.Color(layer.emissive),
        emissiveIntensity: layer.intensity,
        metalness: layer.metalness, roughness: layer.roughness,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      coreGroup.add(mesh);
      return mesh;
    });

    // Wireframe shells
    const shellSizes = [1.5, 2.2, 3.1, 4.2];
    const shells = shellSizes.map((r, i) => {
      const geo = new THREE.IcosahedronGeometry(r, i < 2 ? 1 : 0);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x00ffd5, wireframe: true, transparent: true,
        opacity: 0.14 - i * 0.025,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const m = new THREE.Mesh(geo, mat);
      coreGroup.add(m);
      return m;
    });

    // Equatorial rings
    const ringDefs = [
      { r: 3.0, tube: 0.035, color: 0x00ffd5, opacity: 0.55 },
      { r: 4.5, tube: 0.025, color: 0x0044ff, opacity: 0.35 },
      { r: 6.0, tube: 0.018, color: 0x00ffd5, opacity: 0.2  },
    ];
    const coreRings = ringDefs.map((d, i) => {
      const geo  = new THREE.TorusGeometry(d.r, d.tube, 4, 128);
      const mat  = new THREE.MeshBasicMaterial({ color: d.color, transparent: true, opacity: d.opacity, blending: THREE.AdditiveBlending, depthWrite: false });
      const ring = new THREE.Mesh(geo, mat);
      ring.rotation.x = Math.PI / 2 + (i % 2 ? 0.3 : 0);
      ring.rotation.z = i * 0.7;
      coreGroup.add(ring);
      return ring;
    });

    // Bright glow sphere around core (large, very transparent, additive)
    const glowGeo = new THREE.SphereGeometry(2.8, 32, 32);
    const glowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffd5, transparent: true, opacity: 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    coreGroup.add(new THREE.Mesh(glowGeo, glowMat));

    // ── 3D COMPUTER / SERVER in center ─────────────────────────────────────
    const compGroup = new THREE.Group();
    scene.add(compGroup);

    // Main server chassis
    const chassisMat = new THREE.MeshStandardMaterial({
      color: 0x001a22, emissive: new THREE.Color(0x001a22), emissiveIntensity: 0.3,
      metalness: 0.9, roughness: 0.3,
    });
    const chassis = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.8, 2.0), chassisMat);
    compGroup.add(chassis);

    // Screen / display face (front)
    const screenMat = new THREE.MeshBasicMaterial({
      color: 0x00ffd5, transparent: true, opacity: 0.25,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), screenMat);
    screen.position.set(0, 0.6, 1.02);
    compGroup.add(screen);

    // Screen glow
    const screenGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00ffd5, transparent: true, opacity: 0.06,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
    });
    const screenGlow = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.8), screenGlowMat);
    screenGlow.position.set(0, 0.6, 1.0);
    compGroup.add(screenGlow);

    // LED dots on front panel (status lights)
    const ledColors = [0x00ff9d, 0xff6b00, 0x00b4ff, 0xffb800];
    for (let l = 0; l < 4; l++) {
      const led = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 6, 6),
        new THREE.MeshBasicMaterial({ color: ledColors[l], blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      led.position.set(-0.9 + l * 0.5, -1.6, 1.02);
      compGroup.add(led);
    }

    // Drive bay slots (horizontal bars)
    for (let d = 0; d < 5; d++) {
      const bay = new THREE.Mesh(
        new THREE.BoxGeometry(2.2, 0.12, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x002233, transparent: true, opacity: 0.8 }),
      );
      bay.position.set(0, 0.8 - d * 0.35, 1.02);
      compGroup.add(bay);
    }

    // Side panels (ventilation lines)
    for (let v = 0; v < 6; v++) {
      const vent = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, 2.0, 0.02),
        new THREE.MeshBasicMaterial({ color: 0x001520, transparent: true, opacity: 0.6 }),
      );
      vent.position.set(1.62, 0, -0.4 + v * 0.18);
      compGroup.add(vent);
    }

    // Wireframe outline
    const chassisWire = new THREE.Mesh(
      new THREE.BoxGeometry(3.22, 4.82, 2.02),
      new THREE.MeshBasicMaterial({ color: 0x00ffd5, wireframe: true, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    compGroup.add(chassisWire);

    // Glow around computer
    const compGlow = new THREE.Mesh(
      new THREE.SphereGeometry(4.0, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0x00ffd5, transparent: true, opacity: 0.025, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide }),
    );
    compGroup.add(compGlow);

    // ── Agent clusters (Fibonacci sphere placement) ───────────────────────
    const ORBIT_R = 34;
    const N       = AGENTS.length;

    interface StreamParticle { mesh: THREE.Mesh; t: number; speed: number; curve: THREE.QuadraticBezierCurve3 }
    const streamParticles: StreamParticle[] = [];
    const agentHubMats: THREE.MeshStandardMaterial[] = [];
    const agentGlowMats: THREE.MeshBasicMaterial[]   = [];

    // World-space positions of each agent hub (for connection lines)
    const agentWorldPositions: THREE.Vector3[] = [];

    const agentGroups = AGENTS.map((agent, i) => {
      const [x, y, z] = fibSphere(i, N, ORBIT_R);
      agentWorldPositions.push(new THREE.Vector3(x, y, z));

      const group = new THREE.Group();
      group.position.set(x, y, z);
      group.userData = { i, baseX: x, baseY: y, baseZ: z };
      scene.add(group);

      // ── Hub sphere ──
      const hubMat = new THREE.MeshStandardMaterial({
        color:   new THREE.Color(agent.color),
        emissive: new THREE.Color(agent.color),
        emissiveIntensity: 1.8,
        metalness: 0.85, roughness: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95,
      });
      agentHubMats.push(hubMat);
      const hubGeo  = new THREE.SphereGeometry(agent.size, 32, 32);
      const hub     = new THREE.Mesh(hubGeo, hubMat);
      group.add(hub);

      // ── Outer glow sphere (additive, very transparent) ──
      const glowMat2 = new THREE.MeshBasicMaterial({
        color: agent.color, transparent: true, opacity: 0.08,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide,
      });
      agentGlowMats.push(glowMat2);
      const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(agent.size * 3.0, 16, 16), glowMat2);
      group.add(glowSphere);

      // ── Halo ring ──
      const haloGeo = new THREE.TorusGeometry(agent.size * 2.0, 0.04, 4, 80);
      const haloMat = new THREE.MeshBasicMaterial({
        color: agent.color, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const halo = new THREE.Mesh(haloGeo, haloMat);
      halo.rotation.x = Math.PI / 2;
      group.add(halo);

      // ── Secondary ring ──
      const ring2 = new THREE.Mesh(
        new THREE.TorusGeometry(agent.size * 3.0, 0.025, 4, 80),
        new THREE.MeshBasicMaterial({ color: agent.color, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      ring2.rotation.x = Math.PI / 3;
      ring2.rotation.y = Math.PI / 4;
      group.add(ring2);

      // ── Dense mini node cluster ──
      const nodeCount = Math.min(agent.nodes, 50);
      const nodePositions: THREE.Vector3[] = [];

      for (let n = 0; n < nodeCount; n++) {
        const [nx, ny, nz] = fibSphere(n, nodeCount, 5.5 + Math.random() * 11.0);
        const pos = new THREE.Vector3(nx, ny, nz);
        nodePositions.push(pos);

        const nSize = 0.04 + Math.random() * 0.055;
        const nGeo  = new THREE.SphereGeometry(nSize, 5, 5);
        const nMat  = new THREE.MeshBasicMaterial({
          color: agent.color, transparent: true, opacity: 0.7 + Math.random() * 0.3,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const node = new THREE.Mesh(nGeo, nMat);
        node.position.copy(pos);
        group.add(node);
      }

      // ── Node connections (short, dense network) ──
      const connPts: number[] = [];
      for (let a = 0; a < nodePositions.length; a++) {
        for (let b = a + 1; b < nodePositions.length; b++) {
          const dist = nodePositions[a].distanceTo(nodePositions[b]);
          if (dist < 10.0 && Math.random() > 0.45) {
            connPts.push(...nodePositions[a].toArray(), ...nodePositions[b].toArray());
          }
        }
      }
      if (connPts.length > 0) {
        const connGeo = new THREE.BufferGeometry();
        connGeo.setAttribute('position', new THREE.Float32BufferAttribute(connPts, 3));
        const connMat = new THREE.LineBasicMaterial({
          color: agent.color, transparent: true, opacity: 0.2,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        group.add(new THREE.LineSegments(connGeo, connMat));
      }

      // ── Bezier data stream particles → core ──
      const streamCount = 3 + Math.floor(agent.size * 2);
      for (let p = 0; p < streamCount; p++) {
        // Mid-point offset for curve
        const mid = new THREE.Vector3(
          x * 0.5 + (Math.random() - 0.5) * 8,
          y * 0.5 + (Math.random() - 0.5) * 8,
          z * 0.5 + (Math.random() - 0.5) * 8,
        );
        const curve = new THREE.QuadraticBezierCurve3(
          new THREE.Vector3(x, y, z),
          mid,
          new THREE.Vector3(0, 0, 0),
        );

        const pGeo  = new THREE.SphereGeometry(0.12 + Math.random() * 0.1, 5, 5);
        const pMat  = new THREE.MeshBasicMaterial({
          color: agent.color, transparent: true, opacity: 0.0,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        const particle = new THREE.Mesh(pGeo, pMat);
        scene.add(particle);
        streamParticles.push({ mesh: particle, t: Math.random(), speed: 0.003 + Math.random() * 0.004, curve });
      }

      return group;
    });

    // ── Cross-agent connection grid — all agents connected with visible lines ──
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const dist = agentWorldPositions[i].distanceTo(agentWorldPositions[j]);
        // Opacity based on distance: closer = more visible
        const opacity = Math.max(0.08, 0.38 - (dist / 80));
        const mid = agentWorldPositions[i].clone().add(agentWorldPositions[j]).multiplyScalar(0.5);
        mid.add(new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6));
        const curve = new THREE.QuadraticBezierCurve3(agentWorldPositions[i], mid, agentWorldPositions[j]);
        const pts   = curve.getPoints(24);
        const geo   = new THREE.BufferGeometry().setFromPoints(pts);
        // Alternate colors for visual richness
        const lineColor = j % 2 === 0 ? AGENTS[i].color : AGENTS[j].color;
        const mat   = new THREE.LineBasicMaterial({
          color: lineColor, transparent: true, opacity,
          blending: THREE.AdditiveBlending, depthWrite: false,
        });
        scene.add(new THREE.Line(geo, mat));
      }
    }

    // ── Core-to-agent "trunk" lines (thick, glowing) ──
    for (let i = 0; i < N; i++) {
      const pts = [new THREE.Vector3(0, 0, 0), agentWorldPositions[i]];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: AGENTS[i].color, transparent: true, opacity: 0.18,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      scene.add(new THREE.Line(geo, mat));
    }

    // ── Animation ─────────────────────────────────────────────────────────
    let t = 0;
    function animate() {
      animRef.current = requestAnimationFrame(animate);
      t += 0.006;

      // Scene rotation (drag)
      scene.rotation.y += (rotRef.current.y - scene.rotation.y) * 0.035;
      scene.rotation.x += (rotRef.current.x - scene.rotation.x) * 0.035;
      // Slow auto-rotate
      if (autoRotRef.current) rotRef.current.y += 0.0008;

      // Computer center
      compGroup.rotation.y += 0.004;
      const screenPulse = 0.18 + Math.sin(t * 2.5) * 0.07;
      (screen.material as THREE.MeshBasicMaterial).opacity = screenPulse;
      (screenGlow.material as THREE.MeshBasicMaterial).opacity = screenPulse * 0.25;

      // Core
      coreInner[0].rotation.y += 0.014;
      coreInner[0].rotation.x += 0.007;
      coreInner[1].rotation.y -= 0.010;
      coreInner[1].rotation.z += 0.005;
      const cp = 1 + Math.sin(t * 2.8) * 0.1;
      coreInner.forEach(m => m.scale.setScalar(cp));
      (coreInner[0].material as THREE.MeshStandardMaterial).emissiveIntensity = 3.5 + Math.sin(t * 3.5) * 0.8;

      shells[0].rotation.y += 0.008;
      shells[1].rotation.y -= 0.006; shells[1].rotation.z += 0.004;
      shells[2].rotation.x += 0.004; shells[2].rotation.z -= 0.007;
      shells[3].rotation.y += 0.003; shells[3].rotation.x += 0.002;

      coreRings[0].rotation.z += 0.015;
      coreRings[1].rotation.y += 0.011; coreRings[1].rotation.x += 0.005;
      coreRings[2].rotation.x += 0.008; coreRings[2].rotation.z -= 0.007;

      // Agent groups
      agentGroups.forEach((group, i) => {
        const agent      = AGENTS[i];
        const isActive   = activeRef.current.includes(agent.id);
        const isTraining = trainingRef.current.includes(agent.id);

        // Gentle float animation per agent (each offset)
        const floatX = Math.sin(t * 0.5 + i * 0.9) * 0.4;
        const floatY = Math.sin(t * 0.35 + i * 1.2) * 0.5;
        const floatZ = Math.cos(t * 0.42 + i * 0.7) * 0.35;
        const bd = group.userData;
        group.position.set(bd.baseX + floatX, bd.baseY + floatY, bd.baseZ + floatZ);

        // Scale / emissive — enhanced when training with live loss response
        let scale = 1.0;
        if (isTraining) {
          const m = metricsRef.current[agent.id];
          // lossNorm: 0 = low loss (converging, brighter), 1 = high loss
          const lossNorm = m && m.loss > 0 ? Math.max(0, Math.min(1, m.loss / 3.0)) : 0.5;
          const progress = m && m.max_steps > 0 ? m.step / m.max_steps : 0;
          const pulseFreq = 7 + (1 - lossNorm) * 5;  // faster when converging
          const pulseAmp  = 0.18 + (1 - lossNorm) * 0.12;
          scale = 1 + Math.sin(t * pulseFreq + i) * pulseAmp;
          // Brightness peaks as loss drops and training progresses
          agentHubMats[i].emissiveIntensity = 3.8 + Math.sin(t * (5 + (1-lossNorm)*4)) * 2.2
            + progress * 1.5;
          agentGlowMats[i].opacity = 0.15 + (1-lossNorm) * 0.12 + Math.sin(t * 4) * 0.06;
        } else if (isActive) {
          scale = 1 + Math.sin(t * 5 + i) * 0.08;
          agentHubMats[i].emissiveIntensity = 2.5 + Math.sin(t * 3) * 0.5;
          agentGlowMats[i].opacity          = 0.12;
        } else {
          agentHubMats[i].emissiveIntensity = 1.8;
          agentGlowMats[i].opacity          = 0.06;
        }
        group.scale.setScalar(scale);
        group.rotation.y += 0.005 + i * 0.0002;

        // Halos — spin faster when training
        const halo  = group.children[2] as THREE.Mesh;
        const ring2 = group.children[3] as THREE.Mesh;
        const m2 = metricsRef.current[agent.id];
        const lossNorm2 = m2 && m2.loss > 0 ? Math.max(0, Math.min(1, m2.loss / 3.0)) : 0.5;
        if (halo)  halo.rotation.z  += isTraining ? 0.04 + (1-lossNorm2)*0.04 : 0.02;
        if (ring2) ring2.rotation.y += isTraining ? 0.05 + (1-lossNorm2)*0.04 : 0.025;
      });

      // Stream particles
      streamParticles.forEach(p => {
        p.t += p.speed;
        if (p.t > 1) p.t -= 1;
        const pos = p.curve.getPoint(p.t);
        p.mesh.position.copy(pos);
        // Fade in + out
        const alpha = Math.sin(p.t * Math.PI);
        (p.mesh.material as THREE.MeshBasicMaterial).opacity = alpha * 0.9;
        p.mesh.scale.setScalar(0.5 + alpha * 0.8);
      });

      // Camera bob
      camera.position.y = 8 + Math.sin(t * 0.22) * 1.2;

      composer.render();
    }
    animate();

    // ── Events ─────────────────────────────────────────────────────────────
    const onDown = (e: MouseEvent) => {
      isDragging.current = true;
      lastMouse.current  = { x: e.clientX, y: e.clientY };
      el.style.cursor    = 'grabbing';
      autoRotRef.current = false;
    };
    const onUp = () => { isDragging.current = false; el.style.cursor = 'grab'; };
    const onMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      rotRef.current.y += (e.clientX - lastMouse.current.x) * 0.006;
      rotRef.current.x += (e.clientY - lastMouse.current.y) * 0.004;
      // Full vertical rotation — no clamp, user can orbit completely around
      lastMouse.current = { x: e.clientX, y: e.clientY };
    };
    const onWheel = (e: WheelEvent) => {
      camera.position.z = Math.max(10, Math.min(90, camera.position.z + e.deltaY * 0.022));
    };
    const onDblClick = () => { autoRotRef.current = !autoRotRef.current; };
    const onResize   = () => {
      const w = el.clientWidth, h = el.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };

    el.addEventListener('mousedown', onDown);
    el.addEventListener('dblclick',  onDblClick);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('mousemove', onMove);
    el.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(animRef.current);
      el.removeEventListener('mousedown', onDown);
      el.removeEventListener('dblclick',  onDblClick);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('mousemove', onMove);
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      composer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, []);

  // ── Computed totals (alle echte data) ────────────────────────────────────
  const totalBaseParams    = AGENTS.reduce((s, a) => s + (a.baseParams ?? 0), 0);
  const totalAdapterParams = AGENTS.reduce((s, a) => s + (a.adapterParams ?? 0), 0);
  const totalAllParams     = totalBaseParams + totalAdapterParams;
  const totalCmds          = Object.values(stats).reduce((s, v) => s + v.commands, 0);
  const totalFeedback      = Object.values(stats).reduce((s, v) => s + v.feedback, 0);
  const totalTrained       = Object.values(stats).reduce((s, v) => s + v.trained,  0);
  const totalTrainRuns     = Object.values(stats).reduce((s, v) => s + (v.trainRuns ?? 0), 0);
  const totalCollected     = Object.values(stats).reduce((s, v) => s + (v.collectedPairs ?? 0), 0);
  const modelsLoaded       = stream?.ollamaModels?.length ?? 0;

  return (
    <div className="relative w-full h-full" style={{ background: '#00020a', overflow: 'hidden' }}>

      {/* ── CSS keyframe animations for training agent rows ───────────────── */}
      <style>{`
        ${AGENT_DEFS.map(a => `
          @keyframes train-row-${a.id} {
            0%, 100% {
              box-shadow: 0 0 10px ${a.hex}55, 0 0 22px ${a.hex}22, inset 0 0 14px ${a.hex}12;
              border-color: ${a.hex}99;
              background: ${a.hex}1e;
            }
            50% {
              box-shadow: 0 0 36px ${a.hex}ee, 0 0 72px ${a.hex}aa, 0 0 110px ${a.hex}44, inset 0 0 32px ${a.hex}30;
              border-color: ${a.hex};
              background: ${a.hex}38;
            }
          }
          @keyframes train-grow-${a.id} {
            0%, 100% { transform: scaleX(1.0) scaleY(1.0); }
            50%       { transform: scaleX(1.04) scaleY(1.1); }
          }
          @keyframes train-name-${a.id} {
            0%, 100% {
              text-shadow: 0 0 8px ${a.hex}aa, 0 0 16px ${a.hex}55;
              color: ${a.hex};
            }
            50% {
              text-shadow: 0 0 22px ${a.hex}, 0 0 44px ${a.hex}dd, 0 0 70px ${a.hex}66;
              color: #ffffff;
            }
          }
          @keyframes train-dot-${a.id} {
            0%, 100% {
              box-shadow: 0 0 6px ${a.hex};
              transform: scale(1.0);
            }
            50% {
              box-shadow: 0 0 18px ${a.hex}, 0 0 36px ${a.hex}99, 0 0 52px ${a.hex}44;
              transform: scale(1.7);
            }
          }
          @keyframes train-badge-${a.id} {
            0%, 100% { opacity: 0.7; letter-spacing: 0.05em; }
            50%       { opacity: 1.0; letter-spacing: 0.18em; text-shadow: 0 0 12px ${a.hex}; }
          }
        `).join('')}
      `}</style>

      {/* 3D canvas */}
      <div ref={mountRef} className="w-full h-full" style={{ cursor: 'grab' }} />

      {/* Subtle scanline overlay */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,255,213,0.005) 3px, rgba(0,255,213,0.005) 4px)',
        zIndex: 1,
      }} />

      {/* ── Left HUD ──────────────────────────────────────────────────────── */}
      <div className="absolute top-4 left-4" style={{ zIndex: 2 }}>
        <div className="mb-4 pointer-events-none">
          <div className="font-mono font-bold tracking-[0.35em]" style={{ color: '#00ffd5', fontSize: '13px', textShadow: '0 0 20px #00ffd5, 0 0 40px #00ffd544' }}>
            NEURAL TOPOLOGY
          </div>
          <div className="font-mono tracking-widest" style={{ fontSize: '9px', color: 'rgba(0,255,213,0.4)' }}>
            PROJECT NEXUS · {AGENTS.length} AGENTS · {totalAllParams > 0 ? `${totalAllParams.toFixed(2)}B` : '...'} TOTAL PARAMS
          </div>
        </div>

        <div className="flex flex-col gap-1">
          {AGENTS.map(agent => {
            const isActive   = activeAgents.includes(agent.id);
            const isTraining = trainingAgents.includes(agent.id);
            const s          = stats[agent.id];
            const isSelected = selectedAgent === agent.id;
            const hasMetrics = !!trainingMetrics[agent.id];
            const clickable  = isTraining || hasMetrics;
            const m          = trainingMetrics[agent.id];
            const trainPct   = m && m.max_steps > 0 ? m.step / m.max_steps : 0;

            return (
              <div key={agent.id} style={{ position: 'relative', transformOrigin: 'left center', zIndex: isTraining ? 4 : 'auto' as any }}>
                {/* Row wrapper with animation */}
                <div
                  className="flex items-center gap-2 px-2.5"
                  style={{
                    paddingTop:    isTraining ? '8px' : '6px',
                    paddingBottom: isTraining ? '8px' : '6px',
                    backdropFilter: 'blur(8px)',
                    minWidth: isTraining ? '240px' : '215px',
                    transition: 'min-width 0.4s ease, padding 0.3s ease',
                    cursor: clickable ? 'pointer' : 'default',
                    pointerEvents: 'auto',
                    // When NOT training: static styling
                    ...(isTraining ? {} : {
                      background: isActive ? `${agent.hex}12` : 'rgba(0,2,10,0.5)',
                      border: `1px solid ${isActive ? agent.hex + '44' : 'rgba(255,255,255,0.05)'}`,
                      boxShadow: isActive ? `0 0 6px ${agent.hex}22` : 'none',
                    }),
                    // When training: animated via keyframes
                    animation: isTraining
                      ? `train-row-${agent.id} 1.2s ease-in-out infinite, train-grow-${agent.id} 1.2s ease-in-out infinite`
                      : 'none',
                  }}
                  onMouseEnter={() => setHovered(agent.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => handleAgentClick(agent.id, isTraining)}
                >
                  {/* Status dot */}
                  <div
                    className="rounded-full shrink-0"
                    style={{
                      width:      isTraining ? '10px' : '8px',
                      height:     isTraining ? '10px' : '8px',
                      background: isTraining || isActive ? agent.hex : `${agent.hex}55`,
                      transition: 'all 0.3s ease',
                      animation:  isTraining
                        ? `train-dot-${agent.id} 1.2s ease-in-out infinite`
                        : isActive ? 'pulse 1.1s infinite' : 'none',
                    }}
                  />

                  {/* Agent name */}
                  <span
                    className="font-mono font-bold"
                    style={{
                      fontSize:   isTraining ? '11px' : '10px',
                      width:      isTraining ? '68px' : '62px',
                      transition: 'all 0.3s ease',
                      animation:  isTraining
                        ? `train-name-${agent.id} 1.2s ease-in-out infinite`
                        : 'none',
                      color:      isTraining ? agent.hex : isActive ? agent.hex : `${agent.hex}77`,
                      textShadow: isTraining ? undefined : isActive ? `0 0 7px ${agent.hex}` : 'none',
                    }}
                  >
                    {agent.name}
                  </span>

                  <span className="font-mono text-slate-600" style={{ fontSize: '8px', width: isTraining ? '0px' : '84px', overflow: 'hidden', transition: 'width 0.3s ease', whiteSpace: 'nowrap' }}>
                    {isTraining ? '' : agent.role}
                  </span>

                  {/* Params */}
                  {agent.totalParams !== null && agent.adapterParams !== null ? (
                    <span className="font-mono font-bold" style={{ color: agent.hex, fontSize: '9px', minWidth: '60px' }}>
                      {agent.totalParams.toFixed(2)}B
                    </span>
                  ) : (
                    <span className="font-mono font-bold" style={{ color: agent.paramSize === '...' ? 'rgba(255,255,255,0.2)' : `${agent.hex}cc`, fontSize: '9px', minWidth: '42px' }}>
                      {agent.paramSize === '...' ? '...' : agent.paramSize}
                    </span>
                  )}

                  {/* Stats badges */}
                  {(s?.trainRuns ?? 0) > 0 && !isTraining && (
                    <span className="font-mono px-1" style={{ color: '#ff6b00', fontSize: '8px', border: '1px solid #ff6b0044', background: 'rgba(255,107,0,0.08)' }}>
                      ▶ {s!.trainRuns}×
                    </span>
                  )}
                  {(s?.collectedPairs ?? 0) > 0 && !isTraining && (
                    <span className="font-mono px-1" style={{ color: '#00b4ff', fontSize: '8px', border: '1px solid #00b4ff33', background: 'rgba(0,180,255,0.06)' }}>
                      {s!.collectedPairs}p
                    </span>
                  )}

                  {/* QLoRA badge when training */}
                  {isTraining && (
                    <span
                      className="font-mono font-bold"
                      style={{
                        color: agent.hex, fontSize: '9px',
                        border: `1px solid ${agent.hex}66`,
                        background: `${agent.hex}18`,
                        padding: '1px 6px',
                        animation: `train-badge-${agent.id} 1.2s ease-in-out infinite`,
                      }}
                    >
                      ▶ QLoRA
                    </span>
                  )}

                  {/* Arrow hint */}
                  {isTraining && (
                    <span className="font-mono" style={{ color: `${agent.hex}88`, fontSize: '9px', marginLeft: 'auto' }}>
                      {isSelected ? '▼' : '▲'}
                    </span>
                  )}

                  {nodeFlashes[agent.id] && (
                    <span key={nodeFlashes[agent.id].key} className="flash-badge font-mono font-bold" style={{ color: '#00ff9d', fontSize: '8px', textShadow: '0 0 8px #00ff9d' }}>
                      +{nodeFlashes[agent.id].value}
                    </span>
                  )}
                </div>

                {/* Live training progress bar under the row (only when training) */}
                {isTraining && (
                  <div style={{ height: '2px', background: `${agent.hex}22`, overflow: 'hidden', marginTop: '1px' }}>
                    <div style={{
                      height: '100%',
                      width: `${Math.round(trainPct * 100)}%`,
                      background: `linear-gradient(90deg, ${agent.hex}88, ${agent.hex})`,
                      boxShadow: `0 0 8px ${agent.hex}`,
                      transition: 'width 2s ease',
                    }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right HUD: global stats ────────────────────────────────────────── */}
      <div className="absolute top-4 right-4 pointer-events-none" style={{ zIndex: 2 }}>
        {/* LIVE badge */}
        <div className="flex items-center justify-end gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#00ff9d', boxShadow: '0 0 8px #00ff9d, 0 0 16px #00ff9d44' }} />
          <span className="font-mono font-bold animate-pulse" style={{ fontSize: '9px', color: '#00ff9d', letterSpacing: '0.25em', textShadow: '0 0 10px #00ff9d' }}>
            ● LIVE
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          {[
            { label: 'TOTAL PARAMS',  value: totalAllParams > 0  ? `${totalAllParams.toFixed(2)}B`  : '...', color: '#ffb800' },
            { label: '  BASE',        value: totalBaseParams > 0  ? `${totalBaseParams.toFixed(1)}B`  : '...', color: 'rgba(251,191,36,0.5)' },
            { label: '  LORA',        value: totalAdapterParams > 0 ? `+${totalAdapterParams.toFixed(3)}B` : '+0B', color: '#ff6b00' },
            { label: 'MODELS LOADED', value: `${modelsLoaded}/${AGENTS.length}`,  color: '#00ff9d' },
            { label: 'COMMANDS',      value: totalCmds.toString(),                color: '#00ffd5' },
            { label: 'TRAIN RUNS',    value: `${totalTrainRuns}×`,                color: '#ff6b00' },
            { label: 'TRAIN PAIRS',   value: totalCollected.toString(),           color: '#00b4ff' },
            { label: 'FEEDBACK',      value: totalFeedback.toString(),            color: '#b400ff' },
            { label: 'IN DATASET',    value: totalTrained.toString(),             color: '#a78bfa' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-4 px-3 py-2"
              style={{ background: 'rgba(0,2,10,0.65)', border: '1px solid rgba(255,255,255,0.05)', backdropFilter: 'blur(8px)' }}>
              <div className="font-mono" style={{ color: 'rgba(255,255,255,0.2)', fontSize: '8px', letterSpacing: '0.15em', minWidth: '90px' }}>{s.label}</div>
              <div className="font-mono font-bold text-right" style={{ color: s.color, fontSize: '16px', textShadow: `0 0 16px ${s.color}, 0 0 32px ${s.color}44`, minWidth: '40px' }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Hover tooltip ─────────────────────────────────────────────────── */}
      {hovered && !selectedAgent && (() => {
        const agent      = AGENTS.find(a => a.id === hovered);
        const s          = stats[hovered];
        const isTraining = trainingAgents.includes(hovered);
        const m          = trainingMetrics[hovered];
        if (!agent) return null;
        return (
          <div className="absolute bottom-14 left-4 px-4 py-3 pointer-events-none" style={{
            zIndex: 2,
            background:    'rgba(0,2,10,0.85)',
            border:        `1px solid ${agent.hex}44`,
            backdropFilter: 'blur(14px)',
            boxShadow:     `0 0 40px ${agent.hex}18, inset 0 0 20px ${agent.hex}08`,
            minWidth:      '200px',
          }}>
            <div className="flex items-center gap-2 mb-1">
              <div className="font-mono font-bold" style={{ color: agent.hex, fontSize: '15px', textShadow: `0 0 16px ${agent.hex}` }}>{agent.name}</div>
              {isTraining && <span className="font-mono font-bold" style={{ fontSize: '8px', color: agent.hex, border: `1px solid ${agent.hex}55`, padding: '1px 6px', animation: 'pulse 0.8s infinite' }}>QLoRA TRAINING</span>}
            </div>
            {/* Quick live metrics in tooltip */}
            {m && (
              <div className="flex flex-col gap-1 mb-2 px-2 py-1.5" style={{ background: `${agent.hex}0a`, border: `1px solid ${agent.hex}22` }}>
                <div className="flex items-center justify-between font-mono" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>Stap</span>
                  <span style={{ color: agent.hex }}>{m.step} / {m.max_steps}</span>
                </div>
                <div className="flex items-center justify-between font-mono" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.3)' }}>Loss</span>
                  <span style={{ color: lossColor(m.loss), fontWeight: 700 }}>{m.loss.toFixed(4)}</span>
                </div>
                <div style={{ height: '3px', background: 'rgba(255,255,255,0.05)', marginTop: '2px' }}>
                  <div style={{ height: '100%', width: `${Math.round((m.step/m.max_steps)*100)}%`, background: agent.hex, transition: 'width 1s' }} />
                </div>
                <div className="font-mono text-center mt-0.5" style={{ fontSize: '8px', color: `${agent.hex}77` }}>klik voor details</div>
              </div>
            )}
            <div className="font-mono mb-3" style={{ color: 'rgba(255,255,255,0.3)', fontSize: '10px' }}>{agent.role}</div>

            {/* PARAMS BREAKDOWN */}
            <div className="font-mono mb-1" style={{ fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.2)' }}>── PARAMETERS</div>
            <div className="flex flex-col gap-1 mb-3 px-2 py-2" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${agent.hex}22`, borderRadius: '4px' }}>
              <div className="flex justify-between font-mono" style={{ fontSize: '10px' }}>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>Base model</span>
                <span style={{ color: agent.hex, fontWeight: 700 }}>{agent.paramSize}</span>
              </div>
              <div className="flex justify-between font-mono" style={{ fontSize: '10px' }}>
                <span style={{ color: 'rgba(255,255,255,0.3)' }}>LoRA adapters</span>
                <span style={{ color: agent.adapterParams ? '#ff6b00' : 'rgba(255,255,255,0.18)', fontWeight: 700 }}>
                  {agent.adapterParams ? `+${agent.adapterParams.toFixed(3)}B` : '+0B (geen training)'}
                </span>
              </div>
              <div style={{ height: '1px', background: `${agent.hex}22`, margin: '2px 0' }} />
              <div className="flex justify-between font-mono" style={{ fontSize: '11px' }}>
                <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>Totaal</span>
                <span style={{ color: agent.hex, fontWeight: 700, textShadow: `0 0 8px ${agent.hex}` }}>
                  {agent.totalParams !== null ? `${agent.totalParams.toFixed(3)}B` : agent.paramSize}
                </span>
              </div>
            </div>

            {/* BASE MODEL INFO */}
            <div className="font-mono mb-1" style={{ fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.2)' }}>── MODEL INFO</div>
            <div className="grid gap-1 mb-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                { k: 'FAMILY',   v: agent.family,       highlight: false },
                { k: 'QUANTIZE', v: agent.quantization, highlight: false },
                { k: 'COMMANDS', v: s?.commands ?? 0,   highlight: false },
              ].map(r => (
                <div key={r.k} className="font-mono" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.25)' }}>{r.k} </span>
                  <span style={{ color: `${agent.hex}bb`, fontWeight: 500 }}>{r.v}</span>
                </div>
              ))}
            </div>

            {/* TRAINING DATA — echte stats uit DB */}
            <div className="font-mono mb-1" style={{ fontSize: '8px', letterSpacing: '0.15em', color: 'rgba(255,255,255,0.2)' }}>── TRAINING DATA</div>
            <div className="grid gap-1" style={{ gridTemplateColumns: '1fr 1fr' }}>
              {[
                { k: 'TRAIN RUNS',    v: s?.trainRuns      ?? 0, color: '#ff6b00' },
                { k: 'COLLECT RUNS',  v: s?.collectRuns    ?? 0, color: '#00b4ff' },
                { k: 'DATA PAIRS',    v: s?.collectedPairs ?? 0, color: '#00b4ff' },
                { k: 'IN DATASET',    v: s?.trained        ?? 0, color: '#a78bfa' },
                { k: 'FEEDBACK ✓',    v: s?.feedback       ?? 0, color: '#00ff9d' },
              ].map(r => (
                <div key={r.k} className="font-mono" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.25)' }}>{r.k} </span>
                  <span style={{ color: (r.v as number) > 0 ? r.color : 'rgba(255,255,255,0.18)', fontWeight: (r.v as number) > 0 ? 700 : 400 }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Live Training Monitor panel (click on training agent to open) ── */}
      {selectedAgent && (() => {
        const agent      = AGENTS.find(a => a.id === selectedAgent);
        const m          = trainingMetrics[selectedAgent];
        const isTrain    = trainingAgents.includes(selectedAgent);
        if (!agent) return null;

        const progress   = m && m.max_steps > 0 ? m.step / m.max_steps : 0;
        const lc         = m ? lossColor(m.loss) : '#555';
        const modelKey   = AGENT_BASE_MODEL[agent.id] ?? 'phi3.5';
        const adapterMax = LORA_ADAPTER_B[modelKey] ?? 0;
        const adapterNow = adapterMax * progress;
        const baseB      = agent.baseParams ?? 0;
        const totalNow   = baseB + adapterNow;
        const lossNorm   = m && m.loss > 0 ? Math.min(1, m.loss / 3.0) : 0.5;
        const barW       = Math.round(progress * 100);
        const lossBarW   = m ? Math.round(Math.min(1, m.loss / 4.0) * 100) : 0;

        return (
          <div
            className="absolute pointer-events-auto"
            style={{
              bottom: '52px',
              left:   '50%',
              transform: 'translateX(-50%)',
              zIndex: 10,
              minWidth: '420px',
              background: 'rgba(0,2,12,0.92)',
              border:     `1px solid ${agent.hex}55`,
              backdropFilter: 'blur(20px)',
              boxShadow:  `0 0 48px ${agent.hex}22, inset 0 0 32px ${agent.hex}08`,
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ borderBottom: `1px solid ${agent.hex}22` }}
            >
              <div className="flex items-center gap-3">
                <div className="w-2.5 h-2.5 rounded-full" style={{
                  background: agent.hex,
                  boxShadow: `0 0 10px ${agent.hex}, 0 0 20px ${agent.hex}66`,
                  animation: isTrain ? 'pulse 0.6s infinite' : 'none',
                }} />
                <span className="font-mono font-bold" style={{ color: agent.hex, fontSize: '13px', textShadow: `0 0 12px ${agent.hex}` }}>
                  {agent.name}
                </span>
                <span className="font-mono px-2 py-0.5" style={{ color: agent.hex, fontSize: '8px', border: `1px solid ${agent.hex}44`, background: `${agent.hex}10`, letterSpacing: '0.15em' }}>
                  {isTrain ? 'QLoRA TRAINING' : 'TRAINING KLAAR'}
                </span>
              </div>
              <button
                onClick={() => setSelectedAgent(null)}
                className="font-mono"
                style={{ color: 'rgba(255,255,255,0.3)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '14px' }}
              >✕</button>
            </div>

            {/* Metrics body */}
            <div className="px-4 py-3 flex flex-col gap-3">

              {/* Progress */}
              <div>
                <div className="flex items-center justify-between font-mono mb-1.5" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>STAP</span>
                  <span style={{ color: agent.hex, fontWeight: 700 }}>
                    {m ? `${m.step.toLocaleString()} / ${m.max_steps.toLocaleString()}` : '—'}
                  </span>
                </div>
                <div style={{ height: '6px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${barW}%`,
                    background: `linear-gradient(90deg, ${agent.hex}88, ${agent.hex})`,
                    boxShadow:  `0 0 8px ${agent.hex}`,
                    borderRadius: '3px',
                    transition:  'width 1.5s ease',
                  }} />
                </div>
                <div className="font-mono mt-1" style={{ fontSize: '9px', color: `${agent.hex}88` }}>
                  {barW}% voltooid{m ? ` · Epoch ${m.epoch}` : ''}
                  {m ? ` · ${fmtElapsed(m.elapsed)}` : ''}
                </div>
              </div>

              {/* Loss */}
              <div>
                <div className="flex items-center justify-between font-mono mb-1.5" style={{ fontSize: '9px' }}>
                  <span style={{ color: 'rgba(255,255,255,0.35)', letterSpacing: '0.15em' }}>LOSS</span>
                  <span style={{ color: lc, fontWeight: 700, fontSize: '14px', textShadow: `0 0 10px ${lc}` }}>
                    {m && m.loss > 0 ? m.loss.toFixed(4) : '—'}
                  </span>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${lossBarW}%`,
                    background: `linear-gradient(90deg, #00ff9d, ${lc})`,
                    transition:  'width 1s ease, background 1s ease',
                    borderRadius: '3px',
                  }} />
                </div>
                <div className="font-mono mt-1" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.2)' }}>
                  {!m || m.loss <= 0 ? '—' : m.loss < 1.2 ? '✓ Convergeert goed' : m.loss < 2.0 ? '⚡ Training gaande' : '⚠ Loss nog hoog'}
                </div>
              </div>

              {/* Live params counter */}
              <div style={{ padding: '10px 12px', background: 'rgba(0,0,0,0.4)', border: `1px solid ${agent.hex}22` }}>
                <div className="font-mono mb-2" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.2em' }}>
                  ── LIVE PARAMETERS
                </div>
                <div className="flex flex-col gap-1">
                  <div className="flex justify-between font-mono" style={{ fontSize: '10px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>Base model</span>
                    <span style={{ color: 'rgba(255,255,255,0.5)', fontWeight: 600 }}>{baseB > 0 ? `${baseB.toFixed(3)}B` : agent.paramSize}</span>
                  </div>
                  <div className="flex justify-between font-mono" style={{ fontSize: '10px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.3)' }}>LoRA adapters</span>
                    <span style={{ color: '#ff6b00', fontWeight: 700, transition: 'all 0.8s ease' }}>
                      +{adapterNow.toFixed(5)}B
                      {isTrain && <span style={{ color: '#ff6b00aa', fontSize: '8px', marginLeft: '4px', animation: 'pulse 1s infinite' }}>↑ groeiend</span>}
                    </span>
                  </div>
                  <div style={{ height: '1px', background: `${agent.hex}22`, margin: '4px 0' }} />
                  <div className="flex justify-between font-mono" style={{ fontSize: '12px' }}>
                    <span style={{ color: 'rgba(255,255,255,0.6)', fontWeight: 600 }}>Totaal</span>
                    <span style={{ color: agent.hex, fontWeight: 700, textShadow: `0 0 10px ${agent.hex}`, transition: 'all 0.8s ease' }}>
                      {totalNow > 0 ? `${totalNow.toFixed(5)}B` : agent.paramSize}
                    </span>
                  </div>
                </div>
              </div>

              {/* Training efficiency bar */}
              {m && m.loss > 0 && (
                <div className="flex items-center gap-3 font-mono" style={{ fontSize: '8px', color: 'rgba(255,255,255,0.25)' }}>
                  <span>EFFICIËNTIE</span>
                  <div style={{ flex: 1, height: '2px', background: 'rgba(255,255,255,0.05)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${Math.round((1-lossNorm)*100)}%`, background: lc, transition: 'width 1s ease' }} />
                  </div>
                  <span style={{ color: lc, fontWeight: 700 }}>{Math.round((1-lossNorm)*100)}%</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── Bottom bar ────────────────────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-5 py-2 pointer-events-none"
        style={{ zIndex: 2, background: 'rgba(0,2,10,0.7)', borderTop: '1px solid rgba(0,255,213,0.07)', backdropFilter: 'blur(8px)' }}>
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#00ff9d', boxShadow: '0 0 10px #00ff9d, 0 0 20px #00ff9d44' }} />
          <span className="font-mono" style={{ fontSize: '9px', color: 'rgba(255,255,255,0.25)', letterSpacing: '0.2em' }}>
            NEXUS CORE · DRAG TO ROTATE · SCROLL TO ZOOM · DBLCLICK AUTO-ROTATE
          </span>
        </div>
        <div className="flex items-center gap-5">
          {AGENTS.slice(0, 8).map(a => (
            <div key={a.id} className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: a.hex, boxShadow: `0 0 6px ${a.hex}` }} />
              <span className="font-mono" style={{ color: `${a.hex}55`, fontSize: '8px' }}>{a.name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}