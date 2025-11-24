import * as anchor from "@coral-xyz/anchor";

// Constants that were imported from missing constants file
const TEST_AMOUNTS = {
  ONE_TOKEN: 1_000_000_000,
  TEN_TOKENS: 10_000_000_000,
  SMALL_AMOUNT: 100_000_000, // 0.1 tokens
  MEDIUM_AMOUNT: 1_000_000_000, // 1 token
  LARGE_AMOUNT: 10_000_000_000, // 10 tokens
};

const RENEWABLE_SOURCES = ["Solar", "Wind", "Hydro", "Biomass"];
const TEST_LOCATIONS = ["Bangkok, Thailand", "New York, USA", "London, UK", "Tokyo, Japan"];
const ENERGY_CONSTANTS = {
  KWH_UNIT: 1000, // 1 kWh in base units
};

/**
 * Mock data generators for testing
 */
export class MockDataGenerator {
  /**
   * Generate a mock meter account data
   */
  static generateMeterAccount(overrides: Partial<MeterAccountData> = {}): MeterAccountData {
    const defaultData: MeterAccountData = {
      owner: anchor.web3.Keypair.generate().publicKey,
      meterId: `METER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      location: TEST_LOCATIONS[Math.floor(Math.random() * TEST_LOCATIONS.length)],
      totalGeneration: Math.floor(Math.random() * 1000000) * ENERGY_CONSTANTS.KWH_UNIT,
      totalConsumption: Math.floor(Math.random() * 500000) * ENERGY_CONSTANTS.KWH_UNIT,
      settledNetGeneration: 0,
      status: 'active',
      lastUpdated: Date.now(),
      createdAt: Date.now() - Math.floor(Math.random() * 86400000), // Within last 24 hours
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate mock ERC certificate data
   */
  static generateErcCertificate(overrides: Partial<ErcCertificateData> = {}): ErcCertificateData {
    const defaultData: ErcCertificateData = {
      certificateId: `ERC_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      issuer: anchor.web3.Keypair.generate().publicKey,
      meterOwner: anchor.web3.Keypair.generate().publicKey,
      energyAmount: Math.floor(Math.random() * 100000) * ENERGY_CONSTANTS.KWH_UNIT,
      renewableSource: RENEWABLE_SOURCES[Math.floor(Math.random() * RENEWABLE_SOURCES.length)],
      issuedAt: Date.now() - Math.floor(Math.random() * 86400000), // Within last 24 hours
      validatedAt: null,
      isValidated: false,
      validationData: `VALIDATION_${Date.now()}`,
      expiresAt: Date.now() + (365 * 24 * 60 * 60 * 1000), // 1 year from now
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate mock trading order data
   */
  static generateTradingOrder(overrides: Partial<TradingOrderData> = {}): TradingOrderData {
    const orderType = Math.random() > 0.5 ? 'buy' : 'sell';
    const defaultData: TradingOrderData = {
      orderId: `ORDER_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      user: anchor.web3.Keypair.generate().publicKey,
      orderType,
      amount: Math.floor(Math.random() * 10000) * TEST_AMOUNTS.ONE_TOKEN,
      price: Math.random() * 100, // Price per token
      filledAmount: 0,
      status: 'open',
      createdAt: Date.now(),
      expiresAt: Date.now() + (24 * 60 * 60 * 1000), // 24 hours from now
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate mock oracle price data
   */
  static generateOraclePrice(overrides: Partial<OraclePriceData> = {}): OraclePriceData {
    const defaultData: OraclePriceData = {
      priceId: `PRICE_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      asset: 'SOL',
      price: Math.random() * 200, // SOL price in USD
      timestamp: Date.now(),
      confidence: 0.95 + Math.random() * 0.04, // 95-99% confidence
      source: 'Pyth Network',
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate mock token info data
   */
  static generateTokenInfo(overrides: Partial<TokenInfoData> = {}): TokenInfoData {
    const defaultData: TokenInfoData = {
      authority: anchor.web3.Keypair.generate().publicKey,
      mint: anchor.web3.Keypair.generate().publicKey,
      totalSupply: 0,
      createdAt: Date.now(),
      lastMinted: null,
      lastBurned: null,
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate mock governance config data
   */
  static generateGovernanceConfig(overrides: Partial<GovernanceConfigData> = {}): GovernanceConfigData {
    const defaultData: GovernanceConfigData = {
      authority: anchor.web3.Keypair.generate().publicKey,
      isPaused: false,
      isMaintenanceMode: false,
      ercValidationEnabled: true,
      minEnergyAmount: ENERGY_CONSTANTS.KWH_UNIT,
      maxErcAmount: 1000000 * ENERGY_CONSTANTS.KWH_UNIT,
      ercValidityPeriod: 365 * 24 * 60 * 60 * 1000, // 1 year in milliseconds
      contactInfo: 'Test Authority <test@example.com>',
      lastUpdated: Date.now(),
    };

    return { ...defaultData, ...overrides };
  }

  /**
   * Generate multiple mock items
   */
  static generateMeterAccounts(count: number): MeterAccountData[] {
    return Array.from({ length: count }, () => this.generateMeterAccount());
  }

  static generateErcCertificates(count: number): ErcCertificateData[] {
    return Array.from({ length: count }, () => this.generateErcCertificate());
  }

  static generateTradingOrders(count: number): TradingOrderData[] {
    return Array.from({ length: count }, () => this.generateTradingOrder());
  }

  static generateOraclePrices(count: number): OraclePriceData[] {
    return Array.from({ length: count }, () => this.generateOraclePrice());
  }
}

/**
 * Mock transaction builder
 */
export class MockTransactionBuilder {
  private instructions: anchor.web3.TransactionInstruction[] = [];
  private signers: anchor.web3.Signer[] = [];

  addInstruction(instruction: anchor.web3.TransactionInstruction): this {
    this.instructions.push(instruction);
    return this;
  }

  addSigner(signer: anchor.web3.Signer): this {
    this.signers.push(signer);
    return this;
  }

  build(): { instructions: anchor.web3.TransactionInstruction[]; signers: anchor.web3.Signer[] } {
    return {
      instructions: [...this.instructions],
      signers: [...this.signers],
    };
  }

  reset(): this {
    this.instructions = [];
    this.signers = [];
    return this;
  }
}

/**
 * Mock event emitter for testing events
 */
export class MockEventEmitter {
  private events: Map<string, any[]> = new Map();

  emit(eventName: string, data: any): void {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }
    this.events.get(eventName)!.push(data);
  }

  getEvents(eventName: string): any[] {
    return this.events.get(eventName) || [];
  }

  getLastEvent(eventName: string): any | null {
    const events = this.getEvents(eventName);
    return events.length > 0 ? events[events.length - 1] : null;
  }

  clearEvents(eventName?: string): void {
    if (eventName) {
      this.events.delete(eventName);
    } else {
      this.events.clear();
    }
  }

  hasEvent(eventName: string): boolean {
    return this.events.has(eventName) && this.events.get(eventName)!.length > 0;
  }

  eventCount(eventName: string): number {
    return this.getEvents(eventName).length;
  }
}

/**
 * Mock account state for testing
 */
export class MockAccountState {
  private accounts: Map<string, any> = new Map();

  setAccount(pubkey: anchor.web3.PublicKey, data: any): void {
    this.accounts.set(pubkey.toBase58(), data);
  }

  getAccount(pubkey: anchor.web3.PublicKey): any | null {
    return this.accounts.get(pubkey.toBase58()) || null;
  }

  hasAccount(pubkey: anchor.web3.PublicKey): boolean {
    return this.accounts.has(pubkey.toBase58());
  }

  deleteAccount(pubkey: anchor.web3.PublicKey): boolean {
    return this.accounts.delete(pubkey.toBase58());
  }

  clear(): void {
    this.accounts.clear();
  }

  getAllAccounts(): Map<string, any> {
    return new Map(this.accounts);
  }

  accountCount(): number {
    return this.accounts.size;
  }
}

/**
 * Mock provider for testing without real network connection
 */
export class MockProvider {
  private connection: MockConnection;
  private wallet: anchor.web3.Keypair;

  constructor(wallet?: anchor.web3.Keypair) {
    this.connection = new MockConnection();
    this.wallet = wallet || anchor.web3.Keypair.generate();
  }

  get publicKey(): anchor.web3.PublicKey {
    return this.wallet.publicKey;
  }

  get mockConnection(): MockConnection {
    return this.connection;
  }

  async sendAndConfirmTransaction(
    transaction: anchor.web3.Transaction,
    signers?: anchor.web3.Signer[]
  ): Promise<string> {
    const signature = `mock_signature_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    return signature;
  }
}

/**
 * Mock connection for testing
 */
export class MockConnection {
  private accounts: Map<string, any> = new Map();
  private signatures: Map<string, any> = new Map();

  async getAccountInfo(pubkey: anchor.web3.PublicKey): Promise<any | null> {
    return this.accounts.get(pubkey.toBase58()) || null;
  }

  async getBalance(pubkey: anchor.web3.PublicKey): Promise<number> {
    return 10 * anchor.web3.LAMPORTS_PER_SOL; // Mock 10 SOL balance
  }

  async getSignatureStatus(signature: string): Promise<any> {
    return {
      value: {
        confirmationStatus: 'confirmed',
        err: null,
      },
    };
  }

  async requestAirdrop(pubkey: anchor.web3.PublicKey, lamports: number): Promise<string> {
    const signature = `airdrop_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    this.signatures.set(signature, { pubkey, lamports, timestamp: Date.now() });
    return signature;
  }

  setMockAccount(pubkey: anchor.web3.PublicKey, data: any): void {
    this.accounts.set(pubkey.toBase58(), data);
  }

  clearMocks(): void {
    this.accounts.clear();
    this.signatures.clear();
  }
}

// Type definitions for mock data
export interface MeterAccountData {
  owner: anchor.web3.PublicKey;
  meterId: string;
  location: string;
  totalGeneration: number;
  totalConsumption: number;
  settledNetGeneration: number;
  status: 'active' | 'inactive' | 'suspended';
  lastUpdated: number;
  createdAt: number;
}

export interface ErcCertificateData {
  certificateId: string;
  issuer: anchor.web3.PublicKey;
  meterOwner: anchor.web3.PublicKey;
  energyAmount: number;
  renewableSource: string;
  issuedAt: number;
  validatedAt: number | null;
  isValidated: boolean;
  validationData: string;
  expiresAt: number;
}

export interface TradingOrderData {
  orderId: string;
  user: anchor.web3.PublicKey;
  orderType: 'buy' | 'sell';
  amount: number;
  price: number;
  filledAmount: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired';
  createdAt: number;
  expiresAt: number;
}

export interface OraclePriceData {
  priceId: string;
  asset: string;
  price: number;
  timestamp: number;
  confidence: number;
  source: string;
}

export interface TokenInfoData {
  authority: anchor.web3.PublicKey;
  mint: anchor.web3.PublicKey;
  totalSupply: number;
  createdAt: number;
  lastMinted: number | null;
  lastBurned: number | null;
}

export interface GovernanceConfigData {
  authority: anchor.web3.PublicKey;
  isPaused: boolean;
  isMaintenanceMode: boolean;
  ercValidationEnabled: boolean;
  minEnergyAmount: number;
  maxErcAmount: number;
  ercValidityPeriod: number;
  contactInfo: string;
  lastUpdated: number;
}
