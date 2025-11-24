#!/usr/bin/env node
import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { resolve } from 'path'

const programs = [
  { name: 'registry', idlName: 'registry' },
  { name: 'oracle', idlName: 'oracle' },
  { name: 'governance', idlName: 'governance' },
  { name: 'token', idlName: 'energy_token' },
  { name: 'trading', idlName: 'trading' },
]

// Parse command line arguments
const args = process.argv.slice(2)
const command = args[0] || 'js' // Default to 'js' if no argument provided

let targets = []
if (command === 'js') {
  targets = ['js']
} else if (command === 'rust') {
  targets = ['rust']
} else if (command === '--all' || command === 'all') {
  targets = ['js', 'rust']
} else {
  console.error(`❌ Unknown command: ${command}`)
  console.log(`   Usage: node scripts/06-generate-clients.js [js|rust|--all]`)
  process.exit(1)
}

console.log(`🚀 Generating Codama clients (${targets.join(', ')}) for all programs...\n`)

let successCount = 0
let failureCount = 0

programs.forEach((program, index) => {
  console.log(`[${index + 1}/${programs.length}] Generating ${program.name}...`)

  const idlPath = resolve(`target/idl/${program.idlName}.json`)

  if (!existsSync(idlPath)) {
    console.error(`❌ IDL not found: ${idlPath}`)
    console.log(`   Run: anchor build\n`)
    failureCount++
    return
  }

  try {
    const configPath = `./codama.config.${program.name}.js`
    
    // Generate clients for each target
    targets.forEach(target => {
      execSync(`npx codama run ${target} -c ${configPath}`, {
        stdio: 'inherit',
        cwd: process.cwd(),
      })
    })
    
    console.log(`✅ ${program.name} client generated\n`)
    successCount++
  } catch (error) {
    console.error(`❌ Failed to generate ${program.name} client`)
    console.error(error.message)
    failureCount++
  }
})

console.log('\n' + '='.repeat(50))
console.log(`✨ Generation complete!`)
console.log(`   ✅ Success: ${successCount}/${programs.length}`)
if (failureCount > 0) {
  console.log(`   ❌ Failed: ${failureCount}/${programs.length}`)
  process.exit(1)
}
console.log('='.repeat(50))
