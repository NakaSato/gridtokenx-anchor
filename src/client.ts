import { Connection, PublicKey, Keypair, Signer } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { IDLS, PROGRAM_ADDRESSES, ProgramName } from './index';

/**
 * GridTokenX Client - A unified client for all GridTokenX programs
 */
class GridTokenXClient {
  private connection: Connection;
  private wallet: Wallet;
  private provider: AnchorProvider;
  private programs: Map<ProgramName, Program<Idl>>;

  constructor(connection: Connection, wallet: Wallet) {
    this.connection = connection;
    this.wallet = wallet;
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
    });
    this.programs = new Map();
    this.initializePrograms();
  }

  private initializePrograms() {
    for (const [name, address] of Object.entries(PROGRAM_ADDRESSES)) {
      const programName = name as ProgramName;
      const idl = IDLS[programName] as Idl;
      
      if (idl) {
        const program = new Program(
          idl,
          new PublicKey(address),
          this.provider
        );
        this.programs.set(programName, program);
      }
    }
  }

  /**
   * Get a specific program by name
   */
  getProgram(programName: ProgramName): Program<Idl> {
    const program = this.programs.get(programName);
    if (!program) {
      throw new Error(`Program ${programName} not found`);
    }
    return program;
  }

  /**
   * Get the Energy Token program
   */
  get energyToken() {
    return this.getProgram('energyToken');
  }

  /**
   * Get the Governance program
   */
  get governance() {
    return this.getProgram('governance');
  }

  /**
   * Get the Oracle program
   */
  get oracle() {
    return this.getProgram('oracle');
  }

  /**
   * Get the Registry program
   */
  get registry() {
    return this.getProgram('registry');
  }

  /**
   * Get the Trading program
   */
  get trading() {
    return this.getProgram('trading');
  }

  /**
   * Get all programs
   */
  getAllPrograms() {
    return {
      energyToken: this.energyToken,
      governance: this.governance,
      oracle: this.oracle,
      registry: this.registry,
      trading: this.trading,
    };
  }

  /**
   * Get provider
   */
  getProvider() {
    return this.provider;
  }

  /**
   * Get connection
   */
  getConnection() {
    return this.connection;
  }

  /**
   * Get wallet
   */
  getWallet() {
    return this.wallet;
  }
}

/**
 * Factory function to create a new GridTokenX client
 */
export function createGridTokenXClient(
  connection: Connection,
  wallet: Wallet
): GridTokenXClient {
  return new GridTokenXClient(connection, wallet);
}

/**
 * Create a client with a keypair wallet
 */
export function createGridTokenXClientWithKeypair(
  connection: Connection,
  keypair: Keypair
): GridTokenXClient {
  const wallet = new Wallet(keypair);
  return new GridTokenXClient(connection, wallet);
}

// Export types
export type { GridTokenXClient };
