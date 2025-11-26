import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const IDL_DIR = path.join(__dirname, '../target/idl');
const OUT_DIR = path.join(__dirname, '../sdk/src');

const PROGRAMS = [
  'energy_token',
  'governance',
  'oracle',
  'registry',
  'trading'
];

function toCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

// Specific function to convert IDL structure to match Anchor's expected type definition
function processIdl(idl: any) {
  // Deep clone
  let newIdl = JSON.parse(JSON.stringify(idl));

  // Convert instruction names
  if (newIdl.instructions) {
    newIdl.instructions.forEach((ix: any) => {
      ix.name = toCamelCase(ix.name);
      if (ix.args) {
        ix.args.forEach((arg: any) => {
          arg.name = toCamelCase(arg.name);
        });
      }
      if (ix.accounts) {
        ix.accounts.forEach((acc: any) => {
          acc.name = toCamelCase(acc.name);
        });
      }
    });
  }

  // Convert account names
  if (newIdl.accounts) {
    newIdl.accounts.forEach((acc: any) => {
      acc.name = toCamelCase(acc.name);
    });
  }

  // Convert types fields
  if (newIdl.types) {
    newIdl.types.forEach((type: any) => {
      // Type names usually stay PascalCase, but fields become camelCase
      // Also need to handle type name references in fields if I were changing type names, 
      // but I'm keeping type names as is (usually PascalCase in IDL)

      // However, src/registry.ts had "meterType" (camelCase) for the type name reference.
      // But the definition in IDL is "MeterType".
      // If I don't change the definition name, I shouldn't change the reference.

      if (type.type.kind === 'struct' && type.type.fields) {
        type.type.fields.forEach((field: any) => {
          field.name = toCamelCase(field.name);
        });
      }
    });
  }

  // Convert events
  if (newIdl.events) {
    newIdl.events.forEach((evt: any) => {
      evt.name = toCamelCase(evt.name);
      if (evt.fields) {
        evt.fields.forEach((field: any) => {
          field.name = toCamelCase(field.name);
        });
      }
    });
  }

  // Convert errors
  if (newIdl.errors) {
    newIdl.errors.forEach((err: any) => {
      err.name = toCamelCase(err.name);
    });
  }

  return newIdl;
}

PROGRAMS.forEach(program => {
  const idlPath = path.join(IDL_DIR, `${program}.json`);
  if (fs.existsSync(idlPath)) {
    console.log(`Processing ${program}...`);
    const idlContent = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
    const processedIdl = processIdl(idlContent);

    // Determine type name (PascalCase)
    const typeName = program.split('_').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');

    const tsContent = `export type ${typeName} = ${JSON.stringify(processedIdl, null, 2)};`;

    const outPath = path.join(OUT_DIR, `${program}.ts`);
    fs.writeFileSync(outPath, tsContent);
    console.log(`Generated ${outPath}`);
  } else {
    console.error(`IDL not found: ${idlPath}`);
  }
});
