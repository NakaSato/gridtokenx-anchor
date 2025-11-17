// Codama configuration for Oracle program
import { createCodamaConfig } from './src/create-codama-config.js'

export default createCodamaConfig({
  idl: 'target/idl/oracle.json',
  clientJs: 'anchor/src/client/js/oracle',
})
