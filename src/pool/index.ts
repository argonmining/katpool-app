import type Treasury from '../treasury';
import type Stratum from '../stratum';
import Database from './database';
import Monitoring from '../monitoring';
import { sompiToKaspaStringWithSuffix } from '../../wasm/kaspa';
import { DEBUG } from "../../index"
import { SharesManager } from '../stratum/sharesManager'; // Import SharesManager
import { PushMetrics } from '../prometheus'; // Import the PushMetrics class

export default class Pool {
  private treasury: Treasury;
  private stratum: Stratum;
  private database: Database;
  private monitoring: Monitoring;
  private sharesManager: SharesManager; // Add SharesManager property
  private pushMetrics: PushMetrics; // Add PushMetrics property

  constructor(treasury: Treasury, stratum: Stratum, sharesManager: SharesManager) {
    this.treasury = treasury;
    this.stratum = stratum;

    const databaseUrl = process.env.DATABASE_URL; // Add this line
    if (!databaseUrl) { // Add this line
      throw new Error('Environment variable DATABASE_URL is not set.'); // Add this line
    }
    
    this.database = new Database(databaseUrl); // Change this line
    this.monitoring = new Monitoring();
    this.sharesManager = sharesManager; // Initialize SharesManager
    this.pushMetrics = new PushMetrics(process.env.PUSHGATEWAY || ''); // Initialize PushMetrics

    this.stratum.on('subscription', (ip: string, agent: string) => this.monitoring.log(`Pool: Miner ${ip} subscribed into notifications with ${agent}.`));
    this.treasury.on('coinbase', (minerReward: bigint, poolFee: bigint) => this.allocate(minerReward, poolFee));
    //this.treasury.on('revenue', (amount: bigint) => this.revenuize(amount));

    this.monitoring.log(`Pool: Pool is active on port ${this.stratum.server.socket.port}.`);
  }

  private async revenuize(amount: bigint) {
    const address = this.treasury.address; // Use the treasury address
    const minerId = 'pool'; // Use a fixed ID for the pool itself
    await this.database.addBalance(minerId, address, amount); // Use the total amount as the share
    this.monitoring.log(`Pool: Treasury generated ${sompiToKaspaStringWithSuffix(amount, this.treasury.processor.networkId!)} revenue over last coinbase.`);
  }

  private async allocate(minerReward: bigint, poolFee: bigint) {
    let works = new Map<string, { minerId: string, difficulty: number }>();
    let totalWork = 0;
    let walletHashrateMap = new Map<string, number>();

    for (const contribution of this.sharesManager.dumpContributions()) {
      const { address, difficulty, minerId } = contribution;
      const currentWork = works.get(address) ?? { minerId, difficulty: 0 };

      works.set(address, { minerId, difficulty: currentWork.difficulty + difficulty });
      totalWork += difficulty;

      // Accumulate the hashrate by wallet
      walletHashrateMap.set(address, (walletHashrateMap.get(address) || 0) + difficulty);

      // Update the new gauge for shares added
      this.pushMetrics.updateMinerSharesGauge(minerId, difficulty);
    }

    // Update wallet hashrate gauge
    for (const [walletAddress, hashrate] of walletHashrateMap) {
      this.pushMetrics.updateWalletHashrateGauge(walletAddress, hashrate);
    }

    // Existing reward allocation logic
    const scaledTotal = BigInt(totalWork * 100);

    for (const [address, work] of works) {
      const scaledWork = BigInt(work.difficulty * 100);
      const share = (scaledWork * minerReward) / scaledTotal;
      await this.database.addBalance(work.minerId, address, share);

      // Track rewards for the miner
      this.pushMetrics.updateMinerRewardGauge(address, work.minerId, 'block_hash_placeholder'); // Replace 'block_hash_placeholder' with the actual block hash

      if (DEBUG) this.monitoring.debug(`Pool: Reward with ${sompiToKaspaStringWithSuffix(share, this.treasury.processor.networkId!)} was ALLOCATED to ${work.minerId} with work difficulty ${work.difficulty}`);
    }

    if (works.size > 0) this.revenuize(poolFee);
  }
}
