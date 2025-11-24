import * as anchor from "@coral-xyz/anchor";
import { 
  TOKEN_PROGRAM_ID, 
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction
} from "@solana/spl-token";

export class TestUtils {
  /**
   * Create an associated token account for a mint and owner
   */
  static async createAssociatedTokenAccount(
    payer: anchor.web3.PublicKey,
    mint: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    connection: anchor.web3.Connection
  ): Promise<anchor.web3.PublicKey> {
    const associatedTokenAddress = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Check if account already exists
    const accountInfo = await connection.getAccountInfo(associatedTokenAddress);
    if (accountInfo) {
      return associatedTokenAddress;
    }

    // Create the account if it doesn't exist
    const instruction = createAssociatedTokenAccountInstruction(
      payer,
      associatedTokenAddress,
      owner,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    return associatedTokenAddress;
  }

  /**
   * Generate a unique test ID
   */
  static generateTestId(prefix: string = "test"): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Wait for a transaction to be confirmed
   */
  static async waitForTransaction(
    connection: anchor.web3.Connection,
    signature: string,
    timeout: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const status = await connection.getSignatureStatus(signature);
      if (status.value?.confirmationStatus === 'confirmed' || 
          status.value?.confirmationStatus === 'finalized') {
        return;
      }
      if (status.value?.err) {
        throw new Error(`Transaction failed: ${status.value.err}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
  }

  /**
   * Get the balance of a token account
   */
  static async getTokenBalance(
    connection: anchor.web3.Connection,
    tokenAccount: anchor.web3.PublicKey
  ): Promise<number> {
    const accountInfo = await connection.getAccountInfo(tokenAccount);
    if (!accountInfo) return 0;
    
    const data = accountInfo.data;
    const amount = data.readBigUInt64LE(64);
    return Number(amount);
  }

  /**
   * Get the supply of a token mint
   */
  static async getTokenSupply(
    connection: anchor.web3.Connection,
    mint: anchor.web3.PublicKey
  ): Promise<number> {
    const mintInfo = await connection.getParsedAccountInfo(mint);
    if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
      throw new Error('Invalid mint account');
    }
    
    return (mintInfo.value.data as any).parsed.info.supply;
  }

  /**
   * Create a test keypair with SOL airdrop
   */
  static async createFundedKeypair(
    connection: anchor.web3.Connection,
    solAmount: number = 10
  ): Promise<anchor.web3.Keypair> {
    const keypair = anchor.web3.Keypair.generate();
    const airdropAmount = solAmount * anchor.web3.LAMPORTS_PER_SOL;
    
    const signature = await connection.requestAirdrop(keypair.publicKey, airdropAmount);
    await this.waitForTransaction(connection, signature);
    
    return keypair;
  }

  /**
   * Calculate PDAs for various programs
   */
  static findTokenInfoPda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("token_info")],
      programId
    );
  }

  static findMintPda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("mint")],
      programId
    );
  }

  static findPoaConfigPda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("poa_config")],
      programId
    );
  }

  static findErcCertificatePda(
    programId: anchor.web3.PublicKey,
    certificateId: string
  ): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("erc_certificate"), Buffer.from(certificateId)],
      programId
    );
  }

  static findOraclePda(programId: anchor.web3.PublicKey): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("oracle")],
      programId
    );
  }

  static findMeterAccountPda(
    programId: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey
  ): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("meter"), owner.toBuffer()],
      programId
    );
  }

  static findTradingAccountPda(
    programId: anchor.web3.PublicKey,
    user: anchor.web3.PublicKey
  ): [anchor.web3.PublicKey, number] {
    return anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("trading_account"), user.toBuffer()],
      programId
    );
  }

  /**
   * Convert lamports to SOL
   */
  static lamportsToSol(lamports: number): number {
    return lamports / anchor.web3.LAMPORTS_PER_SOL;
  }

  /**
   * Convert SOL to lamports
   */
  static solToLamports(sol: number): number {
    return Math.floor(sol * anchor.web3.LAMPORTS_PER_SOL);
  }

  /**
   * Format token amount with decimals
   */
  static formatTokenAmount(amount: number, decimals: number = 9): string {
    return (amount / Math.pow(10, decimals)).toFixed(decimals);
  }

  /**
   * Parse token amount from formatted string
   */
  static parseTokenAmount(formattedAmount: string, decimals: number = 9): number {
    return Math.floor(parseFloat(formattedAmount) * Math.pow(10, decimals));
  }

  /**
   * Generate test energy data
   */
  static generateEnergyData() {
    return {
      meterId: this.generateTestId("meter"),
      location: "Bangkok, Thailand",
      totalGeneration: Math.floor(Math.random() * 1000000), // Random kWh
      totalConsumption: Math.floor(Math.random() * 500000), // Random kWh
      timestamp: Date.now()
    };
  }

  /**
   * Generate test ERC data
   */
  static generateErcData() {
    return {
      certificateId: this.generateTestId("erc"),
      energyAmount: Math.floor(Math.random() * 100000), // Random kWh
      renewableSource: ["Solar", "Wind", "Hydro", "Biomass"][Math.floor(Math.random() * 4)],
      validationData: this.generateTestId("validation")
    };
  }

  /**
   * Generate test trading data
   */
  static generateTradingData() {
    return {
      orderId: this.generateTestId("order"),
      amount: Math.floor(Math.random() * 10000), // Random token amount
      price: Math.random() * 100, // Random price
      orderType: ["buy", "sell"][Math.floor(Math.random() * 2)] as "buy" | "sell"
    };
  }

  /**
   * Validate a transaction was successful
   */
  static async validateTransactionSuccess(
    connection: anchor.web3.Connection,
    signature: string
  ): Promise<boolean> {
    try {
      await this.waitForTransaction(connection, signature);
      const status = await connection.getSignatureStatus(signature);
      return status.value?.confirmationStatus === 'confirmed' || 
             status.value?.confirmationStatus === 'finalized';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get account data for a program account
   */
  static async getAccountData<T>(
    connection: anchor.web3.Connection,
    publicKey: anchor.web3.PublicKey
  ): Promise<T | null> {
    const accountInfo = await connection.getAccountInfo(publicKey);
    if (!accountInfo) return null;
    
    // Skip discriminator (8 bytes) and return the rest
    return accountInfo.data.slice(8) as T;
  }

  /**
   * Compare two public keys
   */
  static equalKeys(key1: anchor.web3.PublicKey, key2: anchor.web3.PublicKey): boolean {
    return key1.toBase58() === key2.toBase58();
  }

  /**
   * Generate a delay
   */
  static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry a function with exponential backoff
   */
  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;
        if (attempt === maxAttempts) break;
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        await this.delay(delay);
      }
    }
    
    throw lastError!;
  }
}

export * from './constants';
export * from './mocks';
