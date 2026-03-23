import type { Project, DesignRules, Schematic, PCBLayout } from './types';
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

export function createEmptyPCBLayout(): PCBLayout {
  return {
    components: [],
    tracks: [],
    vias: [],
    copperZones: [],
    boardOutline: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ],
      width: 100,
      height: 100,
    },
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
