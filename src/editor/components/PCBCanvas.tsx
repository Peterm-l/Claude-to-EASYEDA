import React, { useRef, useEffect, useCallback, useState } from 'react';
import type { Project, EditorState, Point, PCBComponent, Pad, Track } from '../../core/types';

interface Props {
  project: Project;
  editorState: EditorState;
  onEditorStateChange: (state: EditorState) => void;
  onMoveComponent: (id: string, pos: Point) => void;
  onAddTrack: (points: Point[], netId: string) => void;
  onAddVia: (position: Point, netId: string) => void;
  onSelectIds: (ids: string[]) => void;
}

const GRID_MM = 0.5; // 0.5mm grid
const MM_PX = 40;    // pixels per mm at zoom=1

const LAYER_COLORS: Record<string, string> = {
  top_copper: '#ff3333',
  bottom_copper: '#3333ff',
  top_silkscreen: '#ffcc00',
  bottom_silkscreen: '#66cc33',
  edge_cuts: '#ffff00',
};

const PAD_COLORS = {
  top: '#cc2222',
  bottom: '#2222cc',
  through: '#44aa44',
};

export function PCBCanvas({ project, editorState, onEditorStateChange, onMoveComponent, onAddTrack, onAddVia, onSelectIds }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState<{ id: string; offset: Point } | null>(null);
  const [trackPoints, setTrackPoints] = useState<Point[]>([]);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Point>({ x: 0, y: 0 });

  const scale = MM_PX * editorState.zoom;

  const toScreen = useCallback((p: Point): Point => ({
    x: (p.x + editorState.panOffset.x) * scale,
    y: (p.y + editorState.panOffset.y) * scale,
  }), [scale, editorState.panOffset]);

  const toWorld = useCallback((sx: number, sy: number): Point => ({
    x: sx / scale - editorState.panOffset.x,
    y: sy / scale - editorState.panOffset.y,
  }), [scale, editorState.panOffset]);

  const snapToGrid = useCallback((p: Point): Point => {
    if (!editorState.snapToGrid) return p;
    return {
      x: Math.round(p.x / GRID_MM) * GRID_MM,
      y: Math.round(p.y / GRID_MM) * GRID_MM,
    };
  }, [editorState.snapToGrid]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Dark background
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(editorState.panOffset.x * scale, editorState.panOffset.y * scale);
    ctx.scale(scale, scale);

    // Grid
    if (editorState.showGrid) {
      const viewLeft = -editorState.panOffset.x;
      const viewTop = -editorState.panOffset.y;
      const viewRight = viewLeft + w / scale;
      const viewBottom = viewTop + h / scale;

      const gridPx = GRID_MM * scale;
      if (gridPx > 4) {
        ctx.strokeStyle = '#1a1a30';
        ctx.lineWidth = 0.02;
        const startX = Math.floor(viewLeft / GRID_MM) * GRID_MM;
        const startY = Math.floor(viewTop / GRID_MM) * GRID_MM;

        for (let x = startX; x < viewRight; x += GRID_MM) {
          ctx.beginPath();
          ctx.moveTo(x, viewTop);
          ctx.lineTo(x, viewBottom);
          ctx.stroke();
        }
        for (let y = startY; y < viewBottom; y += GRID_MM) {
          ctx.beginPath();
          ctx.moveTo(viewLeft, y);
          ctx.lineTo(viewRight, y);
          ctx.stroke();
        }
      }
    }

    // Board outline
    const outline = project.pcb.boardOutline;
    if (outline.points.length > 0) {
      ctx.strokeStyle = LAYER_COLORS.edge_cuts;
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.moveTo(outline.points[0].x, outline.points[0].y);
      for (let i = 1; i < outline.points.length; i++) {
        ctx.lineTo(outline.points[i].x, outline.points[i].y);
      }
      ctx.closePath();
      ctx.stroke();

      // Board fill
      ctx.fillStyle = '#0f1a0f';
      ctx.fill();
    }

    // Copper zones
    for (const zone of project.pcb.copperZones) {
      if (zone.outline.length < 3) continue;
      ctx.fillStyle = (LAYER_COLORS[zone.layer] ?? '#888') + '30';
      ctx.strokeStyle = (LAYER_COLORS[zone.layer] ?? '#888') + '80';
      ctx.lineWidth = 0.1;
      ctx.beginPath();
      ctx.moveTo(zone.outline[0].x, zone.outline[0].y);
      for (let i = 1; i < zone.outline.length; i++) {
        ctx.lineTo(zone.outline[i].x, zone.outline[i].y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    // Tracks
    for (const track of project.pcb.tracks) {
      const isSelected = editorState.selectedIds.includes(track.id);
      ctx.strokeStyle = isSelected ? '#ff4466' : (LAYER_COLORS[track.layer] ?? '#888');
      ctx.lineWidth = track.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (track.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(track.points[0].x, track.points[0].y);
        for (let i = 1; i < track.points.length; i++) {
          ctx.lineTo(track.points[i].x, track.points[i].y);
        }
        ctx.stroke();
      }
    }

    // Vias
    for (const via of project.pcb.vias) {
      ctx.fillStyle = '#44aa44';
      ctx.strokeStyle = '#66dd66';
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(via.position.x, via.position.y, via.diameter / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Hole
      ctx.fillStyle = '#0a0a1a';
      ctx.beginPath();
      ctx.arc(via.position.x, via.position.y, via.drill / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Components
    for (const comp of project.pcb.components) {
      drawPCBComponent(ctx, comp, editorState.selectedIds.includes(comp.id), scale);
    }

    // Track being drawn
    if (trackPoints.length > 0) {
      ctx.strokeStyle = LAYER_COLORS[editorState.activeLayer] ?? '#ff3333';
      ctx.lineWidth = project.designRules.defaultTraceWidth;
      ctx.lineCap = 'round';
      ctx.setLineDash([0.2, 0.1]);
      ctx.beginPath();
      ctx.moveTo(trackPoints[0].x, trackPoints[0].y);
      for (let i = 1; i < trackPoints.length; i++) {
        ctx.lineTo(trackPoints[i].x, trackPoints[i].y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();

    // Status bar
    ctx.fillStyle = '#0a0a1a';
    ctx.fillRect(0, h - 28, w, 28);
    ctx.fillStyle = '#ccccee';
    ctx.font = '12px monospace';
    ctx.fillText(
      `PCB | Zoom: ${(editorState.zoom * 100).toFixed(0)}% | Grid: ${GRID_MM}mm | Layer: ${editorState.activeLayer} | Tool: ${editorState.activeTool} | Components: ${project.pcb.components.length}`,
      8, h - 8
    );
  }, [project, editorState, trackPoints, scale]);

  function drawPCBComponent(ctx: CanvasRenderingContext2D, comp: PCBComponent, selected: boolean, sc: number) {
    ctx.save();
    ctx.translate(comp.position.x, comp.position.y);
    ctx.rotate((comp.rotation * Math.PI) / 180);

    // Pads
    for (const pad of comp.footprint.pads) {
      const color = PAD_COLORS[pad.layer] ?? PAD_COLORS.top;
      ctx.fillStyle = selected ? '#ff4466' : color;

      if (pad.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(pad.centerX, pad.centerY, pad.width / 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (pad.shape === 'oval') {
        ctx.beginPath();
        ctx.ellipse(pad.centerX, pad.centerY, pad.width / 2, pad.height / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(pad.centerX - pad.width / 2, pad.centerY - pad.height / 2, pad.width, pad.height);
      }

      // Hole
      if (pad.holeWidth > 0) {
        ctx.fillStyle = '#0a0a1a';
        ctx.beginPath();
        ctx.arc(pad.centerX, pad.centerY, pad.holeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      // Pad number
      if (sc > 15) {
        ctx.fillStyle = '#ffffff';
        ctx.font = `${0.3}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pad.number, pad.centerX, pad.centerY);
      }
    }

    // Silkscreen
    const silkColor = comp.layer === 'top' ? LAYER_COLORS.top_silkscreen : LAYER_COLORS.bottom_silkscreen;
    for (const line of comp.footprint.lines) {
      ctx.strokeStyle = selected ? '#ff4466' : (silkColor ?? '#ffcc00');
      ctx.lineWidth = line.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (line.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(line.points[0].x, line.points[0].y);
        for (let i = 1; i < line.points.length; i++) {
          ctx.lineTo(line.points[i].x, line.points[i].y);
        }
        ctx.stroke();
      }
    }

    // Reference
    ctx.fillStyle = '#ccccee';
    ctx.font = `${0.8}px monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(comp.reference, 0, -comp.footprint.courtyard.height / 2 - 0.5);

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

  // Mouse handlers (similar to schematic but with mm units)
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
      for (const comp of [...project.pcb.components].reverse()) {
        const cy = comp.footprint.courtyard;
        if (world.x >= comp.position.x + cy.x &&
            world.x <= comp.position.x + cy.x + cy.width &&
            world.y >= comp.position.y + cy.y &&
            world.y <= comp.position.y + cy.y + cy.height) {
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

    if (editorState.activeTool === 'track') {
      setTrackPoints(prev => [...prev, snapped]);
    }

    if (editorState.activeTool === 'via') {
      onAddVia(snapped, '');
    }
  }, [editorState, project, toWorld, snapToGrid, onSelectIds, onAddVia]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (isPanning) {
      const dx = (sx - panStart.x) / scale;
      const dy = (sy - panStart.y) / scale;
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
  }, [isPanning, panStart, dragging, editorState, toWorld, snapToGrid, scale, onMoveComponent, onEditorStateChange]);

  const handleMouseUp = useCallback(() => {
    setIsPanning(false);
    setDragging(null);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (editorState.activeTool === 'track' && trackPoints.length >= 2) {
      onAddTrack(trackPoints, '');
      setTrackPoints([]);
    }
  }, [editorState.activeTool, trackPoints, onAddTrack]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.1, Math.min(20, editorState.zoom * factor));
    onEditorStateChange({ ...editorState, zoom: newZoom });
  }, [editorState, onEditorStateChange]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%', cursor: editorState.activeTool === 'pan' ? 'grab' : 'crosshair' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
      tabIndex={0}
    />
  );
}
