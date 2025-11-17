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

console.log('🚀 Generating Codama clients for all programs...\n')

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
    // Generate client for this program
    const configPath = `./codama.config.${program.name}.js`
    execSync(`npx codama run js -c ${configPath}`, {
      stdio: 'inherit',
      cwd: resolve('anchor'),
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
