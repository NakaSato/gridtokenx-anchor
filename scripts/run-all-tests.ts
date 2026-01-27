
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const testsDir = path.join(process.cwd(), 'tests');

// Use readdirSync safely or use args
let files: string[] = [];
if (process.argv.length > 2) {
    // Arguments passed (e.g. tests/periodic-auction.ts)
    // Filter args that are files
    files = process.argv.slice(2).map(f => path.basename(f)).filter(f => f.endsWith('.ts'));
} else {
    try {
        files = fs.readdirSync(testsDir).filter(f => f.endsWith('.ts') && f !== 'setup.ts');
    } catch (e) {
        console.error(`Error reading tests directory: ${e}`);
        process.exit(1);
    }
}

console.log(`Found ${files.length} test files to run.`);

let failed = false;

for (const file of files) {
    console.log(`\n---------------------------------------------------------`);
    console.log(`Running test: ${file}`);
    console.log(`---------------------------------------------------------`);

    const filePath = path.join(testsDir, file);
    let content = "";
    try {
        content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
        console.error(`Failed to read file ${file}: ${e}`);
        failed = true;
        continue;
    }

    try {
        // Check if the file imports from setup (Type A: Standalone script)
        // imports could be '"./setup"' or '"./setup.ts"' or "'./setup'"
        // We check for import of setup to determine if we should run with tsx directly or mocha
        if (content.includes('from "./setup"') || content.includes("from './setup'") ||
            content.includes('from "./setup.ts"') || content.includes("from './setup.ts'")) {
            console.log(`TYPE: Standalone Script (using tsx)`);
            execSync(`npx tsx ${filePath}`, { stdio: 'inherit', env: process.env });
        } else {
            console.log(`TYPE: Mocha Test (using mocha)`);
            // Use mocha with tsx loader for Type B
            // We set timeout to a high value just in case
            execSync(`npx mocha --import=tsx ${filePath} --timeout 150000`, { stdio: 'inherit', env: process.env });
        }
        console.log(`\n✅ Test ${file} passed.`);
    } catch (error) {
        console.error(`\n❌ Test ${file} failed.`);
        failed = true;
        // We allow other tests to run so we get a full report
    }
}

if (failed) {
    console.error('\nOne or more tests failed.');
    process.exit(1);
} else {
    console.log('\nAll tests passed successfully.');
    process.exit(0);
}
