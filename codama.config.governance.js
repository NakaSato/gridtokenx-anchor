// Codama configuration for Governance program
import { createCodamaConfig } from './src/create-codama-config.js'

export default createCodamaConfig({
  idl: 'target/idl/governance.json',
  clientJs: 'anchor/src/client/js/governance',
})
