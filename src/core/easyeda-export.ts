// EasyEDA Standard Edition JSON format exporter
// Reference: https://docs.easyeda.com/en/DocumentFormat/EasyEDA-Document-Format/
//
// EasyEDA uses a compressed ASCII format where shape attributes are
// joined with ~ as delimiter. Units are 10mil (1 unit = 10mil = 0.254mm).

import type {
  Project, SchematicComponent, Wire, NetLabel, PowerFlag, Junction,
  PCBComponent, Track, Via, CopperZone, Pad, Footprint, Pin, Point,
} from './types';

const MM_TO_EASYEDA = 1 / 0.254;  // 1mm = ~3.937 EasyEDA units (10mil)
const MIL_TO_EASYEDA = 0.1;       // 1mil = 0.1 EasyEDA units

// Layer mapping to EasyEDA layer IDs
const LAYER_MAP: Record<string, number> = {
  top_copper: 1,
  bottom_copper: 2,
  top_silkscreen: 3,
  bottom_silkscreen: 4,
  top_paste: 5,
  bottom_paste: 6,
  top_soldermask: 7,
  bottom_soldermask: 8,
  edge_cuts: 10,
  inner1: 21,
  inner2: 22,
};

function mmToEE(mm: number): number {
  return Math.round(mm * MM_TO_EASYEDA * 100) / 100;
}

function milToEE(mil: number): number {
  return Math.round(mil * MIL_TO_EASYEDA * 100) / 100;
}

let idCounter = 1;
function eeId(): string {
  return `gge${idCounter++}`;
}

// ============================================================
// Schematic Export
// ============================================================

export function exportSchematicJSON(project: Project): object {
  idCounter = 1;
  const shapes: string[] = [];

  for (const comp of project.schematic.components) {
    shapes.push(exportSchematicComponent(comp));
  }

  for (const wire of project.schematic.wires) {
    shapes.push(exportWire(wire));
  }

  for (const label of project.schematic.netLabels) {
    shapes.push(exportNetLabel(label));
  }

  for (const junction of project.schematic.junctions) {
    shapes.push(exportJunction(junction));
  }

  for (const flag of project.schematic.powerFlags) {
    shapes.push(exportPowerFlag(flag));
  }

  return {
    head: `1~1.0~Author\`Claude PCB Designer\``,
    canvas: `CA~1200~1200~#FFFFFF~yes~#CCCCCC~10~1200~1200~line~10~pixel~5~400~300`,
    shape: shapes,
    BBox: { x: 0, y: 0, width: 1200, height: 1200 },
    itemOrder: shapes.map(() => eeId()),
  };
}

function exportSchematicComponent(comp: SchematicComponent): string {
  const id = eeId();
  const x = milToEE(comp.position.x);
  const y = milToEE(comp.position.y);

  // Build sub-shapes for pins
  const subShapes: string[] = [];

  // Component body rectangle
  const bodyW = 6;
  const bodyH = Math.max(4, (comp.pins?.length ?? 2) * 2);
  subShapes.push(`R~${x - bodyW / 2}~${y - bodyH / 2}~0~0~${bodyW}~${bodyH}~#0000FF~1~0~none~${eeId()}`);

  // Reference text
  subShapes.push(`T~L~${x}~${y - bodyH / 2 - 1}~0~#0000FF~${comp.reference}~~0.8~${eeId()}`);

  // Value text
  subShapes.push(`T~L~${x}~${y + bodyH / 2 + 1}~0~#FF0000~${comp.value}~~0.6~${eeId()}`);

  // Pins
  for (const pin of comp.pins ?? []) {
    const px = milToEE(pin.position.x) + x;
    const py = milToEE(pin.position.y) + y;
    subShapes.push(
      `P~show~0~${pin.number}~${px}~${py}~~${eeId()}` +
      `^^${px}~${py}` +
      `^^M ${px} ${py} h ${pin.orientation === 0 ? 20 : -20}~#880000` +
      `^^0~${px + 20}~${py}~0~${pin.name}~${eeId()}` +
      `^^0~${px + 10}~${py}~0~${pin.number}~${eeId()}`
    );
  }

  return `LIB~${x}~${y}~package\`${comp.value}\`~${comp.rotation}~~${id}~1#@$${subShapes.join('#@$')}`;
}

