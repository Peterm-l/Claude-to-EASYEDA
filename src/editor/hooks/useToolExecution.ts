import { useCallback } from 'react';
import type { Project, SchematicComponent, PCBComponent, Wire, Net, NetLabel, PowerFlag, Track, Via, Point, PCBLayer, JLCPCBPart } from '../../core/types';
import { generateId, updateBOM, createBoardOutline, addCornerMountingHoles, isPointInsideBoard, distanceToEdge, suggestPlacementGrid } from '../../core/project';
import { runDRC } from '../../core/design-rules';
import { exportProjectForEasyEDA } from '../../core/easyeda-export';
import { searchByText, searchResistors, searchCapacitors } from '../../parts/jlcpcb-api';

interface ProjectActions {
  project: Project;
  updateProject: (updater: (p: Project) => Project) => void;
}

const refCounters: Record<string, number> = {};

function getNextRef(prefix: string, project: Project): string {
  // Count existing refs with this prefix
  const existing = project.schematic.components.filter(c => c.reference.startsWith(prefix)).length;
  const counter = Math.max(refCounters[prefix] ?? 0, existing) + 1;
  refCounters[prefix] = counter;
  return `${prefix}${counter}`;
}

export function useToolExecution({ project, updateProject }: ProjectActions) {
  const executeTool = useCallback(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'search_parts': {
        const query = String(args.query ?? '');
        const limit = Number(args.limit ?? 10);
        const packageFilter = args.package ? String(args.package) : undefined;

        let parts: JLCPCBPart[];
        if (query.toLowerCase().includes('resistor') || /^\d+[kKmM]?\s*ohm/i.test(query)) {
          parts = await searchResistors({ resistance: query.replace(/resistor|ohm/gi, '').trim(), package: packageFilter, limit });
        } else if (query.toLowerCase().includes('capacitor') || /^\d+[nupf]F/i.test(query)) {
          parts = await searchCapacitors({ capacitance: query.replace(/capacitor/gi, '').trim(), package: packageFilter, limit });
        } else {
          parts = await searchByText(query, limit);
        }

        if (packageFilter) parts = parts.filter(p => p.package.toLowerCase().includes(packageFilter.toLowerCase()));
        parts = parts.filter(p => p.stock > 0);

        return parts.map(p => ({
          lcsc: p.lcsc,
          mfr: p.mfr,
          description: p.description,
          package: p.package,
          stock: p.stock,
          price: p.price,
          isBasic: p.isBasic,
          isPreferred: p.isPreferred,
        }));
      }

      case 'add_component': {
        const lcsc = String(args.lcsc);
        const refPrefix = String(args.ref_prefix ?? 'U');
        const value = String(args.value ?? '');
        const x = Number(args.x ?? 400);
        const y = Number(args.y ?? 300);
        const pinNames = (args.pin_names ?? []) as string[];

        // Find part
        let results = await searchByText(lcsc, 5);
        let part = results.find(p => p.lcsc === lcsc) ?? results[0];
        if (!part) return { error: `Part ${lcsc} not found` };

        if (pinNames.length > 0 && part.footprint) {
          part = {
            ...part,
            pins: pinNames.map((pname, i) => ({
              id: `pin_${i + 1}`,
              number: String(i + 1),
              name: pname,
              electricType: 'passive' as const,
              position: { x: 0, y: i * 50 },
              orientation: 0,
              length: 30,
            })),
          };
        }

        const ref = getNextRef(refPrefix, project);

        updateProject(p => {
          if (!p.parts.find(pp => pp.lcsc === part!.lcsc)) {
            p = { ...p, parts: [...p.parts, part!] };
          }

          const comp: SchematicComponent = {
            id: generateId('sc'),
            partId: part!.lcsc,
            reference: ref,
            value: value || part!.mfr || part!.description.slice(0, 20),
            position: { x, y },
            rotation: 0,
            mirror: false,
            pins: part!.pins ?? [],
            properties: {},
          };

          let pcbComps = p.pcb.components;
          if (part!.footprint) {
            pcbComps = [...pcbComps, {
              id: generateId('pc'),
              schematicRef: comp.id,
              partId: part!.lcsc,
              reference: ref,
              footprint: part!.footprint,
              position: { x: 10 + pcbComps.length * 12, y: 10 },
              rotation: 0,
              layer: 'top' as const,
              locked: false,
            }];
          }

          return {
            ...p,
            schematic: { ...p.schematic, components: [...p.schematic.components, comp] },
            pcb: { ...p.pcb, components: pcbComps },
          };
        });

        return { reference: ref, partId: part.lcsc, package: part.package };
      }

      case 'add_wire': {
        const points = (args.points as Point[]) ?? [];
        const netName = String(args.net ?? '');

        updateProject(p => {
          let nets = p.schematic.nets;
          let netId = '';

          if (netName) {
            const existing = nets.find(n => n.name === netName);
            if (existing) {
              netId = existing.id;
            } else {
              const newNet: Net = { id: generateId('net'), name: netName };
              nets = [...nets, newNet];
              netId = newNet.id;
            }
          } else {
            const newNet: Net = { id: generateId('net'), name: `Net_${nets.length + 1}` };
            nets = [...nets, newNet];
            netId = newNet.id;
          }

          const wire: Wire = { id: generateId('w'), points, netId };
          return {
            ...p,
            schematic: { ...p.schematic, nets, wires: [...p.schematic.wires, wire] },
          };
        });

        return { added: true };
      }

      case 'add_net_label': {
        const labelName = String(args.name);
        const lx = Number(args.x ?? 0);
        const ly = Number(args.y ?? 0);

        updateProject(p => {
          let nets = p.schematic.nets;
          let existing = nets.find(n => n.name === labelName);
          if (!existing) {
            existing = { id: generateId('net'), name: labelName };
            nets = [...nets, existing];
          }
          const label: NetLabel = {
            id: generateId('nl'), name: labelName,
            position: { x: lx, y: ly }, rotation: 0, netId: existing.id,
          };
          return {
            ...p,
            schematic: { ...p.schematic, nets, netLabels: [...p.schematic.netLabels, label] },
          };
        });
        return { added: true };
      }

      case 'add_power_flag': {
        const flagName = String(args.name);
        const flagType = (args.type as 'power' | 'ground') ?? 'power';
        const fx = Number(args.x ?? 0);
        const fy = Number(args.y ?? 0);

        updateProject(p => {
          let nets = p.schematic.nets;
          let existing = nets.find(n => n.name === flagName);
          if (!existing) {
            existing = { id: generateId('net'), name: flagName };
            nets = [...nets, existing];
          }
          const flag: PowerFlag = {
            id: generateId('pf'), name: flagName, type: flagType,
            position: { x: fx, y: fy }, rotation: 0, netId: existing.id,
          };
          return {
            ...p,
            schematic: { ...p.schematic, nets, powerFlags: [...p.schematic.powerFlags, flag] },
          };
        });
        return { added: true };
      }

      case 'move_component': {
        const compId = String(args.id ?? args.reference ?? '');
        const mx = Number(args.x);
        const my = Number(args.y);

        updateProject(p => {
          const schComps = p.schematic.components.map(c =>
            (c.id === compId || c.reference === compId) ? { ...c, position: { x: mx, y: my } } : c
          );
          const pcbComps = p.pcb.components.map(c =>
            (c.id === compId || c.reference === compId) ? { ...c, position: { x: mx, y: my } } : c
          );
          return {
            ...p,
            schematic: { ...p.schematic, components: schComps },
            pcb: { ...p.pcb, components: pcbComps },
          };
        });
        return { moved: true };
      }

      case 'set_board_size': {
        const bw = Number(args.width ?? 100);
        const bh = Number(args.height ?? 100);
        const shape = (args.shape as 'rectangle' | 'rounded_rect' | 'circle') ?? 'rectangle';
        const cr = Number(args.corner_radius ?? 0);
        const mh = args.mounting_holes === true;

        updateProject(p => {
          let outline = createBoardOutline(shape, bw, bh, { cornerRadius: cr });
          if (mh) {
            outline = addCornerMountingHoles(outline);
          }
          return { ...p, pcb: { ...p.pcb, boardOutline: outline } };
        });
        return { width: bw, height: bh, shape };
      }

      case 'add_track': {
        const tpoints = (args.points as Point[]) ?? [];
        const tnet = String(args.net ?? '');
        const tlayer = (args.layer as PCBLayer) ?? 'top_copper';
        const twidth = Number(args.width ?? project.designRules.defaultTraceWidth);

        updateProject(p => {
          const netId = tnet ? (p.schematic.nets.find(n => n.name === tnet)?.id ?? '') : '';
          const track: Track = { id: generateId('t'), netId, layer: tlayer, width: twidth, points: tpoints };
          return { ...p, pcb: { ...p.pcb, tracks: [...p.pcb.tracks, track] } };
        });
        return { added: true };
      }

      case 'add_via': {
        const vx = Number(args.x);
        const vy = Number(args.y);

        updateProject(p => {
          const via: Via = {
            id: generateId('v'), netId: '',
            position: { x: vx, y: vy },
            diameter: p.designRules.defaultViaDiameter,
            drill: p.designRules.defaultViaDrill,
            startLayer: 'top_copper', endLayer: 'bottom_copper',
          };
          return { ...p, pcb: { ...p.pcb, vias: [...p.pcb.vias, via] } };
        });
        return { added: true };
      }

      case 'add_copper_zone': {
        const zpoints = (args.points as Point[]) ?? [];
        const znet = String(args.net ?? 'GND');
        const zlayer = (args.layer as PCBLayer) ?? 'top_copper';

        updateProject(p => {
          let nets = p.schematic.nets;
          let existing = nets.find(n => n.name === znet);
          if (!existing) {
            existing = { id: generateId('net'), name: znet };
            nets = [...nets, existing];
          }
          const zone = {
            id: generateId('cz'), netId: existing.id, layer: zlayer,
            outline: zpoints, clearance: p.designRules.minClearance,
            minWidth: p.designRules.minTraceWidth,
            thermalRelief: true, thermalGap: 0.5, thermalWidth: 0.25, priority: 0,
          };
          return {
            ...p,
            schematic: { ...p.schematic, nets },
            pcb: { ...p.pcb, copperZones: [...p.pcb.copperZones, zone] },
          };
        });
        return { added: true };
      }

      case 'run_drc': {
        const violations = runDRC(project);
        return {
          violations: violations.length,
          errors: violations.filter(v => v.severity === 'error').length,
          warnings: violations.filter(v => v.severity === 'warning').length,
          details: violations.slice(0, 20).map(v => ({
            type: v.type, severity: v.severity, message: v.message,
          })),
        };
      }

      case 'export_easyeda': {
        const proj = updateBOM(project);
        const exported = exportProjectForEasyEDA(proj);
        // Trigger download
        const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project.name || 'project'}.easyeda.json`;
        a.click();
        URL.revokeObjectURL(url);
        return { exported: true, filename: `${project.name}.easyeda.json` };
      }

      case 'get_project': {
        return {
          name: project.name,
          components: project.schematic.components.map(c => ({
            reference: c.reference, value: c.value, partId: c.partId,
          })),
          nets: project.schematic.nets.map(n => n.name),
          wires: project.schematic.wires.length,
          board: {
            width: project.pcb.boardOutline.width,
            height: project.pcb.boardOutline.height,
            shape: project.pcb.boardOutline.shape,
          },
          pcbComponents: project.pcb.components.length,
          tracks: project.pcb.tracks.length,
        };
      }

      case 'get_board_info': {
        const outline = project.pcb.boardOutline;
        const outsideBoard = project.pcb.components.filter(c => !isPointInsideBoard(c.position, outline));
        return {
          shape: outline.shape,
          width: outline.width,
          height: outline.height,
          mountingHoles: outline.mountingHoles.length,
          keepOutZones: outline.keepOutZones.length,
          componentsOutside: outsideBoard.map(c => c.reference),
        };
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }, [project, updateProject]);

  return executeTool;
}
