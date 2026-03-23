// Fetch real component data (pin names, schematic symbols, footprints) from LCSC/EasyEDA
//
// LCSC stores the actual EasyEDA schematic symbols and footprints for every component.
// This module fetches that data and converts it into our internal format.
//
// API endpoint: https://easyeda.com/api/products/{lcsc}/svgs
// Also: https://easyeda.com/api/components/{uuid}

import type { Pin, Footprint, Pad, PadShape, PinElectricType, Point } from '../core/types';

interface LCSCComponentDetail {
  lcsc: string;
  title: string;
  description: string;
  datasheet: string;
  pins: PinInfo[];
  footprint: FootprintInfo | null;
  packageDetail: string;
}

interface PinInfo {
  number: string;
  name: string;
  electricType: PinElectricType;
  position: Point;
  orientation: number;
}

interface FootprintInfo {
  pads: Pad[];
  outline: Point[];
  width: number;
  height: number;
}

// Parse EasyEDA pin electric type
function parseElectricType(type: string | number): PinElectricType {
  const typeMap: Record<string, PinElectricType> = {
    '0': 'unconnected',
    '1': 'input',
    '2': 'output',
    '3': 'bidirectional',
    '4': 'power_in',
    'input': 'input',
    'output': 'output',
    'bidirectional': 'bidirectional',
    'power': 'power_in',
    'passive': 'passive',
    'open_collector': 'open_collector',
    'open_emitter': 'open_emitter',
  };
  return typeMap[String(type)] ?? 'passive';
}

