import { Connection, PublicKey, Keypair, Signer } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, Idl } from '@coral-xyz/anchor';
import { IDLS, PROGRAM_ADDRESSES, ProgramName } from './index';
import { EnergyToken } from './energy_token';
import { Governance } from './governance';
import { Oracle } from './oracle';
import { Registry } from './registry';
import { Trading } from './trading';

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
          this.provider
        );
        this.programs.set(programName, program);
      }
    }
  }

  /**
   * Get a specific program by name
   */
  getProgram<T extends Idl>(programName: ProgramName): Program<T> {
    const program = this.programs.get(programName);
    if (!program) {
      throw new Error(`Program ${programName} not found`);
    }
    return program as unknown as Program<T>;
  }

  /**
   * Get the Energy Token program
   */
  get energyToken(): Program<EnergyToken> {
    return this.getProgram<EnergyToken>('energyToken');
  }

  /**
   * Get the Governance program
   */
  get governance(): Program<Governance> {
    return this.getProgram<Governance>('governance');
  }

  /**
   * Get the Oracle program
   */
  get oracle(): Program<Oracle> {
    return this.getProgram<Oracle>('oracle');
  }

  /**
   * Get the Registry program
   */
  get registry(): Program<Registry> {
    return this.getProgram<Registry>('registry');
  }

  /**
   * Get the Trading program
   */
  get trading(): Program<Trading> {
    return this.getProgram<Trading>('trading');
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
