#!/usr/bin/env node

// MCP (Model Context Protocol) Server for Claude PCB Designer
// This allows Claude to directly manipulate PCB designs through tool calls.
//
// Run with: npx tsx src/mcp/server.ts
//
// Tools provided:
//   - search_parts: Search JLCPCB parts library
//   - add_component: Add a component to the schematic
//   - add_wire: Connect pins with a wire
//   - add_net: Create a named net
//   - add_net_label: Place a net label
//   - move_component: Move a component
//   - set_board_size: Set PCB board dimensions
//   - add_track: Add a PCB trace
//   - add_via: Add a via
//   - run_drc: Run design rule check
//   - export_easyeda: Export to EasyEDA format
//   - get_project: Get current project state
//   - create_project: Create a new project
//   - get_part_details: Get details about a specific part

import { createProject, createBoardOutline, addCornerMountingHoles, isPointInsideBoard, isPointInKeepOut, distanceToEdge, suggestPlacementGrid, generateId, updateBOM, serializeProject, deserializeProject } from '../core/project';
import { searchByText, searchParts, searchResistors, searchCapacitors, type SearchOptions } from '../parts/jlcpcb-api';
import { runDRC } from '../core/design-rules';
import { exportProjectForEasyEDA } from '../core/easyeda-export';
import type {
  Project, SchematicComponent, Wire, Net, NetLabel, PowerFlag,
  PCBComponent, Track, Via, Point, JLCPCBPart, Pin, PCBLayer,
} from '../core/types';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

// ============================================================
// Project State
// ============================================================

let currentProject: Project = createProject('Untitled', '');
let projectPath: string | null = null;
const refCounters: Record<string, number> = {};

function getNextRef(prefix: string): string {
  refCounters[prefix] = (refCounters[prefix] ?? 0) + 1;
  return `${prefix}${refCounters[prefix]}`;
}

function autoSave() {
  if (projectPath) {
    fs.writeFileSync(projectPath, serializeProject(currentProject), 'utf-8');
  }
}

// ============================================================
// Tool Implementations
// ============================================================

