#!/usr/bin/env node

// CLI interface for Claude PCB Designer
// Usage:
//   npx tsx src/cli/index.ts new "My Project" --path ./my-project.cpcb.json
//   npx tsx src/cli/index.ts search "STM32F103"
//   npx tsx src/cli/index.ts add-part C12345 --ref U --value STM32F103
//   npx tsx src/cli/index.ts export --format easyeda
//   npx tsx src/cli/index.ts drc
//   npx tsx src/cli/index.ts info

import * as fs from 'fs';
import * as path from 'path';
import { createProject, serializeProject, deserializeProject, generateId, updateBOM } from '../core/project';
import { searchByText, searchParts } from '../parts/jlcpcb-api';
import { runDRC } from '../core/design-rules';
import { exportProjectForEasyEDA } from '../core/easyeda-export';
import type { Project, SchematicComponent, PCBComponent } from '../core/types';

const args = process.argv.slice(2);
const command = args[0];

function getFlag(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

function findProjectFile(): string | null {
  const explicit = getFlag('project') ?? getFlag('p');
  if (explicit) return explicit;

  // Look in current directory
  const files = fs.readdirSync('.').filter(f => f.endsWith('.cpcb.json'));
  return files[0] ?? null;
}

function loadProject(filePath: string): Project {
  return deserializeProject(fs.readFileSync(filePath, 'utf-8'));
}

function saveProject(project: Project, filePath: string) {
  project.modified = new Date().toISOString();
  fs.writeFileSync(filePath, serializeProject(project), 'utf-8');
  console.log(`Saved to ${filePath}`);
}

async function main() {
  switch (command) {
    case 'new': {
      const name = args[1] ?? 'Untitled';
      const desc = getFlag('description') ?? '';
      const filePath = getFlag('path') ?? `./${name.replace(/[^a-zA-Z0-9_-]/g, '_')}.cpcb.json`;

      const project = createProject(name, desc);
      saveProject(project, filePath);
      console.log(`Created project: ${name}`);
      break;
    }

    case 'search': {
      const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
      if (!query) {
        console.log('Usage: search <query>');
        break;
      }

      const limit = Number(getFlag('limit') ?? 20);
      console.log(`Searching JLCPCB parts: "${query}"...`);

      const parts = await searchByText(query, limit);
      if (parts.length === 0) {
        console.log('No parts found.');
        break;
      }

      console.log(`\nFound ${parts.length} parts:\n`);
      console.log('LCSC       | Package    | Stock      | Price  | Description');
      console.log('-'.repeat(80));
      for (const p of parts) {
        const stock = p.stock > 0 ? String(p.stock).padStart(8) : '  OUT   ';
        console.log(
          `${p.lcsc.padEnd(10)} | ${p.package.padEnd(10)} | ${stock} | $${p.price.toFixed(4)} | ${p.description.slice(0, 40)}`
        );
      }
      break;
    }

    case 'add-part': {
      const lcsc = args[1];
      if (!lcsc) {
        console.log('Usage: add-part <LCSC> --ref <prefix> --value <value>');
        break;
      }

      const projectFile = findProjectFile();
      if (!projectFile) {
        console.log('No project file found. Create one first with: new <name>');
        break;
      }

      const project = loadProject(projectFile);
      const refPrefix = getFlag('ref') ?? 'U';
      const value = getFlag('value') ?? '';
      const x = Number(getFlag('x') ?? 400);
      const y = Number(getFlag('y') ?? 300);

      // Search for the part
      const parts = await searchByText(lcsc, 5);
      const part = parts.find(p => p.lcsc === lcsc) ?? parts[0];
      if (!part) {
        console.log(`Part ${lcsc} not found`);
        break;
      }

      if (!project.parts.find(p => p.lcsc === part.lcsc)) {
        project.parts.push(part);
      }

      // Count existing refs
      const existingCount = project.schematic.components.filter(c => c.reference.startsWith(refPrefix)).length;
      const ref = `${refPrefix}${existingCount + 1}`;

      const comp: SchematicComponent = {
        id: generateId('sc'),
        partId: part.lcsc,
        reference: ref,
        value: value || part.mfr,
        position: { x, y },
        rotation: 0,
        mirror: false,
        pins: part.pins ?? [],
        properties: {},
      };
      project.schematic.components.push(comp);

      if (part.footprint) {
        const pcbComp: PCBComponent = {
          id: generateId('pc'),
          schematicRef: comp.id,
          partId: part.lcsc,
          reference: ref,
          footprint: part.footprint,
          position: { x: 10 + existingCount * 15, y: 10 },
          rotation: 0,
          layer: 'top',
          locked: false,
        };
        project.pcb.components.push(pcbComp);
      }

      saveProject(project, projectFile);
      console.log(`Added ${ref} (${part.lcsc}) - ${part.description}`);
      break;
    }

    case 'export': {
      const projectFile = findProjectFile();
      if (!projectFile) {
        console.log('No project file found.');
        break;
      }

      const format = getFlag('format') ?? 'easyeda';
      let project = loadProject(projectFile);
      project = updateBOM(project);

      if (format === 'easyeda') {
        const exported = exportProjectForEasyEDA(project);
        const baseName = project.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const outDir = getFlag('output') ?? '.';

        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, `${baseName}_schematic.json`), JSON.stringify(exported.schematic, null, 2));
        fs.writeFileSync(path.join(outDir, `${baseName}_pcb.json`), JSON.stringify(exported.pcb, null, 2));
        fs.writeFileSync(path.join(outDir, `${baseName}_bom.csv`), exported.bom);

        console.log(`Exported to EasyEDA format:`);
        console.log(`  ${baseName}_schematic.json`);
        console.log(`  ${baseName}_pcb.json`);
        console.log(`  ${baseName}_bom.csv`);
        console.log(`\nTo import: Open EasyEDA > File > Import > EasyEDA Standard`);
      } else if (format === 'bom') {
        const bomLines = [
          'Comment,Designator,Footprint,LCSC Part Number,Quantity',
          ...project.bom.map(e =>
            `"${e.value}","${e.reference.join(',')}","${e.footprint}","${e.lcsc}",${e.quantity}`
          ),
        ];
        const outFile = getFlag('output') ?? `${project.name}_bom.csv`;
        fs.writeFileSync(outFile, bomLines.join('\n'));
        console.log(`BOM exported to ${outFile}`);
      }
      break;
    }

    case 'drc': {
      const projectFile = findProjectFile();
      if (!projectFile) {
        console.log('No project file found.');
        break;
      }

      const project = loadProject(projectFile);
      const violations = runDRC(project);

      if (violations.length === 0) {
        console.log('DRC passed - no violations found!');
      } else {
        console.log(`DRC found ${violations.length} violation(s):\n`);
        for (const v of violations) {
          const icon = v.severity === 'error' ? 'ERROR' : 'WARN ';
          console.log(`[${icon}] ${v.type}: ${v.message}`);
          console.log(`        at (${v.location.x.toFixed(2)}, ${v.location.y.toFixed(2)})mm`);
        }
      }
      break;
    }

    case 'info': {
      const projectFile = findProjectFile();
      if (!projectFile) {
        console.log('No project file found.');
        break;
      }

      const project = loadProject(projectFile);
      console.log(`Project: ${project.name}`);
      console.log(`Description: ${project.description || '(none)'}`);
      console.log(`Created: ${project.created}`);
      console.log(`Modified: ${project.modified}`);
      console.log(`\nSchematic:`);
      console.log(`  Components: ${project.schematic.components.length}`);
      console.log(`  Wires: ${project.schematic.wires.length}`);
      console.log(`  Nets: ${project.schematic.nets.length}`);
      console.log(`\nPCB:`);
      console.log(`  Components: ${project.pcb.components.length}`);
      console.log(`  Tracks: ${project.pcb.tracks.length}`);
      console.log(`  Vias: ${project.pcb.vias.length}`);
      console.log(`  Board: ${project.pcb.boardOutline.width}mm × ${project.pcb.boardOutline.height}mm`);
      console.log(`  Layers: ${project.pcb.layerCount}`);
      console.log(`\nDesign Rules (JLCPCB):`);
      console.log(`  Min trace width: ${project.designRules.minTraceWidth}mm`);
      console.log(`  Min trace spacing: ${project.designRules.minTraceSpacing}mm`);
      console.log(`  Min via drill: ${project.designRules.minViaDrill}mm`);
      console.log(`  Min via diameter: ${project.designRules.minViaDiameter}mm`);

      if (project.schematic.components.length > 0) {
        console.log(`\nComponents:`);
        for (const c of project.schematic.components) {
          console.log(`  ${c.reference}: ${c.value} (${c.partId})`);
        }
      }
      break;
    }

    default:
      console.log(`
Claude PCB Designer - CLI

Commands:
  new <name>                   Create a new project
  search <query>               Search JLCPCB parts library
  add-part <LCSC>              Add a part to the project
  export --format easyeda      Export to EasyEDA format
  export --format bom          Export BOM only
  drc                          Run design rule check
  info                         Show project info

Flags:
  --project <path>             Specify project file
  --ref <prefix>               Reference designator prefix (R, C, U, etc.)
  --value <value>              Component value
  --limit <n>                  Search result limit
  --output <dir>               Output directory

Examples:
  npx tsx src/cli/index.ts new "LED Blinker"
  npx tsx src/cli/index.ts search "STM32F103 LQFP48"
  npx tsx src/cli/index.ts add-part C8734 --ref U --value STM32F103C8T6
  npx tsx src/cli/index.ts export --format easyeda
      `);
  }
}

main().catch(console.error);
