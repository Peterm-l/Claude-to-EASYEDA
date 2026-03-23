# Claude PCB Designer - Project Knowledge

## What This Tool Does

This is an AI-powered PCB design tool that integrates with JLCPCB's parts library and exports to EasyEDA format. It allows Claude to help users engineer functioning PCBs through conversation.

## Architecture

```
src/
├── core/                  # Core data model and logic
│   ├── types.ts           # TypeScript types for schematic, PCB, parts
│   ├── project.ts         # Project file management (create, save, load)
│   ├── design-rules.ts    # JLCPCB manufacturing rules + DRC engine
│   └── easyeda-export.ts  # EasyEDA Standard JSON format exporter
├── parts/                 # JLCPCB parts integration
│   └── jlcpcb-api.ts      # jlcsearch API client (stock, pricing, footprints)
├── editor/                # Web-based visual editor (React + Canvas)
│   ├── App.tsx             # Main app with schematic/PCB views
│   ├── main.tsx            # Entry point
│   ├── hooks/
│   │   └── useProject.ts  # Project state management hook
│   └── components/
│       ├── SchematicCanvas.tsx  # Interactive schematic editor
│       ├── PCBCanvas.tsx        # Interactive PCB layout editor
│       ├── PartsPanel.tsx       # JLCPCB parts search/browse panel
│       └── Toolbar.tsx          # Tool/layer/export controls
├── mcp/                   # MCP server for Claude integration
│   └── server.ts          # JSON-RPC stdio MCP server with all tools
└── cli/                   # Command-line interface
    └── index.ts           # CLI for project management
```

## MCP Tools Available

When using the MCP server, these tools are available:

### Parts
- `search_parts` - Search JLCPCB library (returns stock, price, package)
- `add_component` - Add a part to schematic + PCB
- `delete_component` - Remove a component

### Schematic
- `add_wire` - Connect pins with wires
- `add_net` - Create named nets
- `add_net_label` - Place net labels
- `add_power_flag` - Add VCC/GND symbols
- `move_component` - Reposition components
- `rotate_component` - Rotate components
- `delete_wire` - Remove a wire by ID
- `delete_net` - Remove a net and all associated wires/labels
- `delete_net_label` - Remove a net label by ID
- `delete_power_flag` - Remove a power/ground flag by ID
- `list_wires` - List all wires with their IDs and net connections

### PCB
- `set_board_size` - Set PCB dimensions
- `add_track` - Route traces
- `add_via` - Place vias
- `add_copper_zone` - Add copper pours (ground planes)
- `delete_track` - Remove a track by ID
- `delete_via` - Remove a via by ID
- `delete_copper_zone` - Remove a copper zone by ID
- `list_tracks` - List all tracks with their IDs, nets, and layers
- `list_vias` - List all vias with their IDs and positions

### Project
- `create_project` / `save_project` / `load_project`
- `get_project` - View current design state
- `run_drc` - Check against JLCPCB manufacturing rules
- `export_easyeda` - Export for EasyEDA import
- `set_design_rules` - Customize manufacturing constraints

## Design Rules (JLCPCB)

Default rules are for 2-layer boards:
- Min trace width: 0.127mm (5 mil)
- Min spacing: 0.127mm (5 mil)
- Min via drill: 0.3mm, diameter: 0.5mm
- Copper to edge: 0.3mm
- Default trace: 0.254mm (10 mil)

## Workflow

1. User describes their project
2. Claude searches for appropriate parts using `search_parts`
3. Claude presents part options (showing stock, price, basic/preferred status)
4. User picks parts, Claude adds them with `add_component`
5. Claude wires the schematic with `add_wire` and `add_net_label`
6. Claude sets board size and routes traces
7. User can open the web editor to visually adjust layout
8. Run DRC to verify manufacturability
9. Export to EasyEDA for final touches and ordering

## File Formats

- `.cpcb.json` - Native project format (JSON, human-readable)
- `*_schematic.json` - EasyEDA schematic export
- `*_pcb.json` - EasyEDA PCB export
- `*_bom.csv` - Bill of Materials for JLCPCB assembly

## Key Technical Details

- Parts data comes from jlcsearch.tscircuit.com (free, no auth needed)
- Footprints are auto-generated from package names (SOIC, QFP, QFN, 0805, etc.)
- EasyEDA format uses compressed ASCII with ~ delimiters
- Coordinates: schematic in mils (1 mil = 0.0254mm), PCB in mm
- EasyEDA units: 10mil per unit (1mm ≈ 3.937 units)