function exportWire(wire: Wire): string {
  const points = wire.points.map(p => `${milToEE(p.x)} ${milToEE(p.y)}`).join(' ');
  return `W~${points}~#008800~1~0~none~${eeId()}`;
}

function exportNetLabel(label: NetLabel): string {
  const x = milToEE(label.position.x);
  const y = milToEE(label.position.y);
  return `N~${x}~${y}~${label.rotation}~#0000FF~${label.name}~${eeId()}~start~${x}~${y}~Times New Roman~`;
}

function exportJunction(junction: Junction): string {
  const x = milToEE(junction.position.x);
  const y = milToEE(junction.position.y);
  return `J~${x}~${y}~2.5~#CC0000~${eeId()}`;
}

function exportPowerFlag(flag: PowerFlag): string {
  const x = milToEE(flag.position.x);
  const y = milToEE(flag.position.y);
  const symbol = flag.type === 'ground' ? 'GND' : 'VCC';
  return `F~part_netLabel_gnD~${x}~${y}~${flag.rotation}~${symbol}~${flag.name}~${eeId()}~0~~#000000`;
}

// ============================================================
// PCB Export
// ============================================================

export function exportPCBJSON(project: Project): object {
  idCounter = 1;
  const shapes: string[] = [];

  // Board outline
  const outlinePoints = project.pcb.boardOutline.points
    .map(p => `${mmToEE(p.x)} ${mmToEE(p.y)}`)
    .join(' ');
  shapes.push(`TRACK~1~10~${''/*no net*/}~${outlinePoints}~${eeId()}`);

  // Components (footprints)
  for (const comp of project.pcb.components) {
    shapes.push(exportPCBComponent(comp));
  }

  // Tracks
  for (const track of project.pcb.tracks) {
    shapes.push(exportTrack(track, project));
  }

  // Vias
  for (const via of project.pcb.vias) {
    shapes.push(exportVia(via, project));
  }

  // Copper zones
  for (const zone of project.pcb.copperZones) {
    shapes.push(exportCopperZone(zone, project));
  }

  // DRC rules
  const rules = project.designRules;
  const drcShape = `DRCRULE~${mmToEE(rules.minClearance)}~${mmToEE(rules.minTraceWidth)}~${mmToEE(rules.minViaDrill)}~${eeId()}`;
  shapes.push(drcShape);

  return {
    head: `3~1.0~Author\`Claude PCB Designer\``,
    canvas: `CA~2400~2400~#000000~yes~#FFFFFF~10~1200~1200~line~1~mil~1~45~visible~0.5~400~300`,
    shape: shapes,
    layers: [
      `1~TopLayer~#FF0000~true~true~true`,
      `2~BottomLayer~#0000FF~true~false~true`,
      `3~TopSilkLayer~#FFCC00~true~false~true`,
      `4~BottomSilkLayer~#66CC33~true~false~true`,
      `5~TopPasteMaskLayer~#808080~false~false~true`,
      `6~BottomPasteMaskLayer~#800000~false~false~true`,
      `7~TopSolderMaskLayer~#800080~true~false~true`,
      `8~BottomSolderMaskLayer~#AA00AA~true~false~true`,
      `10~BoardOutLine~#FFFF00~true~false~true`,
      `11~Multi-Layer~#C0C0C0~true~false~true`,
      `12~Document~#FFFFFF~true~false~true`,
    ],
    BBox: {
      x: 0,
      y: 0,
      width: mmToEE(project.pcb.boardOutline.width),
      height: mmToEE(project.pcb.boardOutline.height),
    },
    itemOrder: shapes.map(() => eeId()),
  };
}

