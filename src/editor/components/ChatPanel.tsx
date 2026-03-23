import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { Project, JLCPCBPart } from '../../core/types';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; result: string }[];
}

interface Props {
  project: Project;
  onToolCall: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
}

const SYSTEM_PROMPT = `You are an expert PCB design engineer helping users create printed circuit boards. You have access to tools that let you search JLCPCB parts, add components, wire schematics, route PCB traces, set board dimensions, run design rule checks, and export to EasyEDA format.

Your workflow:
1. Understand the user's project requirements
2. Search for appropriate parts (prefer JLCPCB basic/preferred parts for lower assembly cost)
3. Present part options with stock and pricing info
4. Add components the user approves
5. Wire the schematic with proper nets
6. Set appropriate board size based on component count and spacing needs
7. Place components on the PCB with good layout practices
8. Route traces respecting JLCPCB design rules
9. Run DRC to verify manufacturability
10. Export to EasyEDA when ready

Always consider:
- Board size constraints and component placement within the outline
- JLCPCB design rules (min 5mil trace/space for 2-layer, 0.3mm via drill)
- Decoupling capacitors near ICs
- Power and ground plane strategy
- Signal integrity for high-speed signals
- Thermal management

When placing components, think about the board size and arrange them logically.`;

const TOOLS_FOR_API = [
  {
    name: 'search_parts',
    description: 'Search JLCPCB parts library. Returns parts with stock, pricing, package.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query (e.g., "STM32F103", "10k 0805")' },
        package: { type: 'string', description: 'Package filter (e.g., "0805", "SOIC-8")' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_component',
    description: 'Add a component to the schematic and PCB.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lcsc: { type: 'string', description: 'LCSC part number' },
        ref_prefix: { type: 'string', description: 'Reference prefix (R, C, U, L, D, Q, J)' },
        value: { type: 'string', description: 'Component value' },
        x: { type: 'number', description: 'X position (mils for schematic)' },
        y: { type: 'number', description: 'Y position (mils for schematic)' },
        pin_names: { type: 'array', items: { type: 'string' }, description: 'Pin names in order' },
      },
      required: ['lcsc', 'ref_prefix'],
    },
  },
  {
    name: 'add_wire',
    description: 'Add a wire connecting pins/nets in the schematic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Wire path points (mils)' },
        net: { type: 'string', description: 'Net name' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_net_label',
    description: 'Place a net label on the schematic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Net name (e.g., "VCC", "GND")' },
        x: { type: 'number', description: 'X position (mils)' },
        y: { type: 'number', description: 'Y position (mils)' },
      },
      required: ['name', 'x', 'y'],
    },
  },
  {
    name: 'add_power_flag',
    description: 'Add a power or ground symbol.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Power net name' },
        type: { type: 'string', enum: ['power', 'ground'] },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['name', 'type', 'x', 'y'],
    },
  },
  {
    name: 'move_component',
    description: 'Move a component by reference designator.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Reference designator (e.g., "R1")' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['id', 'x', 'y'],
    },
  },
  {
    name: 'set_board_size',
    description: 'Set PCB board dimensions and shape. Supports rectangle, rounded_rect, circle. Can add mounting holes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        width: { type: 'number', description: 'Width in mm' },
        height: { type: 'number', description: 'Height in mm' },
        shape: { type: 'string', enum: ['rectangle', 'rounded_rect', 'circle'] },
        corner_radius: { type: 'number', description: 'Corner radius for rounded_rect (mm)' },
        mounting_holes: { type: 'boolean', description: 'Add M3 corner mounting holes' },
      },
      required: ['width', 'height'],
    },
  },
  {
    name: 'add_track',
    description: 'Add a PCB trace.',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } }, description: 'Track points (mm)' },
        net: { type: 'string' },
        layer: { type: 'string', description: 'top_copper or bottom_copper' },
        width: { type: 'number', description: 'Track width (mm)' },
      },
      required: ['points'],
    },
  },
  {
    name: 'add_via',
    description: 'Add a via.',
    input_schema: {
      type: 'object' as const,
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        net: { type: 'string' },
      },
      required: ['x', 'y'],
    },
  },
  {
    name: 'add_copper_zone',
    description: 'Add a copper pour (e.g., ground plane).',
    input_schema: {
      type: 'object' as const,
      properties: {
        points: { type: 'array', items: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } } },
        net: { type: 'string', description: 'Net name (e.g., "GND")' },
        layer: { type: 'string' },
      },
      required: ['points', 'net'],
    },
  },
  {
    name: 'run_drc',
    description: 'Run design rule check against JLCPCB manufacturing rules.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'export_easyeda',
    description: 'Export to EasyEDA format for JLCPCB manufacturing.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_project',
    description: 'Get current project state (components, nets, board info).',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'get_board_info',
    description: 'Get board outline details, mounting holes, which components are outside or too close to edges.',
    input_schema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

export function ChatPanel({ project, onToolCall, apiKey, onApiKeyChange }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showApiKey, setShowApiKey] = useState(!apiKey);
  const [keyInput, setKeyInput] = useState(apiKey);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const saveApiKey = useCallback(() => {
    onApiKeyChange(keyInput);
    localStorage.setItem('anthropic_api_key', keyInput);
    setShowApiKey(false);
  }, [keyInput, onApiKeyChange]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || !apiKey || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      // Build message history for API
      const apiMessages = [...messages, userMessage].map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      // Add current project context to the system prompt
      const projectContext = `\n\nCurrent project state:\n- Name: ${project.name}\n- Components: ${project.schematic.components.map(c => `${c.reference}(${c.value})`).join(', ') || 'none'}\n- Nets: ${project.schematic.nets.map(n => n.name).join(', ') || 'none'}\n- Board: ${project.pcb.boardOutline.width}x${project.pcb.boardOutline.height}mm ${project.pcb.boardOutline.shape}\n- PCB components: ${project.pcb.components.length}, Tracks: ${project.pcb.tracks.length}`;

      let assistantContent = '';
      const toolCalls: { name: string; result: string }[] = [];

      // Keep calling API until we get a final response (handle tool use loops)
      let currentMessages = apiMessages;
      let continueLoop = true;

      while (continueLoop) {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 4096,
            system: SYSTEM_PROMPT + projectContext,
            tools: TOOLS_FOR_API,
            messages: currentMessages,
          }),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new Error(`API error ${response.status}: ${err}`);
        }

        const data = await response.json();

        // Process response content blocks
        const textParts: string[] = [];
        const toolUseBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];

        for (const block of data.content) {
          if (block.type === 'text') {
            textParts.push(block.text);
          } else if (block.type === 'tool_use') {
            toolUseBlocks.push({ id: block.id, name: block.name, input: block.input });
          }
        }

        if (textParts.length > 0) {
          assistantContent += textParts.join('\n');
        }

        // If there are tool calls, execute them and continue
        if (toolUseBlocks.length > 0) {
          // Add assistant message with tool_use to conversation
          currentMessages = [
            ...currentMessages,
            { role: 'assistant' as const, content: data.content },
          ];

          // Execute each tool and collect results
          const toolResults: { type: 'tool_result'; tool_use_id: string; content: string }[] = [];

          for (const tool of toolUseBlocks) {
            try {
              const result = await onToolCall(tool.name, tool.input);
              const resultStr = JSON.stringify(result, null, 2);
              toolCalls.push({ name: tool.name, result: resultStr });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: resultStr,
              });
            } catch (err) {
              const errStr = JSON.stringify({ error: String(err) });
              toolCalls.push({ name: tool.name, result: errStr });
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tool.id,
                content: errStr,
              });
            }
          }

          // Add tool results to conversation
          currentMessages = [
            ...currentMessages,
            { role: 'user' as const, content: toolResults as any },
          ];

          // Continue loop to get Claude's next response
          continueLoop = true;
        } else {
          // No more tool calls, we're done
          continueLoop = false;
        }
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: assistantContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      }]);
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
      }]);
    }

    setLoading(false);
  }, [input, apiKey, loading, messages, project, onToolCall]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  if (showApiKey) {
    return (
      <div style={styles.panel}>
        <div style={styles.apiKeySetup}>
          <h3 style={styles.title}>Connect to Claude</h3>
          <p style={styles.subtitle}>
            Enter your Anthropic API key to enable AI-assisted PCB design.
          </p>
          <p style={styles.hint}>
            Get a key at <a href="https://console.anthropic.com" target="_blank" rel="noopener" style={styles.link}>console.anthropic.com</a>
          </p>
          <input
            type="password"
            style={styles.apiInput}
            value={keyInput}
            onChange={e => setKeyInput(e.target.value)}
            placeholder="sk-ant-..."
            onKeyDown={e => e.key === 'Enter' && saveApiKey()}
          />
          <button
            style={styles.connectBtn}
            onClick={saveApiKey}
            disabled={!keyInput.startsWith('sk-')}
          >
            Connect
          </button>
          <p style={styles.hint}>
            Your key is stored locally in your browser only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <h3 style={styles.title}>Claude PCB Engineer</h3>
        <button style={styles.keyBtn} onClick={() => setShowApiKey(true)} title="Change API key">
          key
        </button>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <div style={styles.welcome}>
            <p style={styles.welcomeText}>
              Describe your PCB project and I'll help you design it.
            </p>
            <div style={styles.suggestions}>
              {[
                'Build a simple LED blinker with a 555 timer',
                'Design a USB-C to UART adapter',
                'Create an ESP32 dev board with I2C sensors',
                'Make a power supply: 12V to 3.3V and 5V',
              ].map((s, i) => (
                <button
                  key={i}
                  style={styles.suggestion}
                  onClick={() => { setInput(s); }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={msg.role === 'user' ? styles.userMsg : styles.assistantMsg}>
            <div style={styles.msgRole}>{msg.role === 'user' ? 'You' : 'Claude'}</div>
            <div style={styles.msgContent}>{msg.content}</div>
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <div style={styles.toolCalls}>
                {msg.toolCalls.map((tc, j) => (
                  <details key={j} style={styles.toolCall}>
                    <summary style={styles.toolName}>{tc.name}</summary>
                    <pre style={styles.toolResult}>{tc.result}</pre>
                  </details>
                ))}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={styles.assistantMsg}>
            <div style={styles.msgRole}>Claude</div>
            <div style={styles.thinking}>Thinking...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div style={styles.inputArea}>
        <textarea
          style={styles.textInput}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe your PCB project..."
          rows={2}
          disabled={loading}
        />
        <button
          style={{
            ...styles.sendBtn,
            ...(loading || !input.trim() ? styles.sendBtnDisabled : {}),
          }}
          onClick={sendMessage}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    background: '#12122a',
    color: '#ccccee',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    borderBottom: '1px solid #303060',
  },
  title: {
    margin: 0,
    fontSize: 14,
    color: '#bb88ff',
  },
  keyBtn: {
    padding: '3px 8px',
    background: '#252545',
    border: '1px solid #404080',
    borderRadius: 3,
    color: '#888',
    cursor: 'pointer',
    fontSize: 10,
  },
  messages: {
    flex: 1,
    overflow: 'auto',
    padding: 8,
  },
  welcome: {
    padding: '20px 8px',
  },
  welcomeText: {
    color: '#888',
    fontSize: 13,
    marginBottom: 16,
    textAlign: 'center',
  },
  suggestions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  suggestion: {
    padding: '8px 12px',
    background: '#1e1e40',
    border: '1px solid #303060',
    borderRadius: 6,
    color: '#aaaacc',
    cursor: 'pointer',
    fontSize: 12,
    textAlign: 'left',
  },
  userMsg: {
    padding: '8px 12px',
    marginBottom: 8,
    background: '#1a2a4a',
    borderRadius: 8,
    borderBottomRightRadius: 2,
  },
  assistantMsg: {
    padding: '8px 12px',
    marginBottom: 8,
    background: '#1e1e3a',
    borderRadius: 8,
    borderBottomLeftRadius: 2,
  },
  msgRole: {
    fontSize: 10,
    color: '#666',
    marginBottom: 4,
    textTransform: 'uppercase',
    fontWeight: 'bold',
  },
  msgContent: {
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  thinking: {
    fontSize: 13,
    color: '#bb88ff',
    fontStyle: 'italic',
  },
  toolCalls: {
    marginTop: 8,
    borderTop: '1px solid #303060',
    paddingTop: 6,
  },
  toolCall: {
    marginBottom: 4,
  },
  toolName: {
    fontSize: 11,
    color: '#88aaff',
    cursor: 'pointer',
    padding: '2px 0',
  },
  toolResult: {
    fontSize: 10,
    color: '#888',
    background: '#0a0a20',
    padding: 6,
    borderRadius: 4,
    overflow: 'auto',
    maxHeight: 150,
    whiteSpace: 'pre-wrap',
    margin: '4px 0 0',
  },
  inputArea: {
    display: 'flex',
    gap: 6,
    padding: 8,
    borderTop: '1px solid #303060',
  },
  textInput: {
    flex: 1,
    padding: '8px 10px',
    background: '#1a1a3a',
    border: '1px solid #404080',
    borderRadius: 6,
    color: '#ccccee',
    fontSize: 13,
    resize: 'none',
    outline: 'none',
    fontFamily: 'inherit',
  },
  sendBtn: {
    padding: '8px 16px',
    background: '#6644aa',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 12,
    alignSelf: 'flex-end',
  },
  sendBtnDisabled: {
    opacity: 0.5,
    cursor: 'default',
  },
  apiKeySetup: {
    padding: 24,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 13,
    color: '#888',
    textAlign: 'center',
    margin: 0,
  },
  hint: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
    margin: 0,
  },
  link: {
    color: '#88aaff',
  },
  apiInput: {
    width: '100%',
    padding: '10px 12px',
    background: '#1a1a3a',
    border: '1px solid #404080',
    borderRadius: 6,
    color: '#ccccee',
    fontSize: 13,
    outline: 'none',
  },
  connectBtn: {
    padding: '10px 24px',
    background: '#6644aa',
    border: 'none',
    borderRadius: 6,
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: 14,
  },
};
