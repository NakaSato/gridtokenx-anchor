import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { Oracle } from "../target/types/oracle";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";

function findOracleDataPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("oracle_data")], programId);
}

function findMeterPda(meterId: string, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("meter"), Buffer.from(meterId)],
    programId
  );
}

async function getOnChainTimestamp(): Promise<BN> {
  return new BN(Math.floor(Date.now() / 1000));
}

// Diurnal Simulator Configuration
const DAY_SPEED_MULTIPLIER = 120; // 1 second real time = 2 minutes simulated time
const SIMULATION_INTERVAL_MS = 3000;

class DiurnalSimulator {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  // Gets simulated hour of the day (0-23.99)
  getSimulatedHour(): number {
    const elapsedRealSeconds = (Date.now() - this.startTime) / 1000;
    const elapsedSimSeconds = elapsedRealSeconds * DAY_SPEED_MULTIPLIER;
    const hours = (elapsedSimSeconds / 3600) % 24;
    // Start simulation at 6 AM
    return (hours + 6) % 24;
  }

  getSolarGeneration(hour: number, maxCapacity: number): number {
    // Solar generation curve: peaks at noon (12:00), zero before 6:00 and after 18:00
    if (hour < 6 || hour > 18) return 0;
    // Simple parabola: max at 12, zero at 6 and 18
    const distanceToNoon = Math.abs(hour - 12);
    const intensity = Math.max(0, 1 - (distanceToNoon / 6) ** 2);
    return Math.floor(maxCapacity * intensity);
  }

  getHouseholdConsumption(hour: number, maxLoad: number): number {
    // Household consumption: low during day, peaks in evening (18:00 - 22:00), medium in morning (7:00 - 9:00)
    let intensity = 0.2; // Base load
    if (hour >= 6 && hour < 10) {
      // Morning peak
      const dist = Math.abs(hour - 8);
      intensity += Math.max(0, 0.5 * (1 - dist / 2));
    } else if (hour >= 17 && hour < 23) {
      // Evening peak
      const dist = Math.abs(hour - 20);
      intensity += Math.max(0, 0.8 * (1 - dist / 3));
    }
    return Math.floor(maxLoad * Math.min(1, intensity));
  }
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const oracleProgram = anchor.workspace.Oracle as Program<Oracle>;
  
  // Load API Gateway Keypair (Admin)
  let apiGateway: Keypair;
  try {
    apiGateway = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync("test-api-gateway.json", "utf8"))));
  } catch (e) {
    console.error("Failed to load test-api-gateway.json. Have you run bootstrap.ts?");
    process.exit(1);
  }

  const [oracleDataPda] = findOracleDataPda(oracleProgram.programId);
  const meters = [
    { id: "METER_SOLAR_1", maxGen: 500, maxCons: 10, type: "Solar Farm" },
    { id: "METER_HOUSE_1", maxGen: 50, maxCons: 200, type: "Household (with Rooftop)" },
    { id: "METER_HOUSE_2", maxGen: 0, maxCons: 150, type: "Household (No Solar)" },
  ];

  console.log("⚡ Starting Real-time Oracle Meter Stream...");
  console.log(`Oracle PDA: ${oracleDataPda.toBase58()}`);
  
  const simulator = new DiurnalSimulator();
  let step = 1;

  setInterval(async () => {
    const simHour = simulator.getSimulatedHour();
    const timeStr = `${Math.floor(simHour).toString().padStart(2, '0')}:${Math.floor((simHour % 1) * 60).toString().padStart(2, '0')}`;
    
    console.log(`\n🕒 [Simulated Time: ${timeStr}] - Stream Cycle #${step}`);
    const timestamp = await getOnChainTimestamp();

    // Generate batch promises for parallel submission
    const txPromises = meters.map((meter, idx) => {
      const generated = simulator.getSolarGeneration(simHour, meter.maxGen);
      const consumed = simulator.getHouseholdConsumption(simHour, meter.maxCons);
      
      const [meterStatePda] = findMeterPda(meter.id, oracleProgram.programId);
      
      console.log(`  📊 ${meter.id.padEnd(15)} | Gen: ${generated.toString().padStart(4)} kWh | Cons: ${consumed.toString().padStart(4)} kWh | ${meter.type}`);

      return oracleProgram.methods
        .submitMeterReading(meter.id, new BN(generated), new BN(consumed), timestamp, step * 10 + idx)
        .accounts({
          oracleData: oracleDataPda,
          meterState: meterStatePda,
          authority: apiGateway.publicKey,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([apiGateway])
        .rpc()
        .catch(e => {
          console.error(`  ❌ Failed to submit reading for ${meter.id}: ${e.message}`);
        });
    });

    await Promise.all(txPromises);
    step++;
  }, SIMULATION_INTERVAL_MS);
}

// Start simulation
main().catch(err => {
  console.error(err);
  process.exit(1);
});