function exportPCBComponent(comp: PCBComponent): string {
  const id = eeId();
  const cx = mmToEE(comp.position.x);
  const cy = mmToEE(comp.position.y);
  const layer = comp.layer === 'top' ? 1 : 2;

  const subShapes: string[] = [];

  // Reference text
  subShapes.push(
    `TEXT~L~${cx}~${cy - mmToEE(comp.footprint.courtyard.height / 2 + 1)}~${layer === 1 ? 3 : 4}~0.8~0~none~${comp.rotation}~0~${comp.reference}~${eeId()}`
  );

  // Pads
  for (const pad of comp.footprint.pads) {
    subShapes.push(exportPad(pad, comp));
  }

  // Silkscreen lines
  for (const line of comp.footprint.lines) {
    const silkLayer = comp.layer === 'top' ? 3 : 4;
    const points = line.points
      .map(p => `${cx + mmToEE(p.x)} ${cy + mmToEE(p.y)}`)
      .join(' ');
    subShapes.push(`TRACK~${mmToEE(line.width)}~${silkLayer}~~${points}~${eeId()}`);
  }

  return `LIB~${cx}~${cy}~package\`${comp.footprint.name}\`~${comp.rotation}~~${id}~${layer}#@$${subShapes.join('#@$')}`;
}

function exportPad(pad: Pad, comp: PCBComponent): string {
  const cx = mmToEE(comp.position.x + pad.centerX);
  const cy = mmToEE(comp.position.y + pad.centerY);
  const w = mmToEE(pad.width);
  const h = mmToEE(pad.height);
  const shape = pad.shape === 'rect' ? 'RECT' : pad.shape === 'circle' ? 'ELLIPSE' : 'OVAL';
  const layer = pad.layer === 'through' ? 11 : (comp.layer === 'top' ? 1 : 2);
  const holeR = pad.holeWidth > 0 ? mmToEE(pad.holeWidth / 2) : 0;

  // PAD~shape~cx~cy~width~height~layer~net~number~holeRadius~points~rotation~id
  const points = `${cx} ${cy - h / 2} ${cx} ${cy + h / 2}`;
  return `PAD~${shape}~${cx}~${cy}~${w}~${h}~${layer}~~${pad.number}~${holeR}~${points}~${pad.rotation + comp.rotation}~${eeId()}~${mmToEE(pad.holeHeight / 2)}~~N`;
}

function exportTrack(track: Track, project: Project): string {
  const layer = LAYER_MAP[track.layer] ?? 1;
  const netName = project.schematic.nets.find(n => n.id === track.netId)?.name ?? '';
  const points = track.points.map(p => `${mmToEE(p.x)} ${mmToEE(p.y)}`).join(' ');
  const width = mmToEE(track.width);
  return `TRACK~${width}~${layer}~${netName}~${points}~${eeId()}`;
}

function exportVia(via: Via, project: Project): string {
  const netName = project.schematic.nets.find(n => n.id === via.netId)?.name ?? '';
  const cx = mmToEE(via.position.x);
  const cy = mmToEE(via.position.y);
  const diameter = mmToEE(via.diameter);
  const holeR = mmToEE(via.drill / 2);
  return `VIA~${cx}~${cy}~${diameter}~${netName}~${holeR}~${eeId()}`;
}

function exportCopperZone(zone: CopperZone, project: Project): string {
  const layer = LAYER_MAP[zone.layer] ?? 1;
  const netName = project.schematic.nets.find(n => n.id === zone.netId)?.name ?? '';
  const points = zone.outline.map(p => `${mmToEE(p.x)} ${mmToEE(p.y)}`).join(' ');
  const clearance = mmToEE(zone.clearance);
  const fillStyle = 'solid';
  const thermalType = zone.thermalRelief ? 'spoke' : 'direct';
  return `COPPERAREA~2px~${layer}~${netName}~${points}~${clearance}~${fillStyle}~${eeId()}~${thermalType}~yes~`;
}

// ============================================================
// Full Project Export (ZIP-ready structure)
// ============================================================

export function exportProjectForEasyEDA(project: Project): {
  schematic: object;
  pcb: object;
  bom: string;
} {
  const schematic = exportSchematicJSON(project);
  const pcb = exportPCBJSON(project);

  // Generate BOM CSV
  const bomLines = [
    'Comment,Designator,Footprint,LCSC Part Number',
    ...project.bom.map(entry =>
      `"${entry.value}","${entry.reference.join(',')}","${entry.footprint}","${entry.lcsc}"`
    ),
  ];

  return {
    schematic,
    pcb,
    bom: bomLines.join('\n'),
  };
}
