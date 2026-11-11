import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Search,
  Filter,
  Sparkles,
  BookOpen,
  Tag,
  Trash2,
  MessageSquare,
  ArrowRight,
  RefreshCw,
  Info,
  X,
  Compass,
} from 'lucide-react';
import { GraphNode, GraphEdge, KnowledgeGraphData } from '../types/index.ts';
import { renderFormattedMarkdown } from '../utils/markdown.tsx';

interface KnowledgeGraphViewProps {
  onInsertToChat?: (text: string) => void;
  onOpenAddModal?: () => void;
  onDocDeleted?: () => void;
  className?: string;
}

const CATEGORY_COLORS: Record<string, { fill: string; stroke: string; glow: string; text: string }> = {
  personal_note: { fill: '#3b82f6', stroke: '#60a5fa', glow: 'rgba(59, 130, 246, 0.4)', text: 'Personal Note' },
  decision_framework: { fill: '#f59e0b', stroke: '#fbbf24', glow: 'rgba(245, 158, 11, 0.4)', text: 'Decision Framework' },
  project_brief: { fill: '#10b981', stroke: '#34d399', glow: 'rgba(16, 185, 129, 0.4)', text: 'Project Brief' },
  philosophy: { fill: '#8b5cf6', stroke: '#a78bfa', glow: 'rgba(139, 92, 246, 0.4)', text: 'Philosophy' },
  reference: { fill: '#64748b', stroke: '#94a3b8', glow: 'rgba(100, 116, 139, 0.4)', text: 'Reference' },
};

