# Claude PCB Designer

AI-powered PCB design tool that integrates with **JLCPCB's parts library** and exports to **EasyEDA** format. Describe your project to Claude, and it will help you engineer a functioning PCB — from part selection to schematic to layout to manufacturing.

## Features

- **JLCPCB Parts Search** — Search millions of parts with real-time stock and pricing. Filter by basic/preferred parts for cheapest assembly.
- **Auto-Generated Footprints** — Common packages (0805, SOIC-8, QFP, QFN, SOT-23, etc.) are auto-generated with correct pad geometry.
- **JLCPCB Design Rules** — Built-in DRC checks against JLCPCB manufacturing capabilities (trace width, spacing, via sizes, clearances).
- **EasyEDA Export** — Generates EasyEDA Standard JSON format for direct import into EasyEDA/JLCPCB workflow.
- **Visual Editor** — Web-based schematic and PCB editor with drag-and-drop, wiring, and track routing.
- **MCP Server** — Claude can directly manipulate designs through 20+ tools (search parts, place components, route traces, run DRC, export).
- **CLI** — Command-line interface for scripted workflows.
- **BOM Generation** — Automatic Bill of Materials with LCSC part numbers for JLCPCB assembly.

## Quick Start

```bash
# Install dependencies
npm install

# Start the visual editor
npm run dev
# Open http://localhost:3000

# Or use the CLI
npx tsx src/cli/index.ts new "My Project"
npx tsx src/cli/index.ts search "STM32F103"
npx tsx src/cli/index.ts add-part C8734 --ref U --value STM32F103C8T6
npx tsx src/cli/index.ts export --format easyeda
```

## Claude Integration (MCP Server)

Add to your Claude Code settings or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pcb-designer": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/path/to/Claude-to-EASYEDA"
    }
  }
}
```

Then Claude can:
1. Search JLCPCB parts and show you options with stock/pricing
2. Add components to your design
3. Wire up the schematic
4. Set board size and route PCB traces
5. Run DRC against JLCPCB manufacturing rules
6. Export to EasyEDA format

### Example Conversation

> **You:** I want to build a simple LED blinker with an ATtiny85
>
> **Claude:** *searches for ATtiny85, LED, resistor, capacitor...*
> Here are the part options: [shows parts with stock and pricing]
>
> **You:** Use the basic parts where possible
>
> **Claude:** *adds components, wires schematic, routes PCB, runs DRC*
> Design complete! Exporting to EasyEDA...

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `search_parts` | Search JLCPCB parts (stock, price, package) |
| `add_component` | Add part to schematic + PCB |
| `add_wire` | Connect pins with wires |
| `add_net` / `add_net_label` | Create and label nets |
| `add_power_flag` | Add VCC/GND symbols |
| `move_component` / `rotate_component` | Position parts |
| `set_board_size` | Set PCB dimensions |
| `add_track` | Route PCB traces |
| `add_via` | Place vias |
| `add_copper_zone` | Add ground planes |
| `run_drc` | Check JLCPCB design rules |
| `export_easyeda` | Export to EasyEDA format |
| `create_project` / `save_project` / `load_project` | Project management |
| `get_project` | View current design state |

## Visual Editor

The web editor provides:
- **Schematic view** — Place components, draw wires, add net labels
- **PCB view** — Drag components, route tracks, add vias, set layers
- **Parts browser** — Search JLCPCB, filter by stock/basic/preferred
- **DRC panel** — View design rule violations
- **Export** — One-click export to EasyEDA format

### Controls
- **Scroll** — Zoom in/out
- **Middle-click drag** — Pan
- **Click** — Select/place
- **Double-click** — Finish wire/track
- **Escape** — Cancel operation
- **Delete** — Remove selected

## EasyEDA Import Workflow

1. Export from this tool (CLI or web editor)
2. Open [EasyEDA Standard](https://easyeda.com)
3. File → Import → EasyEDA (Standard)
4. Select the exported JSON files
5. Review and finalize in EasyEDA
6. Order from JLCPCB directly

## File Formats

| Extension | Description |
|-----------|-------------|
| `.cpcb.json` | Native project format (JSON) |
| `*_schematic.json` | EasyEDA schematic |
| `*_pcb.json` | EasyEDA PCB layout |
| `*_bom.csv` | JLCPCB assembly BOM |

## JLCPCB Design Rules (2-Layer Default)

| Parameter | Value |
|-----------|-------|
| Min trace width | 0.127mm (5 mil) |
| Min spacing | 0.127mm (5 mil) |
| Min via drill | 0.3mm |
| Min via diameter | 0.5mm |
| Copper to edge | 0.3mm |
| Default trace | 0.254mm (10 mil) |

## Project Structure

```
src/
├── core/           # Data model, design rules, EasyEDA export
├── parts/          # JLCPCB parts search (jlcsearch API)
├── editor/         # React web editor with Canvas rendering
├── mcp/            # MCP server for Claude integration
└── cli/            # Command-line interface
```

## License

MIT
