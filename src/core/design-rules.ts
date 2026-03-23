import type { DesignRules, Project, Track, Via, PCBComponent } from './types';

// JLCPCB standard capabilities for 2-layer boards (1oz copper)
// Source: https://jlcpcb.com/capabilities/pcb-capabilities
export const JLCPCB_DESIGN_RULES_2LAYER: DesignRules = {
  minTraceWidth: 0.127,        // 5 mil
  minTraceSpacing: 0.127,      // 5 mil
  minViaDrill: 0.3,            // mm
  minViaDiameter: 0.5,         // mm
  minAnnularRing: 0.15,        // mm
  minClearance: 0.127,         // 5 mil
  copperToEdge: 0.3,           // mm
  defaultTraceWidth: 0.254,    // 10 mil (recommended)
  defaultViaDrill: 0.4,        // mm
  defaultViaDiameter: 0.8,     // mm
};

// JLCPCB capabilities for 4+ layer boards
export const JLCPCB_DESIGN_RULES_4LAYER: DesignRules = {
  minTraceWidth: 0.089,        // 3.5 mil
  minTraceSpacing: 0.089,      // 3.5 mil
  minViaDrill: 0.15,           // mm
  minViaDiameter: 0.25,        // mm
  minAnnularRing: 0.15,        // mm
  minClearance: 0.127,         // 5 mil
  copperToEdge: 0.3,           // mm
  defaultTraceWidth: 0.2,      // ~8 mil
  defaultViaDrill: 0.3,        // mm
  defaultViaDiameter: 0.6,     // mm
};

export interface DRCViolation {
  type: 'trace_width' | 'trace_spacing' | 'via_drill' | 'via_diameter' |
        'annular_ring' | 'clearance' | 'copper_edge' | 'unconnected';
  severity: 'error' | 'warning';
  message: string;
  elementIds: string[];
  location: { x: number; y: number };
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

export function runDRC(project: Project): DRCViolation[] {
  const violations: DRCViolation[] = [];
  const rules = project.designRules;
  const { tracks, vias, components, boardOutline } = project.pcb;

  // Check trace widths
  for (const track of tracks) {
    if (track.width < rules.minTraceWidth) {
      violations.push({
        type: 'trace_width',
        severity: 'error',
        message: `Track width ${track.width}mm is below minimum ${rules.minTraceWidth}mm`,
        elementIds: [track.id],
        location: track.points[0] ?? { x: 0, y: 0 },
      });
    }
  }

  // Check via sizes
  for (const via of vias) {
    if (via.drill < rules.minViaDrill) {
      violations.push({
        type: 'via_drill',
        severity: 'error',
        message: `Via drill ${via.drill}mm is below minimum ${rules.minViaDrill}mm`,
        elementIds: [via.id],
        location: via.position,
      });
    }
    if (via.diameter < rules.minViaDiameter) {
      violations.push({
        type: 'via_diameter',
        severity: 'error',
        message: `Via diameter ${via.diameter}mm is below minimum ${rules.minViaDiameter}mm`,
        elementIds: [via.id],
        location: via.position,
      });
    }
    const annular = (via.diameter - via.drill) / 2;
    if (annular < rules.minAnnularRing) {
      violations.push({
        type: 'annular_ring',
        severity: 'error',
        message: `Via annular ring ${annular.toFixed(3)}mm is below minimum ${rules.minAnnularRing}mm`,
        elementIds: [via.id],
        location: via.position,
      });
    }
  }

  // Check copper to board edge clearance
  for (const comp of components) {
    for (const pad of comp.footprint.pads) {
      const padX = comp.position.x + pad.centerX;
      const padY = comp.position.y + pad.centerY;

      for (let i = 0; i < boardOutline.points.length; i++) {
        const p1 = boardOutline.points[i];
        const p2 = boardOutline.points[(i + 1) % boardOutline.points.length];
        const d = distPointToSegment(padX, padY, p1.x, p1.y, p2.x, p2.y);
        if (d < rules.copperToEdge) {
          violations.push({
            type: 'copper_edge',
            severity: 'error',
            message: `Pad ${comp.reference}.${pad.number} is ${d.toFixed(3)}mm from board edge (min ${rules.copperToEdge}mm)`,
            elementIds: [comp.id],
            location: { x: padX, y: padY },
          });
        }
      }
    }
  }

  // Check track-to-track spacing (simplified: checks endpoints)
  for (let i = 0; i < tracks.length; i++) {
    for (let j = i + 1; j < tracks.length; j++) {
      if (tracks[i].netId === tracks[j].netId) continue;
      if (tracks[i].layer !== tracks[j].layer) continue;

      for (const p1 of tracks[i].points) {
        for (const p2 of tracks[j].points) {
          const d = dist(p1.x, p1.y, p2.x, p2.y);
          const minDist = rules.minTraceSpacing + (tracks[i].width + tracks[j].width) / 2;
          if (d < minDist) {
            violations.push({
              type: 'trace_spacing',
              severity: 'error',
              message: `Tracks too close: ${d.toFixed(3)}mm (min ${minDist.toFixed(3)}mm)`,
              elementIds: [tracks[i].id, tracks[j].id],
              location: p1,
            });
          }
        }
      }
    }
  }

  return violations;
}

function distPointToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(px, py, x1, y1);

  let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  return dist(px, py, x1 + t * dx, y1 + t * dy);
}
