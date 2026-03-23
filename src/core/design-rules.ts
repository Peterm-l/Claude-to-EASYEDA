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
        'annular_ring' | 'clearance' | 'copper_edge' | 'outside_board' |
        'keepout' | 'mounting_hole_clearance' | 'unconnected';
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

  // --- Trace checks ---
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

    // Check track points are inside board and away from edge
    for (const pt of track.points) {
      if (!isInsidePolygon(pt, boardOutline.points)) {
        violations.push({
          type: 'outside_board',
          severity: 'error',
          message: `Track extends outside board outline`,
          elementIds: [track.id],
          location: pt,
        });
        break; // one violation per track is enough
      }
      const edgeDist = minDistToPolygonEdge(pt, boardOutline.points);
      if (edgeDist < rules.copperToEdge) {
        violations.push({
          type: 'copper_edge',
          severity: 'error',
          message: `Track is ${edgeDist.toFixed(3)}mm from board edge (min ${rules.copperToEdge}mm)`,
          elementIds: [track.id],
          location: pt,
        });
      }
    }

    // Check track points against keep-out zones
    for (const zone of boardOutline.keepOutZones) {
      for (const pt of track.points) {
        if (isInsidePolygon(pt, zone)) {
          violations.push({
            type: 'keepout',
            severity: 'error',
            message: `Track enters keep-out zone`,
            elementIds: [track.id],
            location: pt,
          });
          break;
        }
      }
    }
  }

  // --- Via checks ---
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

    // Via inside board?
    if (!isInsidePolygon(via.position, boardOutline.points)) {
      violations.push({
        type: 'outside_board',
        severity: 'error',
        message: `Via is outside board outline`,
        elementIds: [via.id],
        location: via.position,
      });
    } else {
      const edgeDist = minDistToPolygonEdge(via.position, boardOutline.points);
      if (edgeDist < rules.copperToEdge + via.diameter / 2) {
        violations.push({
          type: 'copper_edge',
          severity: 'error',
          message: `Via is ${(edgeDist - via.diameter / 2).toFixed(3)}mm from board edge (min ${rules.copperToEdge}mm)`,
          elementIds: [via.id],
          location: via.position,
        });
      }
    }

    // Via vs mounting holes
    for (const mh of boardOutline.mountingHoles) {
      const d = dist(via.position.x, via.position.y, mh.position.x, mh.position.y);
      const minDist = via.diameter / 2 + mh.padDiameter / 2 + rules.minClearance;
      if (d < minDist) {
        violations.push({
          type: 'mounting_hole_clearance',
          severity: 'error',
          message: `Via is ${d.toFixed(3)}mm from mounting hole (min ${minDist.toFixed(3)}mm)`,
          elementIds: [via.id],
          location: via.position,
        });
      }
    }
  }

  // --- Component checks ---
  for (const comp of components) {
    // Check component center is inside board
    if (!isInsidePolygon(comp.position, boardOutline.points)) {
      violations.push({
        type: 'outside_board',
        severity: 'error',
        message: `${comp.reference} is placed outside board outline`,
        elementIds: [comp.id],
        location: comp.position,
      });
    }

    // Check each pad for edge clearance, board boundary, keep-out, and mounting hole clearance
    for (const pad of comp.footprint.pads) {
      const padX = comp.position.x + pad.centerX;
      const padY = comp.position.y + pad.centerY;
      const padPos = { x: padX, y: padY };

      // Pad inside board?
      if (!isInsidePolygon(padPos, boardOutline.points)) {
        violations.push({
          type: 'outside_board',
          severity: 'error',
          message: `Pad ${comp.reference}.${pad.number} is outside board outline`,
          elementIds: [comp.id],
          location: padPos,
        });
        continue;
      }

      // Pad to edge clearance
      const edgeDist = minDistToPolygonEdge(padPos, boardOutline.points);
      const padRadius = Math.max(pad.width, pad.height) / 2;
      if (edgeDist - padRadius < rules.copperToEdge) {
        violations.push({
          type: 'copper_edge',
          severity: 'error',
          message: `Pad ${comp.reference}.${pad.number} is ${(edgeDist - padRadius).toFixed(3)}mm from board edge (min ${rules.copperToEdge}mm)`,
          elementIds: [comp.id],
          location: padPos,
        });
      }

      // Pad in keep-out zone?
      for (const zone of boardOutline.keepOutZones) {
        if (isInsidePolygon(padPos, zone)) {
          violations.push({
            type: 'keepout',
            severity: 'error',
            message: `Pad ${comp.reference}.${pad.number} is in a keep-out zone`,
            elementIds: [comp.id],
            location: padPos,
          });
        }
      }

      // Pad vs mounting holes
      for (const mh of boardOutline.mountingHoles) {
        const d = dist(padX, padY, mh.position.x, mh.position.y);
        const minDist = padRadius + mh.padDiameter / 2 + rules.minClearance;
        if (d < minDist) {
          violations.push({
            type: 'mounting_hole_clearance',
            severity: 'error',
            message: `Pad ${comp.reference}.${pad.number} is ${d.toFixed(3)}mm from mounting hole (min ${minDist.toFixed(3)}mm)`,
            elementIds: [comp.id],
            location: padPos,
          });
        }
      }
    }

    // Check component courtyard fits inside board
    const cy = comp.footprint.courtyard;
    const corners = [
      { x: comp.position.x + cy.x, y: comp.position.y + cy.y },
      { x: comp.position.x + cy.x + cy.width, y: comp.position.y + cy.y },
      { x: comp.position.x + cy.x + cy.width, y: comp.position.y + cy.y + cy.height },
      { x: comp.position.x + cy.x, y: comp.position.y + cy.y + cy.height },
    ];
    for (const corner of corners) {
      if (!isInsidePolygon(corner, boardOutline.points)) {
        violations.push({
          type: 'outside_board',
          severity: 'warning',
          message: `${comp.reference} courtyard extends outside board outline`,
          elementIds: [comp.id],
          location: corner,
        });
        break; // one warning per component
      }
    }
  }

  // --- Track-to-track spacing ---
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

  // --- Board size sanity (JLCPCB limits: 5x5mm to 400x500mm) ---
  if (boardOutline.width < 5 || boardOutline.height < 5) {
    violations.push({
      type: 'outside_board',
      severity: 'warning',
      message: `Board is very small (${boardOutline.width}x${boardOutline.height}mm). JLCPCB minimum is 5x5mm.`,
      elementIds: [],
      location: { x: 0, y: 0 },
    });
  }
  if (boardOutline.width > 400 || boardOutline.height > 500) {
    violations.push({
      type: 'outside_board',
      severity: 'error',
      message: `Board exceeds JLCPCB maximum size (400x500mm). Current: ${boardOutline.width}x${boardOutline.height}mm.`,
      elementIds: [],
      location: { x: 0, y: 0 },
    });
  }

  return violations;
}

// Point-in-polygon (ray casting)
function isInsidePolygon(point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean {
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

// Minimum distance from point to polygon edge
function minDistToPolygonEdge(point: { x: number; y: number }, polygon: { x: number; y: number }[]): number {
  let minD = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const d = distPointToSegment(point.x, point.y, polygon[i].x, polygon[i].y, polygon[j].x, polygon[j].y);
    if (d < minD) minD = d;
  }
  return minD;
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
