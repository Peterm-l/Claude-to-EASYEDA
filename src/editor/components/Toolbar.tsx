import React from 'react';
import type { EditorState, Tool, EditorMode, PCBLayer } from '../../core/types';

interface Props {
  editorState: EditorState;
  onEditorStateChange: (state: EditorState) => void;
  onExportEasyEDA: () => void;
  onExportProject: () => void;
  onImportProject: () => void;
  onRunDRC: () => void;
  onDelete: () => void;
  drcCount: number;
}

const SCHEMATIC_TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'pan', label: 'Pan', key: 'H' },
  { tool: 'wire', label: 'Wire', key: 'W' },
  { tool: 'net_label', label: 'Net Label', key: 'L' },
  { tool: 'power_flag', label: 'Power', key: 'P' },
  { tool: 'delete', label: 'Delete', key: 'Del' },
];

const PCB_TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'select', label: 'Select', key: 'V' },
  { tool: 'pan', label: 'Pan', key: 'H' },
  { tool: 'track', label: 'Track', key: 'X' },
  { tool: 'via', label: 'Via', key: 'V' },
  { tool: 'copper_zone', label: 'Zone', key: 'Z' },
  { tool: 'measure', label: 'Measure', key: 'M' },
  { tool: 'delete', label: 'Delete', key: 'Del' },
];

const PCB_LAYERS: { layer: PCBLayer; label: string; color: string }[] = [
  { layer: 'top_copper', label: 'Top Cu', color: '#ff3333' },
  { layer: 'bottom_copper', label: 'Bot Cu', color: '#3333ff' },
  { layer: 'top_silkscreen', label: 'Top Silk', color: '#ffcc00' },
  { layer: 'bottom_silkscreen', label: 'Bot Silk', color: '#66cc33' },
  { layer: 'edge_cuts', label: 'Edge', color: '#ffff00' },
];

export function Toolbar({
  editorState, onEditorStateChange,
  onExportEasyEDA, onExportProject, onImportProject, onRunDRC, onDelete,
  drcCount,
}: Props) {
  const tools = editorState.mode === 'schematic' ? SCHEMATIC_TOOLS : PCB_TOOLS;

  return (
    <div style={styles.toolbar}>
      {/* Mode tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(editorState.mode === 'schematic' ? styles.tabActive : {}) }}
          onClick={() => onEditorStateChange({ ...editorState, mode: 'schematic', activeTool: 'select' })}
        >
          Schematic
        </button>
        <button
          style={{ ...styles.tab, ...(editorState.mode === 'pcb' ? styles.tabActive : {}) }}
          onClick={() => onEditorStateChange({ ...editorState, mode: 'pcb', activeTool: 'select' })}
        >
          PCB
        </button>
      </div>

      <div style={styles.separator} />

      {/* Tools */}
      {tools.map(({ tool, label, key }) => (
        <button
          key={tool}
          style={{
            ...styles.toolBtn,
            ...(editorState.activeTool === tool ? styles.toolBtnActive : {}),
          }}
          onClick={() => onEditorStateChange({ ...editorState, activeTool: tool })}
          title={`${label} (${key})`}
        >
          {label}
        </button>
      ))}

      <div style={styles.separator} />

      {/* Layer selector (PCB only) */}
      {editorState.mode === 'pcb' && (
        <>
          {PCB_LAYERS.map(({ layer, label, color }) => (
            <button
              key={layer}
              style={{
                ...styles.layerBtn,
                borderColor: color,
                ...(editorState.activeLayer === layer ? { background: color + '40' } : {}),
              }}
              onClick={() => onEditorStateChange({ ...editorState, activeLayer: layer })}
            >
              {label}
            </button>
          ))}
          <div style={styles.separator} />
        </>
      )}

      {/* Grid */}
      <button
        style={{
          ...styles.toolBtn,
          ...(editorState.snapToGrid ? styles.toolBtnActive : {}),
        }}
        onClick={() => onEditorStateChange({ ...editorState, snapToGrid: !editorState.snapToGrid })}
      >
        Snap
      </button>

      <button
        style={{
          ...styles.toolBtn,
          ...(editorState.showGrid ? styles.toolBtnActive : {}),
        }}
        onClick={() => onEditorStateChange({ ...editorState, showGrid: !editorState.showGrid })}
      >
        Grid
      </button>

      <div style={styles.separator} />

      {/* DRC */}
      <button style={styles.actionBtn} onClick={onRunDRC}>
        DRC {drcCount > 0 && <span style={styles.badge}>{drcCount}</span>}
      </button>

      <div style={{ flex: 1 }} />

      {/* File operations */}
      <button style={styles.actionBtn} onClick={onImportProject}>Open</button>
      <button style={styles.actionBtn} onClick={onExportProject}>Save</button>
      <button style={styles.exportBtn} onClick={onExportEasyEDA}>
        Export to EasyEDA
      </button>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    padding: '4px 8px',
    background: '#16162e',
    borderBottom: '1px solid #303060',
    gap: 2,
    flexWrap: 'wrap',
  },
  tabs: {
    display: 'flex',
    gap: 1,
  },
  tab: {
    padding: '6px 14px',
    background: '#252545',
    border: 'none',
    color: '#888',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 'bold',
    borderRadius: '4px 4px 0 0',
  },
  tabActive: {
    background: '#1a1a2e',
    color: '#66aaff',
  },
  separator: {
    width: 1,
    height: 24,
    background: '#303060',
    margin: '0 6px',
  },
  toolBtn: {
    padding: '5px 10px',
    background: '#252545',
    border: '1px solid transparent',
    borderRadius: 3,
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 11,
  },
  toolBtnActive: {
    background: '#3a3a6e',
    color: '#fff',
    border: '1px solid #4466aa',
  },
  layerBtn: {
    padding: '4px 8px',
    background: 'transparent',
    border: '1px solid',
    borderRadius: 3,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 10,
  },
  actionBtn: {
    padding: '5px 10px',
    background: '#353555',
    border: 'none',
    borderRadius: 3,
    color: '#ccc',
    cursor: 'pointer',
    fontSize: 11,
  },
  exportBtn: {
    padding: '6px 14px',
    background: '#44aa44',
    border: 'none',
    borderRadius: 4,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 'bold',
  },
  badge: {
    display: 'inline-block',
    padding: '1px 5px',
    background: '#cc3333',
    borderRadius: 8,
    fontSize: 10,
    color: '#fff',
    marginLeft: 4,
  },
};
