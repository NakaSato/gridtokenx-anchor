
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { TpcBenchmark } from "../../../target/types/tpc_benchmark";
import * as fs from "fs";
import * as crypto from "crypto";

// TPC-C Constants
const ITEMS = 100; // Reduced for dev environment verification
const WAREHOUSES = 1;
const DISTRICTS_PER_WAREHOUSE = 10;
const CUSTOMERS_PER_DISTRICT = 30; // Reduced for dev environment verification
const BATCH_SIZE = 10; // Batch size for parallel processing

// NURand Constants
const NURAND_A_C_LAST = 255;
const NURAND_C_C_LAST = 223; // Constant for C_LAST

export class TpcClassLoader {
    provider: anchor.AnchorProvider;
    program: Program<TpcBenchmark>;
    wallet: anchor.Wallet;

    constructor(
        provider: anchor.AnchorProvider,
        program: Program<TpcBenchmark>
    ) {
        this.provider = provider;
        this.program = program;
        this.wallet = provider.wallet as anchor.Wallet;
    }

    // Helper: Generate random string
    randomString(length: number): string {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        return Array.from({ length }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join("");
    }

    // Helper: Generate random number
    randomNumber(min: number, max: number): number {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    // Helper: Generate Last Name (NURand)
    generateLastName(num: number): string {
        const syllables = [
            "BAR", "OUGHT", "ABLE", "PRI", "PRES",
            "ESE", "ANTI", "CALLY", "ATION", "EING"
        ];
        const s1 = syllables[Math.floor(num / 100)];
        const s2 = syllables[Math.floor((num % 100) / 10)];
        const s3 = syllables[num % 10];
        return s1 + s2 + s3;
    }

    // Helper: NURand for C_LAST
    nurandCLast(): number {
        return (((this.randomNumber(0, NURAND_A_C_LAST) | this.randomNumber(0, 999)) + NURAND_C_C_LAST) % 1000);
    }

    // 1. Initialize Benchmark Config
    async initializeBenchmark() {
        console.log("Initializing Benchmark State...");
        const [benchmarkPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("benchmark")],
            this.program.programId
        );

        try {
            await this.program.methods
                .initializeBenchmark({
                    warehouses: new BN(WAREHOUSES),
                    districtsPerWarehouse: DISTRICTS_PER_WAREHOUSE,
                    customersPerDistrict: CUSTOMERS_PER_DISTRICT,
                    totalItems: ITEMS,
                    durationSeconds: new BN(60),
                    warmupPercent: 10,
                    useRealTransactions: true,
                })
                .accounts({
                    benchmark: benchmarkPda,
                    authority: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            console.log("Benchmark State Initialized.");
        } catch (e: any) {
            if (e.message.includes("already in use")) {
                console.log("Benchmark State already initialized.");
            } else {
                console.error("Error initializing benchmark:", e);
                throw e;
            }
        }
    }

    // 2. Load Items
    async loadItems() {
        console.log(`Loading ${ITEMS} Items...`);
        let promises = [];
        for (let i = 1; i <= ITEMS; i++) {
            const [itemPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("item"), new BN(i).toArrayLike(Buffer, "le", 8)],
                this.program.programId
            );

            // Check if exists (optional optimization, skip for speed if fresh)
            // For robustness in re-run, we might just try to init and catch error

            const name = this.randomString(this.randomNumber(14, 24));
            const price = new BN(this.randomNumber(100, 10000)); // 1.00 to 100.00
            const data = this.randomString(this.randomNumber(26, 50));
            const imId = new BN(this.randomNumber(1, 10000));

            promises.push(
                this.program.methods
                    .initializeItem(
                        new BN(i),
                        imId,
                        name,
                        price,
                        data
                    )
                    .accounts({
                        item: itemPda,
                        authority: this.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc()
                    .then(() => {
                        if (i % 100 === 0) process.stdout.write(".");
                    })
                    .catch((e) => {
                        if (!e.message.includes("already in use")) {
                            console.error(`Error loading Item ${i}:`, e);
                        }
                    })
            );

            if (promises.length >= BATCH_SIZE) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        console.log("\nItems Loaded.");
    }

    // 3. Load Warehouse
    async loadWarehouses() {
        console.log(`Loading ${WAREHOUSES} Warehouses...`);
        for (let w = 1; w <= WAREHOUSES; w++) {
            const [warehousePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("warehouse"), new BN(w).toArrayLike(Buffer, "le", 8)],
                this.program.programId
            );

            const name = this.randomString(this.randomNumber(6, 10));
            const street1 = this.randomString(this.randomNumber(10, 20));
            const street2 = this.randomString(this.randomNumber(10, 20));
            const city = this.randomString(this.randomNumber(10, 20));
            const state = this.randomString(2).toUpperCase();
            const zip = this.randomNumber(10000, 99999).toString() + "1111";
            const tax = new BN(this.randomNumber(0, 2000)); // 0-20%

            try {
                await this.program.methods
                    .initializeWarehouse(
                        new BN(w),
                        name,
                        street1,
                        street2,
                        city,
                        state,
                        zip,
                        tax
                    )
                    .accounts({
                        warehouse: warehousePda,
                        authority: this.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`Warehouse ${w} initialized.`);
            } catch (e: any) {
                if (e.message.includes("already in use")) {
                    console.log(`Warehouse ${w} already initialized.`);
                } else {
                    console.error(`Error loading Warehouse ${w}:`, e);
                }
            }

            // Load Districts for this Warehouse
            await this.loadDistricts(w);

            // Load Stock for this Warehouse
            await this.loadStock(w);
        }
    }

    // 4. Load Districts
    async loadDistricts(w_id: number) {
        console.log(`Loading ${DISTRICTS_PER_WAREHOUSE} Districts for Warehouse ${w_id}...`);
        for (let d = 1; d <= DISTRICTS_PER_WAREHOUSE; d++) {
            const [districtPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("district"),
                    new BN(w_id).toArrayLike(Buffer, "le", 8),
                    new BN(d).toArrayLike(Buffer, "le", 8)
                ],
                this.program.programId
            );
            const [warehousePda] = PublicKey.findProgramAddressSync(
                [Buffer.from("warehouse"), new BN(w_id).toArrayLike(Buffer, "le", 8)],
                this.program.programId
            );

            const name = this.randomString(this.randomNumber(6, 10));
            const street1 = this.randomString(this.randomNumber(10, 20));
            const street2 = this.randomString(this.randomNumber(10, 20));
            const city = this.randomString(this.randomNumber(10, 20));
            const state = this.randomString(2).toUpperCase();
            const zip = this.randomNumber(10000, 99999).toString() + "1111";
            const tax = new BN(this.randomNumber(0, 2000));

            try {
                await this.program.methods
                    .initializeDistrict(
                        new BN(w_id),
                        new BN(d),
                        name,
                        street1,
                        street2,
                        city,
                        state,
                        zip,
                        tax
                    )
                    .accounts({
                        district: districtPda,
                        warehouse: warehousePda,
                        authority: this.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc();
                console.log(`  District ${w_id}-${d} initialized.`);
            } catch (e: any) {
                if (e.message.includes("already in use")) {
                    console.log(`  District ${w_id}-${d} already initialized.`);
                } else {
                    console.error(`  Error loading District ${w_id}-${d}:`, e);
                }
            }

            // Load Customers for this District
            await this.loadCustomers(w_id, d);
        }
    }

    // 5. Load Customers
    async loadCustomers(w_id: number, d_id: number) {
        console.log(`  Loading ${CUSTOMERS_PER_DISTRICT} Customers for District ${w_id}-${d_id}...`);
        let promises = [];
        const [districtPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from("district"),
                new BN(w_id).toArrayLike(Buffer, "le", 8),
                new BN(d_id).toArrayLike(Buffer, "le", 8)
            ],
            this.program.programId
        );

        for (let c = 1; c <= CUSTOMERS_PER_DISTRICT; c++) {
            const [customerPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("customer"),
                    new BN(w_id).toArrayLike(Buffer, "le", 8),
                    new BN(d_id).toArrayLike(Buffer, "le", 8),
                    new BN(c).toArrayLike(Buffer, "le", 8)
                ],
                this.program.programId
            );

            const first = this.randomString(this.randomNumber(8, 16));
            const middle = "OE";
            const last = c <= 1000 ? this.generateLastName(c - 1) : this.generateLastName(this.nurandCLast());
            const street1 = this.randomString(this.randomNumber(10, 20));
            const street2 = this.randomString(this.randomNumber(10, 20));
            const city = this.randomString(this.randomNumber(10, 20));
            const state = this.randomString(2).toUpperCase();
            const zip = this.randomNumber(10000, 99999).toString() + "1111";
            const phone = this.randomNumber(100000000, 999999999).toString().padEnd(16, '0');
            const credit = Math.random() < 0.1 ? { badCredit: {} } : { goodCredit: {} };
            const creditLim = new BN(5000000);
            const discount = new BN(this.randomNumber(0, 5000));

            // ALSO INITIALIZE CUSTOMER INDEX? Currently initialize_customer doesn't do it automatically
            // The program has separate instruction: initialize_customer_index.
            // But we need to hash the last name client side or in instruction?
            // initialize_customer_index takes last_name_hash.

            promises.push(
                this.program.methods
                    .initializeCustomer(
                        new BN(w_id),
                        new BN(d_id),
                        new BN(c),
                        first,
                        middle,
                        last,
                        street1,
                        street2,
                        city,
                        state,
                        zip,
                        phone,
                        credit as any,
                        creditLim,
                        discount
                    )
                    .accounts({
                        customer: customerPda,
                        district: districtPda,
                        authority: this.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc()
                    .catch((e) => {
                        if (!e.message.includes("already in use")) {
                            console.error(`Error loading Customer ${w_id}-${d_id}-${c}:`, e);
                        }
                    })
            );

            if (promises.length >= BATCH_SIZE) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        console.log(`  Customers for ${w_id}-${d_id} Loaded.`);
    }

    // 6. Load Stock
    async loadStock(w_id: number) {
        console.log(`Loading Stock for Warehouse ${w_id}...`);
        let promises = [];
        const [warehousePda] = PublicKey.findProgramAddressSync(
            [Buffer.from("warehouse"), new BN(w_id).toArrayLike(Buffer, "le", 8)],
            this.program.programId
        );

        for (let i = 1; i <= ITEMS; i++) {
            const [stockPda] = PublicKey.findProgramAddressSync(
                [
                    Buffer.from("stock"),
                    new BN(w_id).toArrayLike(Buffer, "le", 8),
                    new BN(i).toArrayLike(Buffer, "le", 8)
                ],
                this.program.programId
            );
            const [itemPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("item"), new BN(i).toArrayLike(Buffer, "le", 8)],
                this.program.programId
            );

            const quantity = new BN(this.randomNumber(10, 100));
            const distInfo = () => this.randomString(24);
            const data = this.randomString(this.randomNumber(26, 50));

            // Create original if needed (10%)
            let finalData = data;
            if (Math.random() < 0.1) {
                finalData = "ORIGINAL";
            }

            promises.push(
                this.program.methods
                    .initializeStock(
                        new BN(w_id),
                        new BN(i),
                        quantity,
                        distInfo(), distInfo(), distInfo(), distInfo(), distInfo(),
                        distInfo(), distInfo(), distInfo(), distInfo(), distInfo(),
                        finalData
                    )
                    .accounts({
                        stock: stockPda,
                        warehouse: warehousePda,
                        item: itemPda,
                        authority: this.wallet.publicKey,
                        systemProgram: SystemProgram.programId,
                    })
                    .rpc()
                    .catch((e) => {
                        if (!e.message.includes("already in use")) {
                            console.error(`Error loading Stock ${w_id}-${i}:`, e);
                        }
                    })
            );

            if (promises.length >= BATCH_SIZE) {
                await Promise.all(promises);
                promises = [];
            }
        }
        await Promise.all(promises);
        console.log(`Stock for Warehouse ${w_id} Loaded.`);
    }

    // 7. Data Optimization: Address Lookup Tables
    async createAndExtendAlts(warehouses: number, items: number) {
        console.log("Creating Address Lookup Tables (ALTs)...");

        // Use recent slot
        const slot = await this.provider.connection.getSlot();

        // 1. Create ALT for Items
        const itemPdas: PublicKey[] = [];
        for (let i = 1; i <= items; i++) {
            const [itemPda] = PublicKey.findProgramAddressSync(
                [Buffer.from("item"), new BN(i).toArrayLike(Buffer, "le", 8)],
                this.program.programId
            );
            itemPdas.push(itemPda);
        }

        console.log(`Generated ${itemPdas.length} Item PDAs.`);

        // Helper to create ALT
        const createAlt = async (addresses: PublicKey[], label: string) => {
            // Need fresh recent slot for the instruction to be valid
            // Using slot-1 to be safe against rapid slot advancement during simulation
            const freshSlot = await this.provider.connection.getSlot("finalized");

            console.log(`Using slot ${freshSlot} for ALT ${label}`);

            const [lookupTableInst, lookupTableAddress] =
                anchor.web3.AddressLookupTableProgram.createLookupTable({
                    authority: this.wallet.publicKey,
                    payer: this.wallet.publicKey,
                    recentSlot: freshSlot,
                });

            console.log(`Creating ALT ${label}: ${lookupTableAddress.toBase58()}`);

            // Create table
            await this.sendAndConfirm([lookupTableInst]);

            // Extend table in batches of 20
            const batchSize = 20;
            for (let i = 0; i < addresses.length; i += batchSize) {
                const batch = addresses.slice(i, i + batchSize);
                const extendInst = anchor.web3.AddressLookupTableProgram.extendLookupTable({
                    payer: this.wallet.publicKey,
                    authority: this.wallet.publicKey,
                    lookupTable: lookupTableAddress,
                    addresses: batch,
                });
                await this.sendAndConfirm([extendInst]);
                process.stdout.write(".");
            }
            console.log(" Done.");
            return lookupTableAddress.toBase58();
        };

        // Create Item ALTs
        const itemAltAddresses: string[] = [];
        for (let i = 0; i < itemPdas.length; i += 256) {
            const chunk = itemPdas.slice(i, i + 256);
            const addr = await createAlt(chunk, `Items-${i}`);
            itemAltAddresses.push(addr);
        }

        // 2. Create Stock ALTs
        console.log("Generating Stock PDAs...");
        const stockPdas: PublicKey[] = [];
        for (let w = 1; w <= warehouses; w++) {
            for (let i = 1; i <= items; i++) {
                const [stockPda] = PublicKey.findProgramAddressSync(
                    [
                        Buffer.from("stock"),
                        new BN(w).toArrayLike(Buffer, "le", 8),
                        new BN(i).toArrayLike(Buffer, "le", 8)
                    ],
                    this.program.programId
                );
                stockPdas.push(stockPda);
            }
        }

        const stockAltAddresses: string[] = [];
        // Max 256 addresses per ALT. 
        for (let i = 0; i < stockPdas.length; i += 256) {
            const chunk = stockPdas.slice(i, i + 256);
            const addr = await createAlt(chunk, `Stock-${i}`);
            stockAltAddresses.push(addr);
        }

        // Save ALT Registry to file
        const registry = {
            itemAlts: itemAltAddresses,
            stockAlts: stockAltAddresses,
            config: {
                itemCount: items,
                warehouseCount: warehouses
            }
        };

        fs.writeFileSync("tpc-c-alts.json", JSON.stringify(registry, null, 2));
        console.log("ALT Registry saved to tpc-c-alts.json");
    }

    // Helper for non-Anchor transactions
    async sendAndConfirm(instructions: anchor.web3.TransactionInstruction[]) {
        const tx = new anchor.web3.Transaction().add(...instructions);
        const latestBlockhash = await this.provider.connection.getLatestBlockhash();
        tx.recentBlockhash = latestBlockhash.blockhash;
        tx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
        tx.feePayer = this.wallet.publicKey;

        // Sign
        // @ts-ignore
        tx.sign(this.wallet.payer);

        const sig = await this.provider.connection.sendRawTransaction(tx.serialize());
        await this.provider.connection.confirmTransaction({
            signature: sig,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight
        });
    }

    async run() {
        await this.initializeBenchmark();
        await this.loadItems();
        await this.loadWarehouses();
        // Create ALTs
        await this.createAndExtendAlts(WAREHOUSES, ITEMS);
        console.log("TPC-C Data Loading Complete.");
    }
}


// Execution Entry Point
async function main() {
    // 1. Setup Anchor Provider
    process.env.ANCHOR_WALLET = process.env.ANCHOR_WALLET || "./keypairs/dev-wallet.json";
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // 2. Load Program
    const program = anchor.workspace.TpcBenchmark as Program<TpcBenchmark>;

    if (!program) {
        console.error("Program not found. Make sure to build and deploy first.");
        return;
    }

    console.log("Starting TPC-C Data Loader...");
    console.log(`Program ID: ${program.programId.toString()}`);
    console.log(`Authority: ${provider.wallet.publicKey.toString()}`);

    const loader = new TpcClassLoader(provider, program);
    await loader.run();
}

// CLI execution
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1]?.endsWith('tpc-c-loader.ts');

if (isMainModule) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
