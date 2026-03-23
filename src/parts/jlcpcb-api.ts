import type { JLCPCBPart, Footprint, Pin, Pad, PadShape, PinElectricType } from '../core/types';

const JLCSEARCH_BASE = 'https://jlcsearch.tscircuit.com';

export interface SearchOptions {
  query?: string;
  category?: string;
  subcategory?: string;
  package?: string;
  limit?: number;
  inStockOnly?: boolean;
  basicOnly?: boolean;
  preferredOnly?: boolean;
}

interface JLCSearchComponent {
  lcsc: number;
  mfr: string;
  package: string;
  description: string;
  stock: number;
  price: number | string;
  manufacturer?: string;
  category?: string;
  subcategory?: string;
  basic?: boolean;
  preferred?: boolean;
  datasheet?: string;
  extra?: Record<string, unknown>;
}

export async function searchParts(options: SearchOptions): Promise<JLCPCBPart[]> {
  const params = new URLSearchParams();
  if (options.query) params.set('search', options.query);
  if (options.package) params.set('package', options.package);
  if (options.subcategory) params.set('subcategory_name', options.subcategory);
  params.set('full', 'true');
  if (options.limit) params.set('limit', String(options.limit));

  const url = `${JLCSEARCH_BASE}/components/list.json?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Parts search failed: ${resp.status}`);

  const data = await resp.json() as { components: JLCSearchComponent[] };
  let parts = (data.components ?? []).map(mapToPart);

  if (options.inStockOnly) parts = parts.filter(p => p.stock > 0);
  if (options.basicOnly) parts = parts.filter(p => p.isBasic);
  if (options.preferredOnly) parts = parts.filter(p => p.isPreferred);

  return parts;
}

export async function searchByText(query: string, limit: number = 20): Promise<JLCPCBPart[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit), full: 'true' });
  const url = `${JLCSEARCH_BASE}/api/search?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Text search failed: ${resp.status}`);

  const data = await resp.json() as { components: JLCSearchComponent[] };
  return (data.components ?? []).map(mapToPart);
}

