import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Project, EditorState, Point, SchematicComponent, Wire } from '../../core/types';

interface Props {
  project: Project;
  editorState: EditorState;
  onEditorStateChange: (state: EditorState) => void;
  onMoveComponent: (id: string, pos: Point) => void;
  onAddWire: (points: Point[], netId: string) => void;
  onSelectIds: (ids: string[]) => void;
}

const GRID = 50; // mils
const COLORS = {
  background: '#1a1a2e',
  grid: '#252545',
  gridMajor: '#303060',
  wire: '#00cc66',
  component: '#4488ff',
  componentBody: '#2a2a5e',
  pin: '#ffaa00',
  pinDot: '#ff6600',
  selected: '#ff4466',
  text: '#ccccee',
  reference: '#66aaff',
  value: '#ff8866',
};

export function SchematicCanvas({ project, editorState, onEditorStateChange, onMoveComponent, onAddWire, onSelectIds }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<{ id: string; offset: Point } | null>(null);
  const [wirePoints, setWirePoints] = useState<Point[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  const toScreen = useCallback((p: Point): Point => ({
    x: (p.x + editorState.panOffset.x) * editorState.zoom,
    y: (p.y + editorState.panOffset.y) * editorState.zoom,
  }), [editorState.zoom, editorState.panOffset]);

  const toWorld = useCallback((sx: number, sy: number): Point => ({
    x: sx / editorState.zoom - editorState.panOffset.x,
    y: sy / editorState.zoom - editorState.panOffset.y,
  }), [editorState.zoom, editorState.panOffset]);

  const snapToGrid = useCallback((p: Point): Point => {
    if (!editorState.snapToGrid) return p;
    return {
      x: Math.round(p.x / GRID) * GRID,
      y: Math.round(p.y / GRID) * GRID,
    };
  }, [editorState.snapToGrid]);

  // Draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const zoom = editorState.zoom;
    const ox = editorState.panOffset.x;
    const oy = editorState.panOffset.y;

    // Background
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, w, h);

    // Grid
    if (editorState.showGrid) {
      const gridScreen = GRID * zoom;
      if (gridScreen > 4) {
        const startX = (ox * zoom) % gridScreen;
        const startY = (oy * zoom) % gridScreen;

        ctx.strokeStyle = COLORS.grid;
        ctx.lineWidth = 0.5;
        for (let x = startX; x < w; x += gridScreen) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
        for (let y = startY; y < h; y += gridScreen) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(w, y);
          ctx.stroke();
        }

        // Major grid (every 5)
        const majorGrid = gridScreen * 5;
        if (majorGrid > 20) {
          ctx.strokeStyle = COLORS.gridMajor;
          ctx.lineWidth = 1;
          const majorStartX = (ox * zoom) % majorGrid;
          const majorStartY = (oy * zoom) % majorGrid;
          for (let x = majorStartX; x < w; x += majorGrid) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
          }
          for (let y = majorStartY; y < h; y += majorGrid) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();
          }
        }
      }
    }

    ctx.save();
    ctx.translate(ox * zoom, oy * zoom);
    ctx.scale(zoom, zoom);

    // Wires
    for (const wire of project.schematic.wires) {
      const isSelected = editorState.selectedIds.includes(wire.id);
      ctx.strokeStyle = isSelected ? COLORS.selected : COLORS.wire;
      ctx.lineWidth = 2 / zoom;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (wire.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(wire.points[0].x, wire.points[0].y);
        for (let i = 1; i < wire.points.length; i++) {
          ctx.lineTo(wire.points[i].x, wire.points[i].y);
        }
        ctx.stroke();
      }
    }

    // Components
    for (const comp of project.schematic.components) {
      drawComponent(ctx, comp, editorState.selectedIds.includes(comp.id), zoom);
    }

    // Net labels
    for (const label of project.schematic.netLabels) {
      const s = toScreen(label.position);
      ctx.fillStyle = COLORS.text;
      ctx.font = `${14 / zoom}px monospace`;
      ctx.fillText(label.name, label.position.x + 5, label.position.y - 5);

      // Flag shape
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(label.position.x, label.position.y);
      ctx.lineTo(label.position.x + 10, label.position.y);
      ctx.stroke();
    }

    // Junctions
    for (const j of project.schematic.junctions) {
      ctx.fillStyle = COLORS.wire;
      ctx.beginPath();
      ctx.arc(j.position.x, j.position.y, 4 / zoom, 0, Math.PI * 2);
      ctx.fill();
    }

    // Wire being drawn
    if (wirePoints.length > 0) {
      ctx.strokeStyle = COLORS.wire;
      ctx.lineWidth = 2 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(wirePoints[0].x, wirePoints[0].y);
      for (let i = 1; i < wirePoints.length; i++) {
        ctx.lineTo(wirePoints[i].x, wirePoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Status bar
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, h - 28, w, 28);
    ctx.fillStyle = COLORS.text;
    ctx.font = '12px monospace';
    ctx.fillText(
      `Schematic | Zoom: ${(zoom * 100).toFixed(0)}% | Grid: ${GRID}mil | Tool: ${editorState.activeTool} | Components: ${project.schematic.components.length} | Nets: ${project.schematic.nets.length}`,
      8, h - 8
    );
  }, [project, editorState, wirePoints, toScreen]);

  function drawComponent(ctx: CanvasRenderingContext2D, comp: SchematicComponent, selected: boolean, zoom: number) {
    const { x, y } = comp.position;
    const pinCount = comp.pins?.length ?? 2;
    const halfPins = Math.ceil(pinCount / 2);
    const bodyW = 120;
    const bodyH = Math.max(80, halfPins * 50);

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((comp.rotation * Math.PI) / 180);

    // Body
    ctx.fillStyle = COLORS.componentBody;
    ctx.strokeStyle = selected ? COLORS.selected : COLORS.component;
    ctx.lineWidth = 2 / zoom;
    ctx.fillRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);
    ctx.strokeRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH);

    // Pin 1 marker
    ctx.fillStyle = selected ? COLORS.selected : COLORS.component;
    ctx.beginPath();
    ctx.arc(-bodyW / 2 + 8, -bodyH / 2 + 8, 3 / zoom, 0, Math.PI * 2);
    ctx.fill();

    // Reference
    ctx.fillStyle = COLORS.reference;
    ctx.font = `bold ${14 / zoom}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(comp.reference, 0, -bodyH / 2 - 8 / zoom);

    // Value
    ctx.fillStyle = COLORS.value;
    ctx.font = `${12 / zoom}px monospace`;
    ctx.fillText(comp.value, 0, bodyH / 2 + 16 / zoom);

    // Pins
    const leftPins = comp.pins?.slice(0, halfPins) ?? [];
    const rightPins = comp.pins?.slice(halfPins) ?? [];

    ctx.font = `${10 / zoom}px monospace`;
    ctx.textAlign = 'left';

    for (let i = 0; i < leftPins.length; i++) {
      const py = -bodyH / 2 + 25 + i * 50;
      // Pin line
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(-bodyW / 2, py);
      ctx.lineTo(-bodyW / 2 - 30, py);
      ctx.stroke();
      // Pin dot
      ctx.fillStyle = COLORS.pinDot;
      ctx.beginPath();
      ctx.arc(-bodyW / 2 - 30, py, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
      // Pin name
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'left';
      ctx.fillText(leftPins[i].name || leftPins[i].number, -bodyW / 2 + 6, py + 4 / zoom);
      // Pin number
      ctx.fillStyle = COLORS.pin;
      ctx.textAlign = 'right';
      ctx.fillText(leftPins[i].number, -bodyW / 2 - 4, py - 4 / zoom);
    }

    for (let i = 0; i < rightPins.length; i++) {
      const py = -bodyH / 2 + 25 + i * 50;
      ctx.strokeStyle = COLORS.pin;
      ctx.lineWidth = 1.5 / zoom;
      ctx.beginPath();
      ctx.moveTo(bodyW / 2, py);
      ctx.lineTo(bodyW / 2 + 30, py);
      ctx.stroke();
      ctx.fillStyle = COLORS.pinDot;
      ctx.beginPath();
      ctx.arc(bodyW / 2 + 30, py, 3 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = 'right';
      ctx.fillText(rightPins[i].name || rightPins[i].number, bodyW / 2 - 6, py + 4 / zoom);
      ctx.fillStyle = COLORS.pin;
      ctx.textAlign = 'left';
      ctx.fillText(rightPins[i].number, bodyW / 2 + 4, py - 4 / zoom);
    }

    ctx.restore();
  }

  // Resize
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
      draw();
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [draw]);

  useEffect(() => { draw(); }, [draw]);

  // Mouse handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const world = toWorld(sx, sy);
    const snapped = snapToGrid(world);

    if (e.button === 1 || (e.button === 0 && editorState.activeTool === 'pan')) {
      setIsPanning(true);
      setPanStart({ x: sx, y: sy });
      return;
    }

    if (editorState.activeTool === 'select') {
      // Hit test components
      for (const comp of [...project.schematic.components].reverse()) {
        const pinCount = comp.pins?.length ?? 2;
        const halfPins = Math.ceil(pinCount / 2);
        const bodyW = 120;
        const bodyH = Math.max(80, halfPins * 50);

        if (world.x >= comp.position.x - bodyW / 2 - 30 &&
            world.x <= comp.position.x + bodyW / 2 + 30 &&
            world.y >= comp.position.y - bodyH / 2 &&
            world.y <= comp.position.y + bodyH / 2) {
          onSelectIds([comp.id]);
          setDragging({
            id: comp.id,
            offset: { x: world.x - comp.position.x, y: world.y - comp.position.y },
          });
          return;
        }
      }
      onSelectIds([]);
    }

    if (editorState.activeTool === 'wire') {
      setWirePoints(prev => [...prev, snapped]);
    }
  }, [editorState, project, toWorld, snapToGrid, onSelectIds]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning) {
      const dx = (sx - panStart.x) / editorState.zoom;
      const dy = (sy - panStart.y) / editorState.zoom;
      onEditorStateChange({
        ...editorState,
        panOffset: {
          x: editorState.panOffset.x + dx,
          y: editorState.panOffset.y + dy,
        },
      });
      setPanStart({ x: sx, y: sy });
      return;
    }

    if (dragging) {
      const world = toWorld(sx, sy);
      const snapped = snapToGrid({
        x: world.x - dragging.offset.x,
        y: world.y - dragging.offset.y,
      });
      onMoveComponent(dragging.id, snapped);
    }
  }, [isPanning, panStart, dragging, editorState, toWorld, snapToGrid, onMoveComponent, onEditorStateChange]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragging(null);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (editorState.activeTool === 'wire' && wirePoints.length >= 2) {
      onAddWire(wirePoints, '');
      setWirePoints([]);
    }
  }, [editorState.activeTool, wirePoints, onAddWire]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(10, editorState.zoom * factor));
    onEditorStateChange({ ...editorState, zoom: newZoom });
  }, [editorState, onEditorStateChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setWirePoints([]);
      onSelectIds([]);
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (editorState.selectedIds.length > 0) {
        // handled by parent
      }
    }
  }, [editorState.selectedIds, onSelectIds]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: editorState.activeTool === 'pan' ? 'grab' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      tabIndex={0}
    />
  );
}
