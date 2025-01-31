import { collectDefaultMetrics, Pushgateway, register, Gauge } from 'prom-client';
import PQueue from 'p-queue';
import type { RegistryContentType } from 'prom-client';
import Monitoring from '../monitoring';
import Database from '../pool/database';
import express from 'express';
import client from 'prom-client';

const queue = new PQueue({ concurrency: 1 });

collectDefaultMetrics();
export { register };

// Existing Gauges
export const minerHashRateGauge = new client.Gauge({
  name: 'miner_hash_rate_GHps',
  help: 'Hash rate of each miner',
  labelNames: ['wallet_address']
});

export const activeMinerGuage = new client.Gauge({
  name: 'active_workers_10m_count',
  help: 'Active workers data',
  labelNames: ['miner_id', 'wallet_address', 'asic_type']
});

export const workerHashRateGauge = new client.Gauge({
  name: 'worker_hash_rate_GHps',
  help: 'Hash rate of worker',
  labelNames: ['miner_id', 'wallet_address']
});

export const poolHashRateGauge = new client.Gauge({
  name: 'pool_hash_rate_GHps',
  help: 'Overall hash rate of the pool',
  labelNames: ['miner_id', 'pool_address']
});

export const minerjobSubmissions = new client.Gauge({
  name: 'miner_job_submissions_1min_count',
  help: 'Job submitted per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minerAddedShares = new client.Gauge({
  name: 'added_miner_shares_1min_count',
  help: 'Added shares per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minerInvalidShares = new client.Gauge({
  name: 'miner_invalid_shares_1min_count',
  help: 'Invalid shares per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minerDuplicatedShares = new client.Gauge({
  name: 'miner_duplicated_shares_1min_count',
  help: 'Duplicated shares per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minerIsBlockShare = new client.Gauge({
  name: 'miner_isblock_shares_1min_count',
  help: 'Is Block shares per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minerStaleShares = new client.Gauge({
  name: 'miner_stale_shares_1min_count',
  help: 'Stale shares per miner',
  labelNames: ['miner_id', 'wallet_address']
});

export const minedBlocksGauge = new client.Gauge({
  name: 'mined_blocks_1min_count',
  help: 'Total number of mined blocks',
  labelNames: ['miner_id', 'pool_address']
});

export const paidBlocksGauge = new client.Gauge({
  name: 'paid_blocks_1min_count',
  help: 'Total number of paid blocks',
  labelNames: ['miner_id', 'pool_address']
});

export const successBlocksDetailsGauge = new client.Gauge({
  name: 'success_blocks_details',
  help: 'Total number of successful blocks',
  labelNames: ['miner_id', 'pool_address', 'block_hash', 'daa_score']
});

export const jobsNotFound = new client.Gauge({
  name: 'jobs_not_found_1min_count',
  help: 'Total jobs not Found for registered template',
  labelNames: ['miner_id', 'pool_address']
});

export const varDiff = new client.Gauge({
  name: 'var_diff',
  help: 'show the difficulty per miner over time',
  labelNames: ['miner_id']
});

// New Gauge for Miner-Wallet Association
export const minerWalletGauge = new client.Gauge({
  name: 'miner_wallet_association',
  help: 'Association of miner_id with wallet_address',
  labelNames: ['wallet_address', 'miner_id']
});

// New Gauge for Shares Added with Timestamps
export const minerSharesGauge = new client.Gauge({
  name: 'miner_shares_with_timestamp',
  help: 'Tracks shares added by each miner with timestamps',
  labelNames: ['miner_id', 'timestamp']
});

// New Gauge for Wallet Hashrate Over Time
export const walletHashrateGauge = new client.Gauge({
  name: 'wallet_hashrate_hourly',
  help: 'Aggregate hashrate of all miner_ids associated with a wallet_address, recorded hourly',
  labelNames: ['wallet_address', 'timestamp']
});

// New Gauge for Miner Rewards with Block Information
export const minerRewardGauge = new client.Gauge({
  name: 'miner_rewards',
  help: 'Tracks blocks a miner_id and wallet_address was rewarded for, including timestamp and block hash',
  labelNames: ['wallet_address', 'miner_id', 'block_hash', 'daa_score', 'timestamp']
});

const newRegister = new client.Registry();

newRegister.registerMetric(minerHashRateGauge);
newRegister.registerMetric(activeMinerGuage);
newRegister.registerMetric(workerHashRateGauge);
newRegister.registerMetric(poolHashRateGauge);
newRegister.registerMetric(minerjobSubmissions);
newRegister.registerMetric(minerAddedShares);
newRegister.registerMetric(minerInvalidShares);
newRegister.registerMetric(minerDuplicatedShares);
newRegister.registerMetric(minerIsBlockShare);
newRegister.registerMetric(minerStaleShares);
newRegister.registerMetric(minedBlocksGauge);
newRegister.registerMetric(paidBlocksGauge);
newRegister.registerMetric(successBlocksDetailsGauge);
newRegister.registerMetric(jobsNotFound);
newRegister.registerMetric(varDiff);
newRegister.registerMetric(minerWalletGauge);
newRegister.registerMetric(minerSharesGauge);
newRegister.registerMetric(walletHashrateGauge);
newRegister.registerMetric(minerRewardGauge);

export function startMetricsServer() {
  const app = express();
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', newRegister.contentType);
    res.end(await newRegister.metrics());
  });

  app.listen(9999, () => {
    new Monitoring().log('Metrics server running at http://localhost:9999');
  });
}

export class PushMetrics {

  constructor(pushGatewayUrl: string) {
    startMetricsServer();
  }


  async updateMinerWalletGauge() {
    const db = new Database(process.env.DATABASE_URL || '');
    const balances = await db.getAllBalances();

    // Explicitly type the elements being destructured
    balances.forEach(({ minerId, address }: { minerId: string; address: string }) => {
      this.updateGaugeValue(minerWalletGauge, [address, minerId], 1);
    });
  }

  async updateMinerSharesGauge(minerId: string, shares: number) {
    const timestamp = new Date().toISOString();
    this.updateGaugeValue(minerSharesGauge, [minerId, timestamp], shares);
  }

  async updateWalletHashrateGauge(walletAddress: string, hashrate: number) {
    const timestamp = new Date().toISOString();
    this.updateGaugeValue(walletHashrateGauge, [walletAddress, timestamp], hashrate);
  }

  async updateMinerRewardGauge(walletAddress: string, minerId: string, blockHash: string, daaScores: string) {
    const timestamp = new Date().toISOString();
    this.updateGaugeValue(minerRewardGauge, [walletAddress, minerId, blockHash, daaScores, timestamp], 1);
  }

  updateGaugeValue(gauge: client.Gauge, labels: string[], value: number) {
    queue.add(() => gauge.labels(...labels).set(value));
  }

  updateGaugeInc(gauge: client.Gauge, labels: string[]) {
    queue.add(() => gauge.labels(...labels).inc(1));
  }
}