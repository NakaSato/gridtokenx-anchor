// Codama configuration for Trading program
import { createCodamaConfig } from "./src/create-codama-config.js";

export default createCodamaConfig({
  idl: "target/idl/trading.json",
  clientJs: "anchor/src/client/js/trading",
});
