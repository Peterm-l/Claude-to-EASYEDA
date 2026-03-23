import { useState, useCallback, useRef } from 'react';
import type { Project, SchematicComponent, Wire, NetLabel, PCBComponent, Track, Via, Net, Point, EditorState, EditorMode, Tool, PCBLayer, JLCPCBPart } from '../../core/types';
import { createProject, generateId, updateBOM, serializeProject, deserializeProject } from '../../core/project';
import { exportProjectForEasyEDA } from '../../core/easyeda-export';
import { runDRC } from '../../core/design-rules';

export function useProject() {
  const [project, setProject] = useState<Project>(() => createProject('Untitled', ''));
  const [editorState, setEditorState] = useState<EditorState>({
    mode: 'schematic',
    activeTool: 'select',
    zoom: 1,
    panOffset: { x: 0, y: 0 },
    selectedIds: [],
    hoveredId: null,
    gridSize: 50,
    snapToGrid: true,
    activeLayer: 'top_copper',
    showGrid: true,
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  const updateProject = useCallback((updater: (p: Project) => Project) => {
    setProject(prev => {
      const updated = updater(prev);
      updated.modified = new Date().toISOString();
      return updated;
    });
  }, []);

  // --- Schematic operations ---

  const addSchematicComponent = useCallback((part: JLCPCBPart, position: Point, reference: string, value: string) => {
    updateProject(p => {
      const comp: SchematicComponent = {
        id: generateId('sc'),
        partId: part.lcsc,
        reference,
        value,
        position,
        rotation: 0,
        mirror: false,
        pins: part.pins ?? [],
        properties: {},
      };

      // Add part if not already in project
      if (!p.parts.find(pp => pp.lcsc === part.lcsc)) {
        p.parts = [...p.parts, part];
      }

      return { ...p, schematic: { ...p.schematic, components: [...p.schematic.components, comp] } };
    });
  }, [updateProject]);

  const addWire = useCallback((points: Point[], netId: string) => {
    updateProject(p => {
      const wire: Wire = { id: generateId('w'), points, netId };
      return { ...p, schematic: { ...p.schematic, wires: [...p.schematic.wires, wire] } };
    });
  }, [updateProject]);

  const addNet = useCallback((name: string): string => {
    const id = generateId('net');
    updateProject(p => {
      const net: Net = { id, name };
      return { ...p, schematic: { ...p.schematic, nets: [...p.schematic.nets, net] } };
    });
    return id;
  }, [updateProject]);

  const addNetLabel = useCallback((name: string, position: Point, netId: string) => {
    updateProject(p => {
      const label: NetLabel = { id: generateId('nl'), name, position, rotation: 0, netId };
      return { ...p, schematic: { ...p.schematic, netLabels: [...p.schematic.netLabels, label] } };
    });
  }, [updateProject]);

  // --- PCB operations ---

  const addPCBComponent = useCallback((schematicCompId: string, position: Point) => {
    updateProject(p => {
      const schComp = p.schematic.components.find(c => c.id === schematicCompId);
      if (!schComp) return p;

      const part = p.parts.find(pp => pp.lcsc === schComp.partId);
      if (!part?.footprint) return p;

      const pcbComp: PCBComponent = {
        id: generateId('pc'),
        schematicRef: schematicCompId,
        partId: schComp.partId,
        reference: schComp.reference,
        footprint: part.footprint,
        position,
        rotation: 0,
        layer: 'top',
        locked: false,
      };

      return { ...p, pcb: { ...p.pcb, components: [...p.pcb.components, pcbComp] } };
    });
  }, [updateProject]);

  const addTrack = useCallback((points: Point[], netId: string, layer: PCBLayer, width?: number) => {
    updateProject(p => {
      const track: Track = {
        id: generateId('t'),
        netId,
        layer,
        width: width ?? p.designRules.defaultTraceWidth,
        points,
      };
      return { ...p, pcb: { ...p.pcb, tracks: [...p.pcb.tracks, track] } };
    });
  }, [updateProject]);

  const addVia = useCallback((position: Point, netId: string) => {
    updateProject(p => {
      const via: Via = {
        id: generateId('v'),
        netId,
        position,
        diameter: p.designRules.defaultViaDiameter,
        drill: p.designRules.defaultViaDrill,
        startLayer: 'top_copper',
        endLayer: 'bottom_copper',
      };
      return { ...p, pcb: { ...p.pcb, vias: [...p.pcb.vias, via] } };
    });
  }, [updateProject]);

  // --- Move components ---

  const moveComponent = useCallback((id: string, newPosition: Point) => {
    updateProject(p => {
      if (editorState.mode === 'schematic') {
        const components = p.schematic.components.map(c =>
          c.id === id ? { ...c, position: newPosition } : c
        );
        return { ...p, schematic: { ...p.schematic, components } };
      } else {
        const components = p.pcb.components.map(c =>
          c.id === id ? { ...c, position: newPosition } : c
        );
        return { ...p, pcb: { ...p.pcb, components } };
      }
    });
  }, [updateProject, editorState.mode]);

  const deleteSelected = useCallback(() => {
    updateProject(p => {
      const ids = new Set(editorState.selectedIds);
      if (editorState.mode === 'schematic') {
        return {
          ...p,
          schematic: {
            ...p.schematic,
            components: p.schematic.components.filter(c => !ids.has(c.id)),
            wires: p.schematic.wires.filter(w => !ids.has(w.id)),
            netLabels: p.schematic.netLabels.filter(l => !ids.has(l.id)),
            junctions: p.schematic.junctions.filter(j => !ids.has(j.id)),
            powerFlags: p.schematic.powerFlags.filter(f => !ids.has(f.id)),
          },
        };
      } else {
        return {
          ...p,
          pcb: {
            ...p.pcb,
            components: p.pcb.components.filter(c => !ids.has(c.id)),
            tracks: p.pcb.tracks.filter(t => !ids.has(t.id)),
            vias: p.pcb.vias.filter(v => !ids.has(v.id)),
            copperZones: p.pcb.copperZones.filter(z => !ids.has(z.id)),
          },
        };
      }
    });
    setEditorState(s => ({ ...s, selectedIds: [] }));
  }, [updateProject, editorState.selectedIds, editorState.mode]);

  // --- Export / Import ---

  const exportToEasyEDA = useCallback(() => {
    const proj = updateBOM(project);
    const exported = exportProjectForEasyEDA(proj);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.easyeda.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const exportProjectFile = useCallback(() => {
    const blob = new Blob([serializeProject(project)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name}.cpcb.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [project]);

  const importProjectFile = useCallback((json: string) => {
    try {
      const proj = deserializeProject(json);
      setProject(proj);
    } catch (e) {
      console.error('Failed to import project:', e);
    }
  }, []);

  const drcResults = useCallback(() => runDRC(project), [project]);

  return {
    project,
    editorState,
    setEditorState,
    updateProject,
    addSchematicComponent,
    addWire,
    addNet,
    addNetLabel,
    addPCBComponent,
    addTrack,
    addVia,
    moveComponent,
    deleteSelected,
    exportToEasyEDA,
    exportProjectFile,
    importProjectFile,
    drcResults,
    fileInputRef,
  };
}
