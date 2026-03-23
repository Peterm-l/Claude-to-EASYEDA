import type { Project, DesignRules, Schematic, PCBLayout, BoardOutline, Point, MountingHole } from './types';
import { JLCPCB_DESIGN_RULES_2LAYER } from './design-rules';

export function createEmptySchematic(): Schematic {
  return {
    components: [],
    wires: [],
    netLabels: [],
    junctions: [],
    powerFlags: [],
    nets: [],
  };
}

// Generate board outline points for different shapes
export function createBoardOutline(
  shape: BoardOutline['shape'],
  width: number,
  height: number,
  options?: { cornerRadius?: number; mountingHoles?: MountingHole[] }
): BoardOutline {
  const r = options?.cornerRadius ?? 0;
  let points: Point[];

  switch (shape) {
    case 'rectangle':
      points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ];
      break;

    case 'rounded_rect': {
      const cr = Math.min(r, width / 2, height / 2);
      const steps = 8; // points per corner arc
      points = [];
      // Top-right corner
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (Math.PI / 2) * (i / steps);
        points.push({ x: width - cr + cr * Math.cos(a), y: cr + cr * Math.sin(a) });
      }
      // Bottom-right corner
      for (let i = 0; i <= steps; i++) {
        const a = 0 + (Math.PI / 2) * (i / steps);
        points.push({ x: width - cr + cr * Math.cos(a), y: height - cr + cr * Math.sin(a) });
      }
      // Bottom-left corner
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI / 2 + (Math.PI / 2) * (i / steps);
        points.push({ x: cr + cr * Math.cos(a), y: height - cr + cr * Math.sin(a) });
      }
      // Top-left corner
      for (let i = 0; i <= steps; i++) {
        const a = Math.PI + (Math.PI / 2) * (i / steps);
        points.push({ x: cr + cr * Math.cos(a), y: cr + cr * Math.sin(a) });
      }
      break;
    }

    case 'circle': {
      const cx = width / 2;
      const cy = height / 2;
      const radius = Math.min(width, height) / 2;
      const steps = 36;
      points = [];
      for (let i = 0; i < steps; i++) {
        const a = (2 * Math.PI * i) / steps;
        points.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
      }
      break;
    }

    case 'polygon':
    default:
      // Default to rectangle, user provides custom points via set_board_outline
      points = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ];
      break;
  }

  return {
    shape,
    points,
    width,
    height,
    cornerRadius: r,
    mountingHoles: options?.mountingHoles ?? [],
    keepOutZones: [],
  };
}

// Add standard mounting holes at corners with configurable inset
export function addCornerMountingHoles(
  outline: BoardOutline,
  holeDiameter: number = 3.2,  // M3 screw
  padDiameter: number = 6.0,
  inset: number = 4.0,         // distance from edge
  plated: boolean = false,
): BoardOutline {
  const holes: MountingHole[] = [
    { id: 'mh_tl', position: { x: inset, y: inset }, diameter: holeDiameter, padDiameter, plated },
    { id: 'mh_tr', position: { x: outline.width - inset, y: inset }, diameter: holeDiameter, padDiameter, plated },
    { id: 'mh_br', position: { x: outline.width - inset, y: outline.height - inset }, diameter: holeDiameter, padDiameter, plated },
    { id: 'mh_bl', position: { x: inset, y: outline.height - inset }, diameter: holeDiameter, padDiameter, plated },
  ];

  return {
    ...outline,
    mountingHoles: [...outline.mountingHoles, ...holes],
  };
}

// Check if a point is inside the board outline polygon
export function isPointInsideBoard(point: Point, outline: BoardOutline): boolean {
  return isPointInPolygon(point, outline.points);
}

// Check if a point is inside any keep-out zone
export function isPointInKeepOut(point: Point, outline: BoardOutline): boolean {
  return outline.keepOutZones.some(zone => isPointInPolygon(point, zone));
}

// Ray-casting point-in-polygon test
function isPointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if ((yi > point.y) !== (yj > point.y) &&
        point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Get minimum distance from point to board edge
export function distanceToEdge(point: Point, outline: BoardOutline): number {
  let minDist = Infinity;
  const pts = outline.points;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const d = distPointToSegment(point.x, point.y, pts[i].x, pts[i].y, pts[j].x, pts[j].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.sqrt((px - x1 - t * dx) ** 2 + (py - y1 - t * dy) ** 2);
}

// Suggest component placement positions that fit inside the board
export function suggestPlacementGrid(
  outline: BoardOutline,
  margin: number,       // mm from edge
  spacingX: number,     // mm between columns
  spacingY: number,     // mm between rows
): Point[] {
  const positions: Point[] = [];
  for (let y = margin; y < outline.height - margin; y += spacingY) {
    for (let x = margin; x < outline.width - margin; x += spacingX) {
      const p = { x, y };
      if (isPointInsideBoard(p, outline) &&
          !isPointInKeepOut(p, outline) &&
          distanceToEdge(p, outline) >= margin) {
        positions.push(p);
      }
    }
  }
  return positions;
}

export function createEmptyPCBLayout(): PCBLayout {
  return {
    components: [],
    tracks: [],
    vias: [],
    copperZones: [],
    boardOutline: createBoardOutline('rectangle', 100, 100),
    layers: ['top_copper', 'bottom_copper', 'top_silkscreen', 'bottom_silkscreen',
      'top_soldermask', 'bottom_soldermask', 'top_paste', 'bottom_paste', 'edge_cuts'],
    layerCount: 2,
  };
}

export function createProject(name: string, description: string = ''): Project {
  const now = new Date().toISOString();
  return {
    name,
    version: '1.0.0',
    description,
    created: now,
    modified: now,
    designRules: { ...JLCPCB_DESIGN_RULES_2LAYER },
    schematic: createEmptySchematic(),
    pcb: createEmptyPCBLayout(),
    parts: [],
    bom: [],
  };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  return JSON.parse(json) as Project;
}

let nextId = 1;
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${nextId++}`;
}

export function updateBOM(project: Project): Project {
  const bomMap = new Map<string, { refs: string[]; comp: typeof project.schematic.components[0] }>();

  for (const comp of project.schematic.components) {
    const key = `${comp.partId}_${comp.value}`;
    const entry = bomMap.get(key);
    if (entry) {
      entry.refs.push(comp.reference);
    } else {
      bomMap.set(key, { refs: [comp.reference], comp });
    }
  }

  const part = (lcsc: string) => project.parts.find(p => p.lcsc === lcsc);

  project.bom = Array.from(bomMap.values()).map(({ refs, comp }) => {
    const p = part(comp.partId);
    return {
      reference: refs.sort(),
      value: comp.value,
      footprint: p?.package ?? '',
      lcsc: comp.partId,
      quantity: refs.length,
      description: p?.description ?? '',
      unitPrice: p?.price ?? 0,
      inStock: (p?.stock ?? 0) > 0,
    };
  });

  return project;
}
