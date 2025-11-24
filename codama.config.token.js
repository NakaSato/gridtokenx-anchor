// Codama configuration for Energy Token program
import { createCodamaConfig } from "./src/create-codama-config.js";

export default createCodamaConfig({
  idl: "target/idl/energy_token.json",
  clientJs: "anchor/src/client/js/token",
});