function getNodeColor(category: string) {
  const norm = category.toLowerCase().replace(/\s+/g, '_');
  return CATEGORY_COLORS[norm] || {
    fill: '#06b6d4',
    stroke: '#22d3ee',
    glow: 'rgba(6, 182, 212, 0.4)',
    text: category,
  };
}

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({
  onInsertToChat,
  onOpenAddModal,
  className = '',
}) => {
  const [data, setData] = useState<KnowledgeGraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Selected Node
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Canvas Refs & Transform State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingCanvasRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedNodeRef = useRef<GraphNode | null>(null);

  // Nodes & Edges runtime physics state
  const runtimeNodesRef = useRef<Array<GraphNode & { x: number; y: number; vx: number; vy: number; radius: number }>>([]);
  const runtimeEdgesRef = useRef<GraphEdge[]>([]);

  // Load Graph Data
  const loadGraph = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/knowledge/graph');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json.success || !json.graph) throw new Error(json.error || 'Failed to load graph data');
      setData(json.graph);

      // Initialize positions in a circle/spiral with generous minimum bounds
      const width = Math.max(700, containerRef.current?.clientWidth || 800);
      const height = Math.max(450, containerRef.current?.clientHeight || 500);
      const nodes = json.graph.nodes || [];

      runtimeNodesRef.current = nodes.map((node: GraphNode, index: number) => {
        const angle = (index / Math.max(1, nodes.length)) * 2 * Math.PI;
        const radius = 100 + (index % 3) * 50;
        return {
          ...node,
          x: width / 2 + Math.cos(angle) * radius + (Math.random() - 0.5) * 30,
          y: height / 2 + Math.sin(angle) * radius + (Math.random() - 0.5) * 30,
          vx: 0,
          vy: 0,
          radius: Math.max(14, Math.min(24, 14 + (node.tags?.length || 0) * 2)),
        };
      });

      runtimeEdgesRef.current = json.graph.edges || [];
      setPan({ x: 0, y: 0 });
      setZoom(1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to connect to graph service');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph]);

  // Handle Delete Node
  const handleDeleteNode = async (node: GraphNode) => {
    if (!confirm(`Are you sure you want to prune "${node.title}" from your memory vault?`)) {
      return;
    }
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/knowledge/${node.dbId}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Delete failed');

      setSelectedNode(null);
      await loadGraph();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not delete memory');
    } finally {
      setIsDeleting(false);
    }
  };

  // Connected neighbors for selected node
  const neighborNodes = useMemo(() => {
    if (!selectedNode || !data) return [];
    const connectedNodeIds = new Set<string>();
    for (const edge of runtimeEdgesRef.current) {
      if (edge.source === selectedNode.id) connectedNodeIds.add(edge.target);
      if (edge.target === selectedNode.id) connectedNodeIds.add(edge.source);
    }
    return (data.nodes || []).filter((n) => connectedNodeIds.has(n.id));
  }, [selectedNode, data]);

  // Main Force Simulation & Render Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isRunning = true;

    const animate = () => {
      if (!isRunning) return;

      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);

      const nodes = runtimeNodesRef.current;
      const edges = runtimeEdgesRef.current;

      // 1. Force Simulation Physics Step
      const kRepulsion = 1200;
      const kSpring = 0.04;
      const kCenter = 0.015;
      const damping = 0.86;

      // Center gravity
      const centerX = width / 2;
      const centerY = height / 2;
      for (const node of nodes) {
        if (node === draggedNodeRef.current) continue;
        node.vx += (centerX - node.x) * kCenter;
        node.vy += (centerY - node.y) * kCenter;
      }

      // Repulsion between nodes
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const minDist = a.radius + b.radius + 30;

          if (dist < 350) {
            const force = (kRepulsion / (dist * dist)) * (dist < minDist ? 2.5 : 1);
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;

            if (a !== draggedNodeRef.current) {
              a.vx -= fx;
              a.vy -= fy;
            }
            if (b !== draggedNodeRef.current) {
              b.vx += fx;
              b.vy += fy;
            }
          }
        }
      }

      // Edge spring attraction
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (source && target) {
          const dx = target.x - source.x;
          const dy = target.y - source.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const targetDist = edge.type === 'shared_tag' ? 90 : 150;
          const displacement = dist - targetDist;
          const force = displacement * kSpring * edge.weight;

          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;

          if (source !== draggedNodeRef.current) {
            source.vx += fx;
            source.vy += fy;
          }
          if (target !== draggedNodeRef.current) {
            target.vx -= fx;
            target.vy -= fy;
          }
        }
      }

      // Update positions with damping and boundary clamping
      for (const node of nodes) {
        if (node === draggedNodeRef.current) continue;
        node.vx *= damping;
        node.vy *= damping;
        node.x += node.vx;
        node.y += node.vy;

        // Keep nodes cleanly inside canvas viewport bounds
        const pad = node.radius + 30;
        node.x = Math.max(pad, Math.min(width - pad, node.x));
        node.y = Math.max(pad + 15, Math.min(height - pad, node.y));
      }

      // 2. Render Frame
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // Apply Pan & Zoom Transform
      ctx.translate(pan.x, pan.y);
      ctx.translate(width / 2, height / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-width / 2, -height / 2);

      // Draw Subtle Background Grid
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
      ctx.lineWidth = 1;
      const gridSize = 40;
      for (let x = -width; x < width * 2; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, -height);
        ctx.lineTo(x, height * 2);
        ctx.stroke();
      }
      for (let y = -height; y < height * 2; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(-width, y);
        ctx.lineTo(width * 2, y);
        ctx.stroke();
      }

      // Draw Edges
      for (const edge of edges) {
        const source = nodeMap.get(edge.source);
        const target = nodeMap.get(edge.target);
        if (!source || !target) continue;

        const isConnectedToFocus =
          (selectedNode && (source.id === selectedNode.id || target.id === selectedNode.id)) ||
          (hoveredNode && (source.id === hoveredNode.id || target.id === hoveredNode.id));

        ctx.beginPath();
        ctx.moveTo(source.x, source.y);
        ctx.lineTo(target.x, target.y);

        if (isConnectedToFocus) {
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 2.5;
        } else if (edge.type === 'shared_tag') {
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.35)';
          ctx.lineWidth = 1.6;
        } else {
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
          ctx.lineWidth = 1;
        }
        ctx.stroke();
      }

      // Draw Nodes
      for (const node of nodes) {
        const colors = getNodeColor(node.category);
        const isSelected = selectedNode?.id === node.id;
        const isHovered = hoveredNode?.id === node.id;
        const matchesSearch =
          searchQuery.trim() === '' ||
          node.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          node.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

        const matchesCategory =
          selectedCategory === 'all' ||
          node.category.toLowerCase() === selectedCategory.toLowerCase();

        const opacity = matchesCategory && matchesSearch ? 1.0 : 0.2;

        ctx.save();
        ctx.globalAlpha = opacity;

        // Outer Glow for Selected/Hovered
        if (isSelected || isHovered) {
          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 8, 0, Math.PI * 2);
          ctx.fillStyle = colors.glow;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Node Circle Body
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = colors.fill;
        ctx.fill();
        ctx.strokeStyle = isSelected ? '#ffffff' : colors.stroke;
        ctx.lineWidth = isSelected ? 3 : 1.5;
        ctx.stroke();

        // Node Center Dot
        ctx.beginPath();
        ctx.arc(node.x, node.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        // Node Label
        ctx.font = isSelected ? 'bold 11px system-ui, sans-serif' : '10px system-ui, sans-serif';
        ctx.fillStyle = isSelected ? '#f8fafc' : '#94a3b8';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';

        const label = node.title.length > 18 ? node.title.slice(0, 16) + '...' : node.title;
        ctx.fillText(label, node.x, node.y + node.radius + 5);

        ctx.restore();
      }

      ctx.restore();
      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      isRunning = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [pan, zoom, selectedNode, hoveredNode, selectedCategory, searchQuery]);

  // Handle Canvas Resize
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (canvas && container) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = container.clientWidth * dpr;
        canvas.height = container.clientHeight * dpr;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Mouse Interaction: Find node under cursor
  const getNodeAtPoint = (clientX: number, clientY: number): GraphNode | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    // Inverse transform
    const transX = (mouseX - pan.x - width / 2) / zoom + width / 2;
    const transY = (mouseY - pan.y - height / 2) / zoom + height / 2;

    for (const node of runtimeNodesRef.current) {
      const dx = transX - node.x;
      const dy = transY - node.y;
      if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 6) {
        return node;
      }
    }
    return null;
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const clicked = getNodeAtPoint(e.clientX, e.clientY);
    if (clicked) {
      draggedNodeRef.current = clicked;
      setSelectedNode(clicked);
    } else {
      isDraggingCanvasRef.current = true;
      dragStartRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (draggedNodeRef.current) {
      const rect = canvas.getBoundingClientRect();
      const width = canvas.width / (window.devicePixelRatio || 1);
      const height = canvas.height / (window.devicePixelRatio || 1);
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      draggedNodeRef.current.x = (mouseX - pan.x - width / 2) / zoom + width / 2;
      draggedNodeRef.current.y = (mouseY - pan.y - height / 2) / zoom + height / 2;
      draggedNodeRef.current.vx = 0;
      draggedNodeRef.current.vy = 0;
    } else if (isDraggingCanvasRef.current) {
      setPan({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    } else {
      const hovered = getNodeAtPoint(e.clientX, e.clientY);
      setHoveredNode(hovered);
      canvas.style.cursor = hovered ? 'pointer' : 'grab';
    }
  };

  const handleMouseUp = () => {
    draggedNodeRef.current = null;
    isDraggingCanvasRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(2.5, Math.max(0.4, prev * zoomFactor)));
  };

  return (
    <div className={`flex flex-col h-full w-full bg-slate-950 text-white rounded-2xl overflow-hidden relative select-none border border-slate-800/80 shadow-2xl ${className}`}>
      {/* Top Controls Bar: Structured Controls & Scrollable Clusters */}
      <div className="p-2.5 bg-slate-900/95 backdrop-blur-md border-b border-slate-800 flex flex-col gap-2 z-10 shrink-0">
        {/* Row 1: Header Badge + Right Search & Zoom Tools */}
        <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-bold shrink-0">
            <Network className="w-3.5 h-3.5 text-purple-400" />
            <span>Memory Graph</span>
            {data && <span className="text-[10px] text-purple-400/80 font-mono">({data.totalNodes})</span>}
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search graph..."
                className="pl-8 pr-3 py-1 bg-slate-800/90 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-purple-500 w-32 sm:w-44 transition"
              />
            </div>

            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-xl p-0.5">
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(2.5, z * 1.15))}
                className="p-1 hover:text-white text-slate-400 rounded transition"
                title="Zoom In"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.4, z * 0.85))}
                className="p-1 hover:text-white text-slate-400 rounded transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                className="p-1 hover:text-white text-slate-400 rounded transition"
                title="Reset View"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={loadGraph}
              className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border border-slate-700 rounded-xl transition shrink-0"
              title="Refresh Knowledge Graph"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Row 2: Horizontally Scrollable Category Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 max-w-full text-xs shrink-0">
          <button
            type="button"
            onClick={() => setSelectedCategory('all')}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition shrink-0 ${
              selectedCategory === 'all'
                ? 'bg-purple-600 text-white font-bold shadow-xs'
                : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            All Clusters ({data?.totalNodes || 0})
          </button>

          {data?.categories?.map((cat) => {
            const colors = getNodeColor(cat.name);
            const isSelected = selectedCategory === cat.name;
            return (
              <button
                key={cat.name}
                type="button"
                onClick={() => setSelectedCategory(isSelected ? 'all' : cat.name)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition shrink-0 ${
                  isSelected
                    ? 'bg-slate-100 text-slate-900 font-bold shadow-xs'
                    : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.fill }} />
                <span className="capitalize whitespace-nowrap">{cat.name.replace(/_/g, ' ')}</span>
                <span className="text-[10px] opacity-60 font-mono">({cat.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 w-full h-full relative overflow-hidden" ref={containerRef}>
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          className="w-full h-full block"
        />

        {/* Hover Tooltip */}
        {hoveredNode && !selectedNode && (
          <div
            className="absolute pointer-events-none p-2.5 rounded-xl bg-slate-900/95 backdrop-blur-md border border-slate-700 text-xs shadow-2xl z-20 space-y-1 animate-in fade-in duration-100"
            style={{
              left: Math.min(containerRef.current?.clientWidth || 0 - 200, (hoveredNode.x || 0) * zoom + pan.x + 20),
              top: Math.min(containerRef.current?.clientHeight || 0 - 100, (hoveredNode.y || 0) * zoom + pan.y - 20),
            }}
          >
            <div className="font-bold text-white line-clamp-1">{hoveredNode.title}</div>
            <div className="text-[10px] text-amber-400 capitalize">{hoveredNode.category.replace('_', ' ')}</div>
            <div className="text-[10px] text-slate-400 line-clamp-2">{hoveredNode.snippet}</div>
          </div>
        )}

        {/* Empty State: ZeroMock Policy */}
        {!isLoading && (!data || data.nodes.length === 0) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 bg-slate-950/80 backdrop-blur-xs">
            <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-500 mb-4 shadow-lg shadow-amber-500/10">
              <Network className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">Knowledge Graph Is Ready</h3>
            <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-4">
              Your memory vault does not contain any stored knowledge records yet. Add notes or instruct your twin in chat to save decisions and frameworks to see them cluster dynamically here.
            </p>
            {onOpenAddModal && (
              <button
                type="button"
                onClick={onOpenAddModal}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center gap-2 shadow-lg shadow-amber-500/20"
              >
                <BookOpen className="w-4 h-4" />
                <span>Store First Memory</span>
              </button>
            )}
          </div>
        )}

        {/* Selected Memory Inspector Drawer */}
        {selectedNode && (
          <div className="absolute top-3 right-3 bottom-3 w-84 max-w-[92vw] bg-slate-900/95 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 shadow-2xl z-30 flex flex-col animate-in slide-in-from-right duration-200">
            <div className="flex items-start justify-between gap-2 pb-3 border-b border-slate-800">
              <div className="flex-1 min-w-0">
                <span className="text-[10px] uppercase font-mono font-bold text-amber-400 tracking-wider">
                  {selectedNode.category.replace('_', ' ')}
                </span>
                <h3 className="text-sm font-bold text-white leading-snug line-clamp-2 mt-0.5">
                  {selectedNode.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-3 pr-1 text-xs text-slate-300">
              {/* Content Preview */}
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 leading-relaxed max-h-56 overflow-y-auto">
                {renderFormattedMarkdown(selectedNode.snippet)}
              </div>

              {/* Tags */}
              {selectedNode.tags && selectedNode.tags.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-slate-400 font-semibold flex items-center gap-1">
                    <Tag className="w-3 h-3 text-slate-500" />
                    <span>Associated Tags</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {selectedNode.tags.map((t) => (
                      <span key={t} className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-[10px] text-slate-300">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Connected Memory Nodes */}
              <div className="space-y-1.5 pt-1">
                <div className="text-[10px] text-slate-400 font-semibold flex items-center justify-between">
                  <span>Connected Memories</span>
                  <span className="text-[10px] font-mono text-amber-400 font-bold">{neighborNodes.length}</span>
                </div>
                {neighborNodes.length > 0 ? (
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {neighborNodes.map((neighbor) => (
                      <button
                        key={neighbor.id}
                        type="button"
                        onClick={() => setSelectedNode(neighbor)}
                        className="w-full text-left p-2 rounded-lg bg-slate-800/60 hover:bg-slate-800 border border-slate-700/60 text-[11px] text-slate-200 flex items-center justify-between transition group"
                      >
                        <span className="truncate flex-1 pr-2">{neighbor.title}</span>
                        <ArrowRight className="w-3 h-3 text-slate-500 group-hover:text-amber-400 shrink-0" />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-[10px] text-slate-500 italic">No direct tag or cluster neighbors</p>
                )}
              </div>
            </div>

            {/* Actions Footer */}
            <div className="pt-3 border-t border-slate-800 flex items-center gap-2">
              {onInsertToChat && (
                <button
                  type="button"
                  onClick={() => {
                    onInsertToChat(`Let's discuss my stored knowledge premise regarding "${selectedNode.title}". How does this impact our current direction?`);
                    setSelectedNode(null);
                  }}
                  className="flex-1 py-2 px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  <span>Discuss in Chat</span>
                </button>
              )}

              <button
                type="button"
                disabled={isDeleting}
                onClick={() => handleDeleteNode(selectedNode)}
                className="p-2 rounded-xl text-rose-400 hover:bg-rose-500/10 border border-rose-500/20 transition shrink-0"
                title="Prune this memory from vault"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
