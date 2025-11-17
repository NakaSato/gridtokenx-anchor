// Codama configuration for Registry program
import { createCodamaConfig } from './src/create-codama-config.js'

export default createCodamaConfig({
  idl: 'target/idl/registry.json',
  clientJs: 'anchor/src/client/js/registry',
})