async function handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'search_parts': {
      const query = String(args.query ?? '');
      const limit = Number(args.limit ?? 20);
      const packageFilter = args.package ? String(args.package) : undefined;
      const inStockOnly = args.in_stock !== false;

      let parts: JLCPCBPart[];

      // Use specialized endpoints for common types
      if (query.toLowerCase().includes('resistor') || /^\d+[kKmM]?\s*ohm/i.test(query)) {
        parts = await searchResistors({ resistance: query.replace(/resistor|ohm/gi, '').trim(), package: packageFilter, limit });
      } else if (query.toLowerCase().includes('capacitor') || /^\d+[nupf]F/i.test(query)) {
        parts = await searchCapacitors({ capacitance: query.replace(/capacitor/gi, '').trim(), package: packageFilter, limit });
      } else {
        parts = await searchByText(query, limit);
      }

      if (inStockOnly) parts = parts.filter(p => p.stock > 0);
      if (packageFilter) parts = parts.filter(p => p.package.toLowerCase().includes(packageFilter.toLowerCase()));

      return parts.map(p => ({
        lcsc: p.lcsc,
        mfr: p.mfr,
        description: p.description,
        package: p.package,
        stock: p.stock,
        price: p.price,
        isBasic: p.isBasic,
        isPreferred: p.isPreferred,
        hasFootprint: !!p.footprint,
      }));
    }

    case 'add_component': {
      const lcsc = String(args.lcsc);
      const refPrefix = String(args.ref_prefix ?? 'U');
      const value = String(args.value ?? '');
      const x = Number(args.x ?? 400);
      const y = Number(args.y ?? 300);
      const pinNames = (args.pin_names ?? []) as string[];

      // Fetch part from JLCPCB if not already known
      let part = currentProject.parts.find(p => p.lcsc === lcsc);
      if (!part) {
        const results = await searchByText(lcsc, 5);
        part = results.find(p => p.lcsc === lcsc) ?? results[0];
        if (!part) return { error: `Part ${lcsc} not found` };
      }

      // Set pin names if provided
      if (pinNames.length > 0 && part.footprint) {
        part.pins = pinNames.map((name, i) => ({
          id: `pin_${i + 1}`,
          number: String(i + 1),
          name,
          electricType: 'passive' as const,
          position: { x: 0, y: i * 50 },
          orientation: 0,
          length: 30,
        }));
      }

      // Add to parts list
      if (!currentProject.parts.find(p => p.lcsc === part!.lcsc)) {
        currentProject.parts.push(part);
      }

      const ref = getNextRef(refPrefix);
      const comp: SchematicComponent = {
        id: generateId('sc'),
        partId: part.lcsc,
        reference: ref,
        value: value || part.mfr || part.description.slice(0, 20),
        position: { x, y },
        rotation: 0,
        mirror: false,
        pins: part.pins ?? [],
        properties: {},
      };

      currentProject.schematic.components.push(comp);

      // Also create PCB component if footprint available
      if (part.footprint) {
        const pcbComp: PCBComponent = {
          id: generateId('pc'),
          schematicRef: comp.id,
          partId: part.lcsc,
          reference: ref,
          footprint: part.footprint,
          position: { x: x * 0.254 / 50, y: y * 0.254 / 50 }, // Convert schematic mils to PCB mm approximately
          rotation: 0,
          layer: 'top',
          locked: false,
        };
        currentProject.pcb.components.push(pcbComp);
      }

      autoSave();
      return {
        id: comp.id,
        reference: ref,
        partId: part.lcsc,
        package: part.package,
        pinCount: part.pins?.length ?? part.footprint?.pads.length ?? 0,
      };
    }

    case 'add_wire': {
      const points = (args.points as { x: number; y: number }[]) ?? [];
      const netName = String(args.net ?? '');

      let netId = '';
      if (netName) {
        let net = currentProject.schematic.nets.find(n => n.name === netName);
        if (!net) {
          net = { id: generateId('net'), name: netName };
          currentProject.schematic.nets.push(net);
        }
        netId = net.id;
      } else {
        const net: Net = { id: generateId('net'), name: `Net_${currentProject.schematic.nets.length + 1}` };
        currentProject.schematic.nets.push(net);
        netId = net.id;
      }

      const wire: Wire = { id: generateId('w'), points, netId };
      currentProject.schematic.wires.push(wire);

      autoSave();
      return { id: wire.id, netId, netName: currentProject.schematic.nets.find(n => n.id === netId)?.name };
    }

    case 'add_net': {
      const name = String(args.name);
      const existing = currentProject.schematic.nets.find(n => n.name === name);
      if (existing) return { id: existing.id, name: existing.name, existed: true };

      const net: Net = { id: generateId('net'), name };
      currentProject.schematic.nets.push(net);
      autoSave();
      return { id: net.id, name };
    }

    case 'add_net_label': {
      const name = String(args.name);
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);

      let net = currentProject.schematic.nets.find(n => n.name === name);
      if (!net) {
        net = { id: generateId('net'), name };
        currentProject.schematic.nets.push(net);
      }

      const label: NetLabel = {
        id: generateId('nl'),
        name,
        position: { x, y },
        rotation: 0,
        netId: net.id,
      };
      currentProject.schematic.netLabels.push(label);

      autoSave();
      return { id: label.id, netId: net.id };
    }

    case 'add_power_flag': {
      const name = String(args.name);
      const type = (args.type as 'power' | 'ground') ?? 'power';
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);

      let net = currentProject.schematic.nets.find(n => n.name === name);
      if (!net) {
        net = { id: generateId('net'), name };
        currentProject.schematic.nets.push(net);
      }

      const flag: PowerFlag = {
        id: generateId('pf'),
        name,
        type,
        position: { x, y },
        rotation: 0,
        netId: net.id,
      };
      currentProject.schematic.powerFlags.push(flag);

      autoSave();
      return { id: flag.id, netId: net.id };
    }

    case 'move_component': {
      const id = String(args.id ?? args.reference ?? '');
      const x = Number(args.x);
      const y = Number(args.y);

      // Find by ID or reference
      const schComp = currentProject.schematic.components.find(
        c => c.id === id || c.reference === id
      );
      if (schComp) {
        schComp.position = { x, y };
      }

      const pcbComp = currentProject.pcb.components.find(
        c => c.id === id || c.reference === id
      );
      if (pcbComp) {
        pcbComp.position = { x, y };
      }

      autoSave();
      return { moved: !!(schComp || pcbComp) };
    }

    case 'rotate_component': {
      const id = String(args.id ?? args.reference ?? '');
      const angle = Number(args.angle ?? 90);

      const schComp = currentProject.schematic.components.find(
        c => c.id === id || c.reference === id
      );
      if (schComp) {
        schComp.rotation = (schComp.rotation + angle) % 360;
      }

      const pcbComp = currentProject.pcb.components.find(
        c => c.id === id || c.reference === id
      );
      if (pcbComp) {
        pcbComp.rotation = (pcbComp.rotation + angle) % 360;
      }

      autoSave();
      return { rotated: !!(schComp || pcbComp) };
    }

    case 'set_board_size': {
      const width = Number(args.width ?? 100);
      const height = Number(args.height ?? 100);
      const shape = (args.shape as 'rectangle' | 'rounded_rect' | 'circle' | 'polygon') ?? 'rectangle';
      const cornerRadius = Number(args.corner_radius ?? 0);
      const addMountingHoles = args.mounting_holes !== false && args.mounting_holes !== undefined;
      const holeInset = Number(args.hole_inset ?? 4);
      const holeDiameter = Number(args.hole_diameter ?? 3.2);

      let outline = createBoardOutline(shape, width, height, { cornerRadius });

      if (addMountingHoles) {
        outline = addCornerMountingHoles(outline, holeDiameter, holeDiameter + 2.8, holeInset, false);
      }

      currentProject.pcb.boardOutline = outline;

      // Warn if components are outside new outline
      const outsideComps = currentProject.pcb.components.filter(
        c => !isPointInsideBoard(c.position, outline)
      );

      autoSave();
      return {
        width,
        height,
        shape,
        cornerRadius,
        mountingHoles: outline.mountingHoles.length,
        componentsOutside: outsideComps.map(c => c.reference),
      };
    }

    case 'set_board_outline': {
      // Custom polygon outline
      const points = (args.points as { x: number; y: number }[]) ?? [];
      if (points.length < 3) return { error: 'Board outline needs at least 3 points' };

      const minX = Math.min(...points.map(p => p.x));
      const maxX = Math.max(...points.map(p => p.x));
      const minY = Math.min(...points.map(p => p.y));
      const maxY = Math.max(...points.map(p => p.y));

      currentProject.pcb.boardOutline = {
        shape: 'polygon',
        points,
        width: maxX - minX,
        height: maxY - minY,
        cornerRadius: 0,
        mountingHoles: currentProject.pcb.boardOutline.mountingHoles,
        keepOutZones: currentProject.pcb.boardOutline.keepOutZones,
      };

      autoSave();
      return { width: maxX - minX, height: maxY - minY, pointCount: points.length };
    }

    case 'add_mounting_hole': {
      const x = Number(args.x);
      const y = Number(args.y);
      const diameter = Number(args.diameter ?? 3.2);
      const padDiameter = Number(args.pad_diameter ?? diameter + 2.8);
      const plated = args.plated === true;

      const hole = {
        id: generateId('mh'),
        position: { x, y },
        diameter,
        padDiameter,
        plated,
      };
      currentProject.pcb.boardOutline.mountingHoles.push(hole);

      autoSave();
      return { id: hole.id, x, y, diameter, padDiameter };
    }

    case 'add_keepout_zone': {
      const points = (args.points as { x: number; y: number }[]) ?? [];
      if (points.length < 3) return { error: 'Keep-out zone needs at least 3 points' };

      currentProject.pcb.boardOutline.keepOutZones.push(points);

      // Check if any existing components are in the keep-out
      const conflicting = currentProject.pcb.components.filter(
        c => isPointInKeepOut(c.position, currentProject.pcb.boardOutline)
      );

      autoSave();
      return {
        zoneIndex: currentProject.pcb.boardOutline.keepOutZones.length - 1,
        conflictingComponents: conflicting.map(c => c.reference),
      };
    }

    case 'suggest_placement': {
      const margin = Number(args.margin ?? 3);
      const spacingX = Number(args.spacing_x ?? 10);
      const spacingY = Number(args.spacing_y ?? 10);

      const positions = suggestPlacementGrid(
        currentProject.pcb.boardOutline, margin, spacingX, spacingY
      );

      return {
        availablePositions: positions.length,
        positions: positions.slice(0, 50), // Return up to 50
        boardSize: {
          width: currentProject.pcb.boardOutline.width,
          height: currentProject.pcb.boardOutline.height,
        },
        usableArea: `${(positions.length * spacingX * spacingY).toFixed(1)} mm²`,
      };
    }

    case 'get_board_info': {
      const outline = currentProject.pcb.boardOutline;
      const components = currentProject.pcb.components;

      const outsideBoard = components.filter(c => !isPointInsideBoard(c.position, outline));
      const tooCloseToEdge = components.filter(c => {
        const d = distanceToEdge(c.position, outline);
        return d < currentProject.designRules.copperToEdge + 1; // 1mm margin warning
      });

      return {
        shape: outline.shape,
        width: outline.width,
        height: outline.height,
        cornerRadius: outline.cornerRadius,
        area: `${(outline.width * outline.height).toFixed(1)} mm²`,
        mountingHoles: outline.mountingHoles.map(h => ({
          id: h.id,
          position: h.position,
          diameter: h.diameter,
          plated: h.plated,
        })),
        keepOutZones: outline.keepOutZones.length,
        componentsOutside: outsideBoard.map(c => c.reference),
        componentsTooCloseToEdge: tooCloseToEdge.map(c => ({
          reference: c.reference,
          distanceToEdge: distanceToEdge(c.position, outline).toFixed(2) + 'mm',
        })),
        totalComponents: components.length,
      };
    }

    case 'add_track': {
      const points = (args.points as { x: number; y: number }[]) ?? [];
      const netName = String(args.net ?? '');
      const layer = (args.layer as PCBLayer) ?? 'top_copper';
      const width = Number(args.width ?? currentProject.designRules.defaultTraceWidth);

      let netId = '';
      if (netName) {
        const net = currentProject.schematic.nets.find(n => n.name === netName);
        netId = net?.id ?? '';
      }

      const track: Track = {
        id: generateId('t'),
        netId,
        layer,
        width,
        points,
      };
      currentProject.pcb.tracks.push(track);

      autoSave();
      return { id: track.id, width, layer };
    }

    case 'add_via': {
      const x = Number(args.x);
      const y = Number(args.y);
      const netName = String(args.net ?? '');

      let netId = '';
      if (netName) {
        const net = currentProject.schematic.nets.find(n => n.name === netName);
        netId = net?.id ?? '';
      }

      const via: Via = {
        id: generateId('v'),
        netId,
        position: { x, y },
        diameter: currentProject.designRules.defaultViaDiameter,
        drill: currentProject.designRules.defaultViaDrill,
        startLayer: 'top_copper',
        endLayer: 'bottom_copper',
      };
      currentProject.pcb.vias.push(via);

      autoSave();
      return { id: via.id };
    }

    case 'add_copper_zone': {
      const points = (args.points as { x: number; y: number }[]) ?? [];
      const netName = String(args.net ?? 'GND');
      const layer = (args.layer as PCBLayer) ?? 'top_copper';

      let netId = '';
      if (netName) {
        let net = currentProject.schematic.nets.find(n => n.name === netName);
        if (!net) {
          net = { id: generateId('net'), name: netName };
          currentProject.schematic.nets.push(net);
        }
        netId = net.id;
      }

      const zone = {
        id: generateId('cz'),
        netId,
        layer,
        outline: points,
        clearance: currentProject.designRules.minClearance,
        minWidth: currentProject.designRules.minTraceWidth,
        thermalRelief: true,
        thermalGap: 0.5,
        thermalWidth: 0.25,
        priority: 0,
      };
      currentProject.pcb.copperZones.push(zone);

      autoSave();
      return { id: zone.id };
    }

    case 'run_drc': {
      const violations = runDRC(currentProject);
      return {
        violations: violations.length,
        errors: violations.filter(v => v.severity === 'error').length,
        warnings: violations.filter(v => v.severity === 'warning').length,
        details: violations.map(v => ({
          type: v.type,
          severity: v.severity,
          message: v.message,
          location: v.location,
        })),
      };
    }

    case 'export_easyeda': {
      currentProject = updateBOM(currentProject);
      const exported = exportProjectForEasyEDA(currentProject);

      // Save files
      const outDir = args.output_dir ? String(args.output_dir) : '.';
      const baseName = currentProject.name.replace(/[^a-zA-Z0-9_-]/g, '_');

      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(
        path.join(outDir, `${baseName}_schematic.json`),
        JSON.stringify(exported.schematic, null, 2)
      );
      fs.writeFileSync(
        path.join(outDir, `${baseName}_pcb.json`),
        JSON.stringify(exported.pcb, null, 2)
      );
      fs.writeFileSync(
        path.join(outDir, `${baseName}_bom.csv`),
        exported.bom
      );

      return {
        files: [
          `${baseName}_schematic.json`,
          `${baseName}_pcb.json`,
          `${baseName}_bom.csv`,
        ],
        outputDir: outDir,
        bomEntries: currentProject.bom.length,
      };
    }

    case 'get_project': {
      return {
        name: currentProject.name,
        description: currentProject.description,
        components: currentProject.schematic.components.map(c => ({
          id: c.id,
          reference: c.reference,
          value: c.value,
          partId: c.partId,
          position: c.position,
          pinCount: c.pins?.length ?? 0,
        })),
        nets: currentProject.schematic.nets.map(n => ({ id: n.id, name: n.name })),
        wires: currentProject.schematic.wires.length,
        pcbComponents: currentProject.pcb.components.length,
        tracks: currentProject.pcb.tracks.length,
        vias: currentProject.pcb.vias.length,
        boardSize: {
          width: currentProject.pcb.boardOutline.width,
          height: currentProject.pcb.boardOutline.height,
        },
        designRules: currentProject.designRules,
      };
    }

    case 'create_project': {
      const name = String(args.name ?? 'Untitled');
      const description = String(args.description ?? '');
      const savePath = args.path ? String(args.path) : null;

      currentProject = createProject(name, description);
      projectPath = savePath;

      // Reset reference counters
      Object.keys(refCounters).forEach(k => delete refCounters[k]);

      if (projectPath) autoSave();
      return { name, path: projectPath };
    }

    case 'save_project': {
      const savePath = args.path ? String(args.path) : projectPath;
      if (!savePath) return { error: 'No save path specified' };

      projectPath = savePath;
      autoSave();
      return { saved: true, path: savePath };
    }

    case 'load_project': {
      const loadPath = String(args.path);
      if (!fs.existsSync(loadPath)) return { error: `File not found: ${loadPath}` };

      const json = fs.readFileSync(loadPath, 'utf-8');
      currentProject = deserializeProject(json);
      projectPath = loadPath;

      return { loaded: true, name: currentProject.name };
    }

    case 'delete_component': {
      const id = String(args.id ?? args.reference ?? '');
      const schIdx = currentProject.schematic.components.findIndex(
        c => c.id === id || c.reference === id
      );
      if (schIdx >= 0) {
        const comp = currentProject.schematic.components[schIdx];
        currentProject.schematic.components.splice(schIdx, 1);

        // Also remove PCB component
        const pcbIdx = currentProject.pcb.components.findIndex(c => c.schematicRef === comp.id);
        if (pcbIdx >= 0) currentProject.pcb.components.splice(pcbIdx, 1);
      }

      autoSave();
      return { deleted: schIdx >= 0 };
    }

    case 'set_design_rules': {
      if (args.min_trace_width !== undefined)
        currentProject.designRules.minTraceWidth = Number(args.min_trace_width);
      if (args.min_trace_spacing !== undefined)
        currentProject.designRules.minTraceSpacing = Number(args.min_trace_spacing);
      if (args.min_via_drill !== undefined)
        currentProject.designRules.minViaDrill = Number(args.min_via_drill);
      if (args.min_via_diameter !== undefined)
        currentProject.designRules.minViaDiameter = Number(args.min_via_diameter);
      if (args.default_trace_width !== undefined)
        currentProject.designRules.defaultTraceWidth = Number(args.default_trace_width);

      autoSave();
      return { rules: currentProject.designRules };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ============================================================
// MCP Protocol Implementation (JSON-RPC over stdio)
// ============================================================

const TOOLS_MANIFEST = [
  {
    name: 'search_parts',
    description: 'Search the JLCPCB parts library. Returns parts with stock, pricing, and package info.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "STM32F103", "10k 0805 resistor", "100nF capacitor")' },
        package: { type: 'string', description: 'Filter by package (e.g., "0805", "SOIC-8", "QFP-48")' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        in_stock: { type: 'boolean', description: 'Only show in-stock parts (default true)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_component',
    description: 'Add a component to the schematic and PCB. Specify LCSC part number from search results.',
    inputSchema: {
      type: 'object',
      properties: {
        lcsc: { type: 'string', description: 'LCSC part number (e.g., "C12345")' },
        ref_prefix: { type: 'string', description: 'Reference prefix (R, C, U, L, D, Q, J, etc.)' },
        value: { type: 'string', description: 'Component value (e.g., "10k", "100nF", "STM32F103C8T6")' },
        x: { type: 'number', description: 'X position on schematic (mils)' },
        y: { type: 'number', description: 'Y position on schematic (mils)' },
        pin_names: { type: 'array', items: { type: 'string' }, description: 'Pin names in order (e.g., ["VCC", "GND", "PA0", "PA1"])' },
      },
      required: ['lcsc', 'ref_prefix'],
    },
  },
  {
    name: 'add_wire',
    description: 'Add a wire to connect pins/nets in the schematic.',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Wire path points (mils)' },
        net: { type: 'string', description: 'Net name (creates if not exists)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_net',
    description: 'Create a named net for connecting components.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Net name (e.g., "VCC", "GND", "SDA")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'add_net_label',
    description: 'Place a net label on the schematic to name a wire/connection.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Net name' },
        x: { type: 'number', description: 'X position (mils)' },
        y: { type: 'number', description: 'Y position (mils)' },
      },
      required: ['name', 'x', 'y'],
    },
  },
  {
    name: 'add_power_flag',
    description: 'Add a power or ground symbol to the schematic.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Power net name (e.g., "VCC", "GND", "+3V3")' },
        type: { type: 'string', enum: ['power', 'ground'], description: 'Power or ground' },
        x: { type: 'number', description: 'X position (mils)' },
        y: { type: 'number', description: 'Y position (mils)' },
      },
      required: ['name', 'type', 'x', 'y'],
    },
  },
  {
    name: 'move_component',
    description: 'Move a component to a new position. Works for both schematic and PCB.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Component ID or reference designator (e.g., "R1", "U1")' },
        x: { type: 'number', description: 'New X position' },
        y: { type: 'number', description: 'New Y position' },
      },
      required: ['id', 'x', 'y'],
    },
  },
  {
    name: 'rotate_component',
    description: 'Rotate a component.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Component ID or reference designator' },
        angle: { type: 'number', description: 'Rotation angle in degrees (default 90)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_board_size',
    description: 'Set the PCB board dimensions and shape. Supports rectangle, rounded rectangle, circle, or custom polygon. Can auto-add M3 mounting holes at corners. Board size determines layout — JLCPCB limits: 5x5mm min, 400x500mm max.',
    inputSchema: {
      type: 'object',
      properties: {
        width: { type: 'number', description: 'Board width in mm' },
        height: { type: 'number', description: 'Board height in mm' },
        shape: { type: 'string', enum: ['rectangle', 'rounded_rect', 'circle', 'polygon'], description: 'Board shape (default: rectangle)' },
        corner_radius: { type: 'number', description: 'Corner radius in mm for rounded_rect (default: 0)' },
        mounting_holes: { type: 'boolean', description: 'Add M3 mounting holes at corners' },
        hole_inset: { type: 'number', description: 'Distance of mounting holes from edges in mm (default: 4)' },
        hole_diameter: { type: 'number', description: 'Mounting hole drill diameter in mm (default: 3.2 for M3)' },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'set_board_outline',
    description: 'Set a custom polygon board outline. Use when the board is not a standard shape (e.g., L-shaped, notched, or irregular). Points define the outline clockwise.',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Outline vertices in mm, clockwise, forming a closed polygon' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_mounting_hole',
    description: 'Add a mounting hole to the board. Default is M3 (3.2mm drill). Mounting holes affect component placement clearance.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X position (mm)' },
        y: { type: 'number', description: 'Y position (mm)' },
        diameter: { type: 'number', description: 'Drill diameter in mm (default: 3.2 for M3)' },
        pad_diameter: { type: 'number', description: 'Copper pad diameter in mm (default: drill + 2.8)' },
        plated: { type: 'boolean', description: 'Whether the hole is plated (default: false)' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'add_keepout_zone',
    description: 'Define an area on the board where no components or copper should be placed (e.g., under connectors, near antennas, around mounting holes).',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Zone outline points (mm)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'suggest_placement',
    description: 'Get suggested component placement positions that fit within the board outline, respecting margins, mounting holes, and keep-out zones.',
    inputSchema: {
      type: 'object',
      properties: {
        margin: { type: 'number', description: 'Minimum distance from board edge in mm (default: 3)' },
        spacing_x: { type: 'number', description: 'Grid spacing X in mm (default: 10)' },
        spacing_y: { type: 'number', description: 'Grid spacing Y in mm (default: 10)' },
      },
    },
  },
  {
    name: 'get_board_info',
    description: 'Get detailed board outline info including shape, mounting holes, keep-out zones, and which components are outside the board or too close to edges.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'add_track',
    description: 'Add a PCB trace/track between points.',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Track path points (mm)' },
        net: { type: 'string', description: 'Net name' },
        layer: { type: 'string', description: 'Layer (top_copper, bottom_copper, etc.)' },
        width: { type: 'number', description: 'Track width in mm (default from design rules)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_via',
    description: 'Add a via to the PCB.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number', description: 'X position (mm)' },
        y: { type: 'number', description: 'Y position (mm)' },
        net: { type: 'string', description: 'Net name' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'add_copper_zone',
    description: 'Add a copper pour/zone to the PCB (e.g., ground plane).',
    inputSchema: {
      type: 'object',
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Zone outline points (mm)' },
        net: { type: 'string', description: 'Net name (e.g., "GND")' },
        layer: { type: 'string', description: 'Layer (default: top_copper)' },
      },
      required: ['points', 'net'],
    },
  },
  {
    name: 'run_drc',
    description: 'Run design rule check against JLCPCB manufacturing rules. Returns violations.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'export_easyeda',
    description: 'Export the project to EasyEDA Standard JSON format for import into EasyEDA/JLCPCB.',
    inputSchema: {
      type: 'object',
      properties: {
        output_dir: { type: 'string', description: 'Output directory (default: current dir)' },
      },
    },
  },
  {
    name: 'get_project',
    description: 'Get the current project state including all components, nets, and board info.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_project',
    description: 'Create a new PCB project.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        description: { type: 'string', description: 'Project description' },
        path: { type: 'string', description: 'File path to save project' },
      },
      required: ['name'],
    },
  },
  {
    name: 'save_project',
    description: 'Save the current project to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
      },
    },
  },
  {
    name: 'load_project',
    description: 'Load a project from disk.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to load' },
      },
      required: ['path'],
    },
  },
  {
    name: 'delete_component',
    description: 'Delete a component from the design.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Component ID or reference designator' },
      },
      required: ['id'],
    },
  },
  {
    name: 'set_design_rules',
    description: 'Update JLCPCB design rules (trace width, spacing, via sizes, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        min_trace_width: { type: 'number', description: 'Minimum trace width (mm)' },
        min_trace_spacing: { type: 'number', description: 'Minimum trace spacing (mm)' },
        min_via_drill: { type: 'number', description: 'Minimum via drill (mm)' },
        min_via_diameter: { type: 'number', description: 'Minimum via diameter (mm)' },
        default_trace_width: { type: 'number', description: 'Default trace width (mm)' },
      },
    },
  },
];

// ============================================================
// JSON-RPC Stdio Transport
// ============================================================

async function main() {
  const rl = readline.createInterface({ input: process.stdin });
  let buffer = '';

  process.stderr.write('Claude PCB Designer MCP Server started\n');

  rl.on('line', async (line) => {
    try {
      const msg = JSON.parse(line);
      let response: unknown;

      switch (msg.method) {
        case 'initialize':
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: {
                name: 'claude-pcb-designer',
                version: '1.0.0',
              },
            },
          };
          break;

        case 'notifications/initialized':
          // No response needed for notifications
          return;

        case 'tools/list':
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: TOOLS_MANIFEST },
          };
          break;

        case 'tools/call': {
          const { name, arguments: args } = msg.params;
          try {
            const result = await handleTool(name, args ?? {});
            response = {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                }],
              },
            };
          } catch (err) {
            response = {
              jsonrpc: '2.0',
              id: msg.id,
              result: {
                content: [{
                  type: 'text',
                  text: JSON.stringify({ error: String(err) }),
                }],
                isError: true,
              },
            };
          }
          break;
        }

        default:
          response = {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: `Method not found: ${msg.method}` },
          };
      }

      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      process.stderr.write(`Error: ${err}\n`);
    }
  });
}

main().catch(console.error);
