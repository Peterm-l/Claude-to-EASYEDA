import React, { useState, useCallback, useRef } from 'react';
import { SchematicCanvas } from './components/SchematicCanvas';
import { PCBCanvas } from './components/PCBCanvas';
import { PartsPanel } from './components/PartsPanel';
import { ChatPanel } from './components/ChatPanel';
import { Toolbar } from './components/Toolbar';
import { useProject } from './hooks/useProject';
import { useToolExecution } from './hooks/useToolExecution';
import type { JLCPCBPart, Point } from '../core/types';
import { runDRC, type DRCViolation } from '../core/design-rules';

export function App() {
  const {
    project, editorState, setEditorState, updateProject,
    addSchematicComponent, addWire, addNet, addNetLabel,
    addPCBComponent, addTrack, addVia,
    moveComponent, deleteSelected,
    exportToEasyEDA, exportProjectFile, importProjectFile,
  } = useProject();

  const [drcViolations, setDrcViolations] = useState<DRCViolation[]>([]);
  const [showDRC, setShowDRC] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('anthropic_api_key') ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [nextRef, setNextRef] = useState<Record<string, number>>({});

  const executeTool = useToolExecution({ project, updateProject });

  const getNextRef = useCallback((prefix: string): string => {
    const num = (nextRef[prefix] ?? 0) + 1;
    setNextRef(prev => ({ ...prev, [prefix]: num }));
    return `${prefix}${num}`;
  }, [nextRef]);

  const handlePlacePart = useCallback((part: JLCPCBPart, position: Point) => {
    let prefix = 'U';
    const desc = (part.description + ' ' + part.category).toLowerCase();
    if (desc.includes('resistor') || desc.includes('resistance')) prefix = 'R';
    else if (desc.includes('capacitor') || desc.includes('capacitance')) prefix = 'C';
    else if (desc.includes('inductor') || desc.includes('inductance')) prefix = 'L';
    else if (desc.includes('diode') || desc.includes('led')) prefix = 'D';
    else if (desc.includes('transistor') || desc.includes('mosfet') || desc.includes('bjt')) prefix = 'Q';
    else if (desc.includes('connector') || desc.includes('header')) prefix = 'J';
    else if (desc.includes('crystal') || desc.includes('oscillator')) prefix = 'Y';
    else if (desc.includes('fuse')) prefix = 'F';
    else if (desc.includes('switch') || desc.includes('button')) prefix = 'SW';

    const ref = getNextRef(prefix);
    addSchematicComponent(part, position, ref, part.mfr || part.description.slice(0, 20));
  }, [addSchematicComponent, getNextRef]);

  const handleRunDRC = useCallback(() => {
    const violations = runDRC(project);
    setDrcViolations(violations);
    setShowDRC(true);
  }, [project]);

  const handleImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        importProjectFile(reader.result);
      }
    };
    reader.readAsText(file);
  }, [importProjectFile]);

  const handleSelectIds = useCallback((ids: string[]) => {
    setEditorState(prev => ({ ...prev, selectedIds: ids }));
  }, [setEditorState]);

  const handleAddWire = useCallback((points: Point[], netId: string) => {
    if (!netId) {
      netId = addNet(`Net_${project.schematic.nets.length + 1}`);
    }
    addWire(points, netId);
  }, [addWire, addNet, project.schematic.nets.length]);

  const handleAddTrack = useCallback((points: Point[], netId: string) => {
    addTrack(points, netId, editorState.activeLayer);
  }, [addTrack, editorState.activeLayer]);

  const handleApiKeyChange = useCallback((key: string) => {
    setApiKey(key);
    localStorage.setItem('anthropic_api_key', key);
  }, []);

  return (
    <div style={styles.container}>
      <Toolbar
        editorState={editorState}
        onEditorStateChange={setEditorState}
        onExportEasyEDA={exportToEasyEDA}
        onExportProject={exportProjectFile}
        onImportProject={handleImport}
        onRunDRC={handleRunDRC}
        onDelete={deleteSelected}
        drcCount={drcViolations.length}
      />

      <div style={styles.main}>
        {/* Parts panel */}
        <div style={styles.sidePanel}>
          <PartsPanel onPlacePart={handlePlacePart} />
        </div>

        {/* Canvas */}
        <div style={styles.canvas}>
          {editorState.mode === 'schematic' ? (
            <SchematicCanvas
              project={project}
              editorState={editorState}
              onEditorStateChange={setEditorState}
              onMoveComponent={moveComponent}
              onAddWire={handleAddWire}
              onSelectIds={handleSelectIds}
            />
          ) : (
            <PCBCanvas
              project={project}
              editorState={editorState}
              onEditorStateChange={setEditorState}
              onMoveComponent={moveComponent}
              onAddTrack={handleAddTrack}
              onAddVia={(pos) => addVia(pos, '')}
              onSelectIds={handleSelectIds}
            />
          )}
        </div>

        {/* Chat Panel */}
        {showChat && (
          <div style={styles.chatPanel}>
            <ChatPanel
              project={project}
              onToolCall={executeTool}
              apiKey={apiKey}
              onApiKeyChange={handleApiKeyChange}
            />
          </div>
        )}

        {/* DRC Panel */}
        {showDRC && (
          <div style={styles.drcPanel}>
            <div style={styles.drcHeader}>
              <h4 style={styles.drcTitle}>DRC Results</h4>
              <button style={styles.drcClose} onClick={() => setShowDRC(false)}>x</button>
            </div>
            {drcViolations.length === 0 ? (
              <div style={styles.drcOk}>No violations found!</div>
            ) : (
              <div style={styles.drcList}>
                {drcViolations.map((v, i) => (
                  <div key={i} style={{
                    ...styles.drcItem,
                    borderLeftColor: v.severity === 'error' ? '#cc3333' : '#ccaa33',
                  }}>
                    <div style={styles.drcType}>{v.type.replace(/_/g, ' ')}</div>
                    <div style={styles.drcMsg}>{v.message}</div>
                    <div style={styles.drcLoc}>
                      ({v.location.x.toFixed(2)}, {v.location.y.toFixed(2)})mm
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Toggle chat button */}
      <button
        style={styles.chatToggle}
        onClick={() => setShowChat(!showChat)}
        title={showChat ? 'Hide Claude chat' : 'Show Claude chat'}
      >
        {showChat ? 'Hide Chat' : 'Claude AI'}
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.cpcb.json"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    width: '100vw',
    height: '100vh',
    background: '#0a0a1a',
    color: '#ccccee',
    position: 'relative',
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidePanel: {
    width: 300,
    minWidth: 260,
    borderRight: '1px solid #303060',
    overflow: 'hidden',
  },
  canvas: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  chatPanel: {
    width: 380,
    minWidth: 320,
    borderLeft: '1px solid #303060',
    overflow: 'hidden',
  },
  drcPanel: {
    width: 280,
    borderLeft: '1px solid #303060',
    background: '#1a1a2e',
    overflow: 'auto',
  },
  drcHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #303060',
  },
  drcTitle: { margin: 0, fontSize: 14, color: '#66aaff' },
  drcClose: {
    background: 'none', border: 'none', color: '#888', fontSize: 18, cursor: 'pointer',
  },
  drcOk: { padding: 20, textAlign: 'center', color: '#66cc66', fontSize: 14 },
  drcList: { padding: 8 },
  drcItem: {
    padding: '8px', marginBottom: 4, background: '#252545', borderRadius: 3, borderLeft: '3px solid',
  },
  drcType: {
    fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', color: '#aaa', marginBottom: 2,
  },
  drcMsg: { fontSize: 12, color: '#ddd', marginBottom: 2 },
  drcLoc: { fontSize: 10, color: '#666' },
  chatToggle: {
    position: 'absolute',
    bottom: 36,
    right: 12,
    padding: '8px 16px',
    background: '#6644aa',
    border: 'none',
    borderRadius: 20,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 12,
    zIndex: 100,
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
};
