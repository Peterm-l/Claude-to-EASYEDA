// ============================================================
// Core types for the PCB design tool
// ============================================================

// --- Geometry ---

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Component Pin ---

export type PinElectricType =
  | 'input'
  | 'output'
  | 'bidirectional'
  | 'power_in'
  | 'power_out'
  | 'passive'
  | 'open_collector'
  | 'open_emitter'
  | 'unconnected';

export interface Pin {
  id: string;
  number: string;        // Pin number as marked on package (e.g., "1", "A3")
  name: string;          // Pin function name (e.g., "VCC", "GND", "PA0")
  electricType: PinElectricType;
  position: Point;       // Relative to component origin
  orientation: number;   // Degrees: 0=right, 90=down, 180=left, 270=up
  length: number;        // Pin line length in mils
}

// --- Footprint / Package ---

export type PadShape = 'rect' | 'oval' | 'circle' | 'polygon';

export interface Pad {
  id: string;
  number: string;         // Must match Pin.number
  shape: PadShape;
  centerX: number;        // Relative to footprint origin (mm)
  centerY: number;
  width: number;          // mm
  height: number;         // mm
  rotation: number;       // degrees
  holeWidth: number;      // 0 for SMD pads
  holeHeight: number;     // 0 for SMD pads
  layer: 'top' | 'bottom' | 'through';
  solderMaskExpansion: number;  // mm, typically 0.05
  pasteExpansion: number;       // mm
}

export interface FootprintLine {
  layer: 'silkscreen_top' | 'silkscreen_bottom' | 'fabrication' | 'courtyard';
  points: Point[];        // mm, relative to origin
  width: number;          // mm
}

export interface Footprint {
  id: string;
  name: string;           // e.g., "SOIC-8", "0805", "QFP-48"
  pads: Pad[];
  lines: FootprintLine[]; // Silkscreen/courtyard outlines
  courtyard: Bounds;      // Bounding box in mm
  origin: Point;          // Reference point
}

// --- JLCPCB Part ---

export interface JLCPCBPart {
  lcsc: string;           // LCSC part number, e.g., "C12345"
  mfr: string;            // Manufacturer part number
  manufacturer: string;
  description: string;
  package: string;         // Package name, e.g., "0805"
  category: string;
  subcategory: string;
  stock: number;
  price: number;           // USD per unit (at qty 1)
  isBasic: boolean;        // JLCPCB basic part (cheapest assembly)
  isPreferred: boolean;    // JLCPCB preferred part
  datasheet: string;       // URL
  footprint?: Footprint;   // Resolved footprint
  pins?: Pin[];            // Resolved pin mapping
}

// --- Schematic ---

export interface SchematicComponent {
  id: string;
  partId: string;           // Reference to JLCPCBPart.lcsc
  reference: string;        // e.g., "R1", "U1", "C3"
  value: string;            // e.g., "10k", "100nF", "STM32F103"
  position: Point;          // Position on schematic canvas (mils)
  rotation: number;         // degrees
  mirror: boolean;
  pins: Pin[];              // Resolved pins with positions
  properties: Record<string, string>;
}

export interface Wire {
  id: string;
  points: Point[];          // List of vertices (mils)
  netId: string;
}

export interface NetLabel {
  id: string;
  name: string;             // e.g., "VCC", "GND", "SDA"
  position: Point;
  rotation: number;
  netId: string;
}

export interface Junction {
  id: string;
  position: Point;
  netId: string;
}

export interface PowerFlag {
  id: string;
  name: string;             // e.g., "VCC", "GND", "+3V3"
  type: 'power' | 'ground';
  position: Point;
  rotation: number;
  netId: string;
}

export interface Net {
  id: string;
  name: string;
}

export interface Schematic {
  components: SchematicComponent[];
  wires: Wire[];
  netLabels: NetLabel[];
  junctions: Junction[];
  powerFlags: PowerFlag[];
  nets: Net[];
}

// --- PCB Layout ---

export type PCBLayer =
  | 'top_copper'
  | 'bottom_copper'
  | 'top_silkscreen'
  | 'bottom_silkscreen'
  | 'top_soldermask'
  | 'bottom_soldermask'
  | 'top_paste'
  | 'bottom_paste'
  | 'edge_cuts'
  | 'inner1'
  | 'inner2';

export interface PCBComponent {
  id: string;
  schematicRef: string;     // Links to SchematicComponent.id
  partId: string;           // LCSC number
  reference: string;
  footprint: Footprint;
  position: Point;          // mm on PCB
  rotation: number;
  layer: 'top' | 'bottom';
  locked: boolean;
}

export interface Track {
  id: string;
  netId: string;
  layer: PCBLayer;
  width: number;            // mm
  points: Point[];          // mm
}

export interface Via {
  id: string;
  netId: string;
  position: Point;          // mm
  diameter: number;         // mm (outer)
  drill: number;            // mm (hole)
  startLayer: PCBLayer;
  endLayer: PCBLayer;
}

export interface CopperZone {
  id: string;
  netId: string;
  layer: PCBLayer;
  outline: Point[];         // mm
  clearance: number;        // mm
  minWidth: number;         // mm
  thermalRelief: boolean;
  thermalGap: number;       // mm
  thermalWidth: number;     // mm
  priority: number;
}

export interface BoardOutline {
  points: Point[];          // mm, closed polygon
  width: number;
  height: number;
}

export interface PCBLayout {
  components: PCBComponent[];
  tracks: Track[];
  vias: Via[];
  copperZones: CopperZone[];
  boardOutline: BoardOutline;
  layers: PCBLayer[];
  layerCount: number;
}

// --- Project ---

export interface DesignRules {
  minTraceWidth: number;       // mm
  minTraceSpacing: number;     // mm
  minViaDrill: number;         // mm
  minViaDiameter: number;      // mm
  minAnnularRing: number;      // mm
  minClearance: number;        // mm
  copperToEdge: number;        // mm
  defaultTraceWidth: number;   // mm
  defaultViaDrill: number;     // mm
  defaultViaDiameter: number;  // mm
}

export interface Project {
  name: string;
  version: string;
  description: string;
  created: string;
  modified: string;
  designRules: DesignRules;
  schematic: Schematic;
  pcb: PCBLayout;
  parts: JLCPCBPart[];       // All parts used in design
  bom: BOMEntry[];
}

export interface BOMEntry {
  reference: string[];         // e.g., ["R1", "R2", "R3"]
  value: string;
  footprint: string;
  lcsc: string;
  quantity: number;
  description: string;
  unitPrice: number;
  inStock: boolean;
}

// --- Editor State ---

export type EditorMode = 'schematic' | 'pcb';

export type Tool =
  | 'select'
  | 'pan'
  | 'place_component'
  | 'wire'
  | 'net_label'
  | 'power_flag'
  | 'delete'
  | 'track'
  | 'via'
  | 'copper_zone'
  | 'measure';

export interface EditorState {
  mode: EditorMode;
  activeTool: Tool;
  zoom: number;
  panOffset: Point;
  selectedIds: string[];
  hoveredId: string | null;
  gridSize: number;          // mils for schematic, mm for PCB
  snapToGrid: boolean;
  activeLayer: PCBLayer;
  showGrid: boolean;
}