// Fetch component detail from EasyEDA API
export async function fetchComponentData(lcscNumber: string): Promise<LCSCComponentDetail | null> {
  // Clean the LCSC number
  const num = lcscNumber.replace(/^C/i, '');

  try {
    // Try EasyEDA component search endpoint
    const searchUrl = `https://easyeda.com/api/products/C${num}/components`;
    const resp = await fetch(searchUrl, {
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) {
      // Fallback: try LCSC product detail
      return await fetchFromLCSC(num);
    }

    const data = await resp.json();
    if (!data?.success || !data?.result) {
      return await fetchFromLCSC(num);
    }

    return parseEasyEDAComponent(data.result, `C${num}`);
  } catch {
    // If EasyEDA fails, try alternative approach
    return await fetchFromLCSC(num);
  }
}

async function fetchFromLCSC(num: string): Promise<LCSCComponentDetail | null> {
  try {
    const url = `https://wmsc.lcsc.com/ftps/wm/product/detail?productCode=C${num}`;
    const resp = await fetch(url, {
      headers: { 'Accept': 'application/json' },
    });

    if (!resp.ok) return null;

    const data = await resp.json();
    if (!data?.result) return null;

    const product = data.result;
    return {
      lcsc: `C${num}`,
      title: product.productModel ?? '',
      description: product.productDescription ?? '',
      datasheet: product.pdfUrl ?? '',
      pins: extractPinsFromDescription(product),
      footprint: null,
      packageDetail: product.encapStandard ?? '',
    };
  } catch {
    return null;
  }
}

function parseEasyEDAComponent(result: any, lcsc: string): LCSCComponentDetail {
  const component = Array.isArray(result) ? result[0] : result;
  const pins: PinInfo[] = [];

  // Parse symbol data if available
  if (component?.dataStr) {
    try {
      const symbolData = typeof component.dataStr === 'string'
        ? JSON.parse(component.dataStr)
        : component.dataStr;

      // Parse pins from EasyEDA symbol format
      if (symbolData?.shape) {
        for (const shape of symbolData.shape) {
          if (typeof shape === 'string' && shape.startsWith('P~')) {
            const pin = parseEasyEDAPin(shape);
            if (pin) pins.push(pin);
          }
        }
      }
    } catch {
      // Failed to parse symbol data
    }
  }

  // Parse from attributes if available
  if (pins.length === 0 && component?.attributes?.pins) {
    try {
      const pinData = typeof component.attributes.pins === 'string'
        ? JSON.parse(component.attributes.pins)
        : component.attributes.pins;

      if (Array.isArray(pinData)) {
        for (const p of pinData) {
          pins.push({
            number: String(p.number ?? p.pinNumber ?? ''),
            name: String(p.name ?? p.pinName ?? ''),
            electricType: parseElectricType(p.electricType ?? p.type ?? 'passive'),
            position: { x: 0, y: 0 },
            orientation: 0,
          });
        }
      }
    } catch {
      // Failed to parse pin data
    }
  }

  return {
    lcsc,
    title: component?.title ?? '',
    description: component?.description ?? '',
    datasheet: component?.datasheet ?? '',
    pins,
    footprint: null,
    packageDetail: component?.package ?? '',
  };
}

// Parse a single pin from EasyEDA format: "P~show~0~1~670~30~~gge23^^..."
function parseEasyEDAPin(shape: string): PinInfo | null {
  try {
    const mainParts = shape.split('^^');
    const attrs = mainParts[0].split('~');

    // P~show~electricType~pinNumber~x~y~~id
    const electricType = parseElectricType(attrs[2] ?? '0');
    const pinNumber = attrs[3] ?? '';
    const x = parseFloat(attrs[4] ?? '0');
    const y = parseFloat(attrs[5] ?? '0');

    // Pin name is in a later section
    let pinName = pinNumber;
    if (mainParts.length >= 4) {
      const nameParts = mainParts[3]?.split('~');
      if (nameParts && nameParts.length >= 5) {
        pinName = nameParts[4] ?? pinNumber;
      }
    }

    return {
      number: pinNumber,
      name: pinName,
      electricType,
      position: { x: x * 0.254, y: y * 0.254 }, // EasyEDA units to mils
      orientation: 0,
    };
  } catch {
    return null;
  }
}

// Extract pin information from product description and common IC pinouts
function extractPinsFromDescription(product: any): PinInfo[] {
  const pkg = String(product.encapStandard ?? '').toUpperCase();
  const desc = String(product.productDescription ?? '').toLowerCase();
  const model = String(product.productModel ?? '');

  // Common 2-pin passives
  if (pkg.match(/^0[24680]/) || desc.includes('resistor') || desc.includes('capacitor') ||
      desc.includes('inductor') || desc.includes('fuse')) {
    return [
      { number: '1', name: '1', electricType: 'passive', position: { x: -60, y: 0 }, orientation: 0 },
      { number: '2', name: '2', electricType: 'passive', position: { x: 60, y: 0 }, orientation: 180 },
    ];
  }

  // Diodes / LEDs
  if (desc.includes('diode') || desc.includes('led') || desc.includes('rectifier')) {
    return [
      { number: '1', name: 'A', electricType: 'passive', position: { x: -60, y: 0 }, orientation: 0 },
      { number: '2', name: 'K', electricType: 'passive', position: { x: 60, y: 0 }, orientation: 180 },
    ];
  }

  // SOT-23 transistors (NPN/PNP)
  if (pkg.includes('SOT-23') && !pkg.includes('5') && !pkg.includes('6')) {
    if (desc.includes('pnp')) {
      return [
        { number: '1', name: 'B', electricType: 'input', position: { x: -60, y: 0 }, orientation: 0 },
        { number: '2', name: 'E', electricType: 'output', position: { x: 0, y: 60 }, orientation: 270 },
        { number: '3', name: 'C', electricType: 'output', position: { x: 0, y: -60 }, orientation: 90 },
      ];
    }
    if (desc.includes('npn') || desc.includes('transistor')) {
      return [
        { number: '1', name: 'B', electricType: 'input', position: { x: -60, y: 0 }, orientation: 0 },
        { number: '2', name: 'E', electricType: 'output', position: { x: 0, y: 60 }, orientation: 270 },
        { number: '3', name: 'C', electricType: 'output', position: { x: 0, y: -60 }, orientation: 90 },
      ];
    }
    // MOSFET
    if (desc.includes('mosfet') || desc.includes('mos')) {
      return [
        { number: '1', name: 'G', electricType: 'input', position: { x: -60, y: 0 }, orientation: 0 },
        { number: '2', name: 'S', electricType: 'passive', position: { x: 0, y: 60 }, orientation: 270 },
        { number: '3', name: 'D', electricType: 'passive', position: { x: 0, y: -60 }, orientation: 90 },
      ];
    }
  }

  // SOT-23-5 voltage regulators
  if (pkg.includes('SOT-23-5') || pkg.includes('SOT23-5')) {
    if (desc.includes('regulator') || desc.includes('ldo')) {
      return [
        { number: '1', name: 'IN', electricType: 'power_in', position: { x: -60, y: -25 }, orientation: 0 },
        { number: '2', name: 'GND', electricType: 'power_in', position: { x: -60, y: 25 }, orientation: 0 },
        { number: '3', name: 'EN', electricType: 'input', position: { x: 60, y: 25 }, orientation: 180 },
        { number: '4', name: 'BP', electricType: 'passive', position: { x: 60, y: -25 }, orientation: 180 },
        { number: '5', name: 'OUT', electricType: 'output', position: { x: 60, y: 0 }, orientation: 180 },
      ];
    }
  }

  // SOIC-8 common ICs
  if (pkg.includes('SOIC-8') || pkg.includes('SOP-8')) {
    // 555 timer
    if (desc.includes('555') || model.includes('555')) {
      return [
        { number: '1', name: 'GND', electricType: 'power_in', position: { x: -80, y: -75 }, orientation: 0 },
        { number: '2', name: 'TRIG', electricType: 'input', position: { x: -80, y: -25 }, orientation: 0 },
        { number: '3', name: 'OUT', electricType: 'output', position: { x: -80, y: 25 }, orientation: 0 },
        { number: '4', name: 'RESET', electricType: 'input', position: { x: -80, y: 75 }, orientation: 0 },
        { number: '5', name: 'CTRL', electricType: 'input', position: { x: 80, y: 75 }, orientation: 180 },
        { number: '6', name: 'THR', electricType: 'input', position: { x: 80, y: 25 }, orientation: 180 },
        { number: '7', name: 'DIS', electricType: 'output', position: { x: 80, y: -25 }, orientation: 180 },
        { number: '8', name: 'VCC', electricType: 'power_in', position: { x: 80, y: -75 }, orientation: 180 },
      ];
    }
    // Op-amp (single)
    if (desc.includes('op-amp') || desc.includes('operational amplifier') || desc.includes('opamp')) {
      return [
        { number: '1', name: 'NC', electricType: 'unconnected', position: { x: -80, y: -75 }, orientation: 0 },
        { number: '2', name: 'IN-', electricType: 'input', position: { x: -80, y: -25 }, orientation: 0 },
        { number: '3', name: 'IN+', electricType: 'input', position: { x: -80, y: 25 }, orientation: 0 },
        { number: '4', name: 'V-', electricType: 'power_in', position: { x: -80, y: 75 }, orientation: 0 },
        { number: '5', name: 'NC', electricType: 'unconnected', position: { x: 80, y: 75 }, orientation: 180 },
        { number: '6', name: 'OUT', electricType: 'output', position: { x: 80, y: 25 }, orientation: 180 },
        { number: '7', name: 'V+', electricType: 'power_in', position: { x: 80, y: -25 }, orientation: 180 },
        { number: '8', name: 'NC', electricType: 'unconnected', position: { x: 80, y: -75 }, orientation: 180 },
      ];
    }
    // UART/SPI flash
    if (desc.includes('flash') || desc.includes('eeprom')) {
      return [
        { number: '1', name: 'CS', electricType: 'input', position: { x: -80, y: -75 }, orientation: 0 },
        { number: '2', name: 'DO', electricType: 'output', position: { x: -80, y: -25 }, orientation: 0 },
        { number: '3', name: 'WP', electricType: 'input', position: { x: -80, y: 25 }, orientation: 0 },
        { number: '4', name: 'GND', electricType: 'power_in', position: { x: -80, y: 75 }, orientation: 0 },
        { number: '5', name: 'DI', electricType: 'input', position: { x: 80, y: 75 }, orientation: 180 },
        { number: '6', name: 'CLK', electricType: 'input', position: { x: 80, y: 25 }, orientation: 180 },
        { number: '7', name: 'HOLD', electricType: 'input', position: { x: 80, y: -25 }, orientation: 180 },
        { number: '8', name: 'VCC', electricType: 'power_in', position: { x: 80, y: -75 }, orientation: 180 },
      ];
    }
  }

  // Generic: generate numbered pins based on package pin count
  const pinMatch = pkg.match(/(\d+)/);
  if (pinMatch) {
    const pinCount = parseInt(pinMatch[1]);
    if (pinCount > 0 && pinCount <= 200) {
      return generateGenericPins(pinCount);
    }
  }

  // Default: 2 pins
  return [
    { number: '1', name: '1', electricType: 'passive', position: { x: -60, y: 0 }, orientation: 0 },
    { number: '2', name: '2', electricType: 'passive', position: { x: 60, y: 0 }, orientation: 180 },
  ];
}

function generateGenericPins(count: number): PinInfo[] {
  const pins: PinInfo[] = [];
  const halfCount = Math.ceil(count / 2);
  const spacing = 50;

  for (let i = 0; i < halfCount; i++) {
    pins.push({
      number: String(i + 1),
      name: String(i + 1),
      electricType: 'passive',
      position: { x: -80, y: -((halfCount - 1) * spacing) / 2 + i * spacing },
      orientation: 0,
    });
  }

  for (let i = 0; i < count - halfCount; i++) {
    const pinNum = count - i;
    pins.push({
      number: String(pinNum),
      name: String(pinNum),
      electricType: 'passive',
      position: { x: 80, y: -((count - halfCount - 1) * spacing) / 2 + i * spacing },
      orientation: 180,
    });
  }

  return pins;
}

// Enrich an existing part with real pin data
export async function enrichPartWithPinData(
  lcsc: string,
  existingPins?: Pin[],
): Promise<Pin[]> {
  // If we already have named pins (not just numbers), return them
  if (existingPins && existingPins.length > 0 &&
      existingPins.some(p => p.name && p.name !== p.number)) {
    return existingPins;
  }

  const data = await fetchComponentData(lcsc);
  if (!data || data.pins.length === 0) return existingPins ?? [];

  return data.pins.map(p => ({
    id: `pin_${p.number}`,
    number: p.number,
    name: p.name,
    electricType: p.electricType,
    position: p.position,
    orientation: p.orientation,
    length: 30,
  }));
}