export async function getCategories(): Promise<{ name: string; subcategories: string[] }[]> {
  const url = `${JLCSEARCH_BASE}/categories/list.json`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Categories fetch failed: ${resp.status}`);

  const data = await resp.json();
  return data.categories ?? [];
}

export async function searchResistors(options: {
  resistance?: string;
  package?: string;
  limit?: number;
}): Promise<JLCPCBPart[]> {
  const params = new URLSearchParams({ full: 'true' });
  if (options.resistance) params.set('resistance', options.resistance);
  if (options.package) params.set('package', options.package);
  if (options.limit) params.set('limit', String(options.limit));

  const url = `${JLCSEARCH_BASE}/resistors/list.json?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Resistor search failed: ${resp.status}`);

  const data = await resp.json() as { components: JLCSearchComponent[] };
  return (data.components ?? []).map(mapToPart);
}

export async function searchCapacitors(options: {
  capacitance?: string;
  package?: string;
  limit?: number;
}): Promise<JLCPCBPart[]> {
  const params = new URLSearchParams({ full: 'true' });
  if (options.capacitance) params.set('capacitance', options.capacitance);
  if (options.package) params.set('package', options.package);
  if (options.limit) params.set('limit', String(options.limit));

  const url = `${JLCSEARCH_BASE}/capacitors/list.json?${params}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Capacitor search failed: ${resp.status}`);

  const data = await resp.json() as { components: JLCSearchComponent[] };
  return (data.components ?? []).map(mapToPart);
}

function mapToPart(c: JLCSearchComponent): JLCPCBPart {
  const part: JLCPCBPart = {
    lcsc: `C${c.lcsc}`,
    mfr: c.mfr ?? '',
    manufacturer: c.manufacturer ?? '',
    description: c.description ?? '',
    package: c.package ?? '',
    category: c.category ?? '',
    subcategory: c.subcategory ?? '',
    stock: c.stock ?? 0,
    price: typeof c.price === 'string' ? parseFloat(c.price) || 0 : c.price ?? 0,
    isBasic: c.basic ?? false,
    isPreferred: c.preferred ?? false,
    datasheet: c.datasheet ?? '',
    footprint: generateFootprintFromPackage(c.package),
    pins: generatePinsFromPart(c),
  };
  return part;
}

// Generate pin data based on package type and description
function generatePinsFromPart(c: JLCSearchComponent): Pin[] {
  const pkg = (c.package ?? '').toUpperCase();
  const desc = (c.description ?? '').toLowerCase();
  const mfr = (c.mfr ?? '').toUpperCase();

  // 2-pin passives (resistors, capacitors, inductors)
  if (pkg.match(/^0[24680]/) || desc.includes('resistor') || desc.includes('capacitor') ||
      desc.includes('inductor') || desc.includes('fuse')) {
    return [
      makePin('1', '1', 'passive', { x: -60, y: 0 }, 0),
      makePin('2', '2', 'passive', { x: 60, y: 0 }, 180),
    ];
  }

  // Diodes / LEDs
  if (desc.includes('diode') || desc.includes(' led ') || desc.includes('rectifier') ||
      desc.includes('schottky') || desc.includes('zener')) {
    return [
      makePin('1', 'A', 'passive', { x: -60, y: 0 }, 0),
      makePin('2', 'K', 'passive', { x: 60, y: 0 }, 180),
    ];
  }

  // SOT-23 3-pin transistors
  if ((pkg.includes('SOT-23') || pkg.includes('SOT23')) && !pkg.match(/[56]/)) {
    if (desc.includes('mosfet') || desc.includes('mos ')) {
      return [
        makePin('1', 'G', 'input', { x: -80, y: 25 }, 0),
        makePin('2', 'S', 'passive', { x: -80, y: -25 }, 0),
        makePin('3', 'D', 'passive', { x: 80, y: 0 }, 180),
      ];
    }
    return [
      makePin('1', 'B', 'input', { x: -80, y: 25 }, 0),
      makePin('2', 'E', 'passive', { x: -80, y: -25 }, 0),
      makePin('3', 'C', 'passive', { x: 80, y: 0 }, 180),
    ];
  }

  // SOT-23-5 / SOT-23-6 (LDOs, etc.)
  if (pkg.match(/SOT-?23-?5/i)) {
    if (desc.includes('regulator') || desc.includes('ldo')) {
      return [
        makePin('1', 'IN', 'power_in', { x: -80, y: -25 }, 0),
        makePin('2', 'GND', 'power_in', { x: -80, y: 25 }, 0),
        makePin('3', 'EN', 'input', { x: -80, y: 75 }, 0),
        makePin('4', 'NC/BP', 'passive', { x: 80, y: 25 }, 180),
        makePin('5', 'OUT', 'output', { x: 80, y: -25 }, 180),
      ];
    }
  }

  // SOIC-8 common ICs
  if (pkg.match(/SO-?8|SOIC-?8|SOP-?8/i)) {
    if (desc.includes('555') || mfr.includes('555')) {
      return [
        makePin('1', 'GND', 'power_in', { x: -80, y: -75 }, 0),
        makePin('2', 'TRIG', 'input', { x: -80, y: -25 }, 0),
        makePin('3', 'OUT', 'output', { x: -80, y: 25 }, 0),
        makePin('4', 'RESET', 'input', { x: -80, y: 75 }, 0),
        makePin('5', 'CTRL', 'input', { x: 80, y: 75 }, 180),
        makePin('6', 'THR', 'input', { x: 80, y: 25 }, 180),
        makePin('7', 'DIS', 'output', { x: 80, y: -25 }, 180),
        makePin('8', 'VCC', 'power_in', { x: 80, y: -75 }, 180),
      ];
    }
    if (desc.includes('op-amp') || desc.includes('operational amplifier')) {
      return [
        makePin('1', 'OUT A', 'output', { x: -80, y: -75 }, 0),
        makePin('2', 'IN- A', 'input', { x: -80, y: -25 }, 0),
        makePin('3', 'IN+ A', 'input', { x: -80, y: 25 }, 0),
        makePin('4', 'V-', 'power_in', { x: -80, y: 75 }, 0),
        makePin('5', 'IN+ B', 'input', { x: 80, y: 75 }, 180),
        makePin('6', 'IN- B', 'input', { x: 80, y: 25 }, 180),
        makePin('7', 'OUT B', 'output', { x: 80, y: -25 }, 180),
        makePin('8', 'V+', 'power_in', { x: 80, y: -75 }, 180),
      ];
    }
    if (desc.includes('uart') || desc.includes('rs232') || desc.includes('ch340') || desc.includes('cp210')) {
      return generateNumberedPins(8);
    }
  }

  // SOT-223 / SOT-89 voltage regulators
  if (pkg.match(/SOT-?223|SOT-?89/i)) {
    if (desc.includes('regulator') || desc.includes('ldo') || mfr.match(/AMS1117|LM1117|AP2112/i)) {
      return [
        makePin('1', 'GND', 'power_in', { x: -80, y: 25 }, 0),
        makePin('2', 'OUT', 'output', { x: 0, y: -50 }, 90),
        makePin('3', 'IN', 'power_in', { x: 80, y: 25 }, 180),
        makePin('4', 'OUT', 'output', { x: 0, y: 50 }, 270),
      ];
    }
  }

  // Generic: count pins from package name
  const pinMatch = pkg.match(/(\d+)/);
  if (pinMatch) {
    const count = parseInt(pinMatch[1]);
    if (count >= 2 && count <= 200) {
      return generateNumberedPins(count);
    }
  }

  return generateNumberedPins(2);
}

function generateNumberedPins(count: number): Pin[] {
  const pins: Pin[] = [];
  const halfCount = Math.ceil(count / 2);
  const spacing = 50;

  for (let i = 0; i < halfCount; i++) {
    pins.push(makePin(
      String(i + 1), String(i + 1), 'passive',
      { x: -80, y: -((halfCount - 1) * spacing) / 2 + i * spacing }, 0
    ));
  }
  for (let i = 0; i < count - halfCount; i++) {
    const pinNum = count - i;
    pins.push(makePin(
      String(pinNum), String(pinNum), 'passive',
      { x: 80, y: -((count - halfCount - 1) * spacing) / 2 + i * spacing }, 180
    ));
  }
  return pins;
}

function makePin(number: string, name: string, electricType: PinElectricType, position: { x: number; y: number }, orientation: number): Pin {
  return {
    id: `pin_${number}`,
    number,
    name,
    electricType,
    position,
    orientation,
    length: 30,
  };
}

// Generate approximate footprint geometry from common package names
export function generateFootprintFromPackage(packageName: string): Footprint | undefined {
  if (!packageName) return undefined;

  const pkg = packageName.toUpperCase();

  // Common SMD passive packages (metric/imperial)
  const smdSizes: Record<string, { w: number; h: number; padW: number; padH: number; padSpacing: number }> = {
    '0201': { w: 0.6, h: 0.3, padW: 0.3, padH: 0.3, padSpacing: 0.5 },
    '0402': { w: 1.0, h: 0.5, padW: 0.4, padH: 0.5, padSpacing: 0.9 },
    '0603': { w: 1.6, h: 0.8, padW: 0.5, padH: 0.8, padSpacing: 1.4 },
    '0805': { w: 2.0, h: 1.25, padW: 0.7, padH: 1.25, padSpacing: 1.8 },
    '1206': { w: 3.2, h: 1.6, padW: 0.9, padH: 1.6, padSpacing: 2.8 },
    '1210': { w: 3.2, h: 2.5, padW: 0.9, padH: 2.5, padSpacing: 2.8 },
    '2010': { w: 5.0, h: 2.5, padW: 1.0, padH: 2.5, padSpacing: 4.4 },
    '2512': { w: 6.3, h: 3.2, padW: 1.0, padH: 3.2, padSpacing: 5.6 },
  };

  // Check for common 2-pad SMD packages
  for (const [size, dims] of Object.entries(smdSizes)) {
    if (pkg.includes(size)) {
      return create2PadFootprint(packageName, dims);
    }
  }

  // SOIC packages
  const soicMatch = pkg.match(/SOIC[-_]?(\d+)/);
  if (soicMatch) {
    return createSOICFootprint(packageName, parseInt(soicMatch[1]));
  }

  // SOT-23 variants
  if (pkg.includes('SOT-23') || pkg.includes('SOT23')) {
    const pinCount = pkg.includes('5') ? 5 : pkg.includes('6') ? 6 : 3;
    return createSOT23Footprint(packageName, pinCount);
  }

  // QFP packages
  const qfpMatch = pkg.match(/[TL]?QFP[-_]?(\d+)/);
  if (qfpMatch) {
    return createQFPFootprint(packageName, parseInt(qfpMatch[1]));
  }

  // QFN/DFN packages
  const qfnMatch = pkg.match(/[QD]FN[-_]?(\d+)/);
  if (qfnMatch) {
    return createQFNFootprint(packageName, parseInt(qfnMatch[1]));
  }

  return undefined;
}

function create2PadFootprint(
  name: string,
  dims: { w: number; h: number; padW: number; padH: number; padSpacing: number }
): Footprint {
  const halfSpacing = dims.padSpacing / 2;
  return {
    id: `fp_${name}`,
    name,
    pads: [
      createPad('1', -halfSpacing, 0, dims.padW, dims.padH, 'rect'),
      createPad('2', halfSpacing, 0, dims.padW, dims.padH, 'rect'),
    ],
    lines: [
      {
        layer: 'silkscreen_top',
        points: [
          { x: -dims.w / 2, y: -dims.h / 2 },
          { x: dims.w / 2, y: -dims.h / 2 },
          { x: dims.w / 2, y: dims.h / 2 },
          { x: -dims.w / 2, y: dims.h / 2 },
          { x: -dims.w / 2, y: -dims.h / 2 },
        ],
        width: 0.12,
      },
    ],
    courtyard: {
      x: -dims.w / 2 - 0.25,
      y: -dims.h / 2 - 0.25,
      width: dims.w + 0.5,
      height: dims.h + 0.5,
    },
    origin: { x: 0, y: 0 },
  };
}

function createSOICFootprint(name: string, pinCount: number): Footprint {
  const pinsPerSide = pinCount / 2;
  const pitch = 1.27;  // mm
  const padW = 0.6;
  const padH = 1.5;
  const bodyW = 3.9;
  const bodyH = pinsPerSide * pitch;
  const padCenterX = bodyW / 2 + padH / 2 - 0.3;

  const pads: Pad[] = [];
  for (let i = 0; i < pinsPerSide; i++) {
    const y = -bodyH / 2 + pitch / 2 + i * pitch;
    pads.push(createPad(String(i + 1), -padCenterX, y, padH, padW, i === 0 ? 'rect' : 'oval'));
    pads.push(createPad(String(pinCount - i), padCenterX, y, padH, padW, 'oval'));
  }

  return {
    id: `fp_${name}`,
    name,
    pads,
    lines: [{
      layer: 'silkscreen_top',
      points: [
        { x: -bodyW / 2, y: -bodyH / 2 },
        { x: bodyW / 2, y: -bodyH / 2 },
        { x: bodyW / 2, y: bodyH / 2 },
        { x: -bodyW / 2, y: bodyH / 2 },
        { x: -bodyW / 2, y: -bodyH / 2 },
      ],
      width: 0.15,
    }],
    courtyard: {
      x: -padCenterX - padH / 2 - 0.25,
      y: -bodyH / 2 - 0.25,
      width: 2 * (padCenterX + padH / 2) + 0.5,
      height: bodyH + 0.5,
    },
    origin: { x: 0, y: 0 },
  };
}

function createSOT23Footprint(name: string, pinCount: number): Footprint {
  const pads: Pad[] = [];
  const padW = 0.6;
  const padH = 0.7;

  if (pinCount === 3) {
    pads.push(createPad('1', -0.95, 1.1, padW, padH, 'rect'));
    pads.push(createPad('2', 0.95, 1.1, padW, padH, 'oval'));
    pads.push(createPad('3', 0, -1.1, padW, padH, 'oval'));
  } else if (pinCount === 5) {
    pads.push(createPad('1', -0.95, 1.1, padW, padH, 'rect'));
    pads.push(createPad('2', 0, 1.1, padW, padH, 'oval'));
    pads.push(createPad('3', 0.95, 1.1, padW, padH, 'oval'));
    pads.push(createPad('4', 0.95, -1.1, padW, padH, 'oval'));
    pads.push(createPad('5', -0.95, -1.1, padW, padH, 'oval'));
  } else {
    pads.push(createPad('1', -0.95, 1.1, padW, padH, 'rect'));
    pads.push(createPad('2', 0, 1.1, padW, padH, 'oval'));
    pads.push(createPad('3', 0.95, 1.1, padW, padH, 'oval'));
    pads.push(createPad('4', 0.95, -1.1, padW, padH, 'oval'));
    pads.push(createPad('5', 0, -1.1, padW, padH, 'oval'));
    pads.push(createPad('6', -0.95, -1.1, padW, padH, 'oval'));
  }

  return {
    id: `fp_${name}`,
    name,
    pads,
    lines: [{
      layer: 'silkscreen_top',
      points: [
        { x: -1.5, y: -0.8 },
        { x: 1.5, y: -0.8 },
        { x: 1.5, y: 0.8 },
        { x: -1.5, y: 0.8 },
        { x: -1.5, y: -0.8 },
      ],
      width: 0.12,
    }],
    courtyard: { x: -2, y: -2, width: 4, height: 4 },
    origin: { x: 0, y: 0 },
  };
}

function createQFPFootprint(name: string, pinCount: number): Footprint {
  const pinsPerSide = pinCount / 4;
  const pitch = 0.5;
  const padW = 0.25;
  const padH = 1.2;
  const bodySize = pinsPerSide * pitch + 1;
  const padCenter = bodySize / 2 + padH / 2 - 0.2;

  const pads: Pad[] = [];
  let pinNum = 1;

  // Left side (top to bottom)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = -((pinsPerSide - 1) * pitch) / 2 + i * pitch;
    pads.push(createPad(String(pinNum++), -padCenter, y, padH, padW, pinNum === 2 ? 'rect' : 'oval'));
  }
  // Bottom (left to right)
  for (let i = 0; i < pinsPerSide; i++) {
    const x = -((pinsPerSide - 1) * pitch) / 2 + i * pitch;
    pads.push(createPad(String(pinNum++), x, padCenter, padW, padH, 'oval'));
  }
  // Right side (bottom to top)
  for (let i = 0; i < pinsPerSide; i++) {
    const y = ((pinsPerSide - 1) * pitch) / 2 - i * pitch;
    pads.push(createPad(String(pinNum++), padCenter, y, padH, padW, 'oval'));
  }
  // Top (right to left)
  for (let i = 0; i < pinsPerSide; i++) {
    const x = ((pinsPerSide - 1) * pitch) / 2 - i * pitch;
    pads.push(createPad(String(pinNum++), x, -padCenter, padW, padH, 'oval'));
  }

  return {
    id: `fp_${name}`,
    name,
    pads,
    lines: [{
      layer: 'silkscreen_top',
      points: [
        { x: -bodySize / 2, y: -bodySize / 2 },
        { x: bodySize / 2, y: -bodySize / 2 },
        { x: bodySize / 2, y: bodySize / 2 },
        { x: -bodySize / 2, y: bodySize / 2 },
        { x: -bodySize / 2, y: -bodySize / 2 },
      ],
      width: 0.15,
    }],
    courtyard: {
      x: -padCenter - padH / 2 - 0.25,
      y: -padCenter - padH / 2 - 0.25,
      width: 2 * (padCenter + padH / 2) + 0.5,
      height: 2 * (padCenter + padH / 2) + 0.5,
    },
    origin: { x: 0, y: 0 },
  };
}

function createQFNFootprint(name: string, pinCount: number): Footprint {
  const pinsPerSide = Math.floor((pinCount - 1) / 4); // -1 for exposed pad
  const pitch = 0.5;
  const padW = 0.25;
  const padH = 0.8;
  const bodySize = Math.max(pinsPerSide * pitch + 1, 3);
  const padCenter = bodySize / 2;

  const pads: Pad[] = [];
  let pinNum = 1;

  for (let i = 0; i < pinsPerSide; i++) {
    const y = -((pinsPerSide - 1) * pitch) / 2 + i * pitch;
    pads.push(createPad(String(pinNum++), -padCenter, y, padH, padW, 'rect'));
  }
  for (let i = 0; i < pinsPerSide; i++) {
    const x = -((pinsPerSide - 1) * pitch) / 2 + i * pitch;
    pads.push(createPad(String(pinNum++), x, padCenter, padW, padH, 'rect'));
  }
  for (let i = 0; i < pinsPerSide; i++) {
    const y = ((pinsPerSide - 1) * pitch) / 2 - i * pitch;
    pads.push(createPad(String(pinNum++), padCenter, y, padH, padW, 'rect'));
  }
  for (let i = 0; i < pinsPerSide; i++) {
    const x = ((pinsPerSide - 1) * pitch) / 2 - i * pitch;
    pads.push(createPad(String(pinNum++), x, -padCenter, padW, padH, 'rect'));
  }

  // Exposed thermal pad
  const epSize = bodySize * 0.5;
  pads.push(createPad(String(pinNum), 0, 0, epSize, epSize, 'rect'));

  return {
    id: `fp_${name}`,
    name,
    pads,
    lines: [{
      layer: 'silkscreen_top',
      points: [
        { x: -bodySize / 2, y: -bodySize / 2 },
        { x: bodySize / 2, y: -bodySize / 2 },
        { x: bodySize / 2, y: bodySize / 2 },
        { x: -bodySize / 2, y: bodySize / 2 },
        { x: -bodySize / 2, y: -bodySize / 2 },
      ],
      width: 0.15,
    }],
    courtyard: {
      x: -bodySize / 2 - 0.5,
      y: -bodySize / 2 - 0.5,
      width: bodySize + 1,
      height: bodySize + 1,
    },
    origin: { x: 0, y: 0 },
  };
}

function createPad(number: string, cx: number, cy: number, w: number, h: number, shape: PadShape): Pad {
  return {
    id: `pad_${number}`,
    number,
    shape,
    centerX: cx,
    centerY: cy,
    width: w,
    height: h,
    rotation: 0,
    holeWidth: 0,
    holeHeight: 0,
    layer: 'top',
    solderMaskExpansion: 0.05,
    pasteExpansion: 0,
  };
}
