import type { Socket } from 'bun';
import { calculateTarget } from "../../wasm/kaspa";
import { Pushgateway } from 'prom-client';
import type { RegistryContentType } from 'prom-client';
import { stringifyHashrate, getAverageHashrateGHs } from './utils';
import Monitoring from '../monitoring';
import { DEBUG } from '../../index';
import {
  minerHashRateGauge,
  poolHashRateGauge,
  minerAddedShares,
  minerIsBlockShare,
  minerInvalidShares,
  minerStaleShares,
  minerDuplicatedShares,
  varDiff
} from '../prometheus';
import { metrics } from '../../index';
// Fix the import statement
import Denque from 'denque';

export interface WorkerStats {
  blocksFound: number;
  sharesFound: number;
  sharesDiff: number;
  staleShares: number;
  invalidShares: number;
  workerName: string;
  startTime: number;
  lastShare: number;
  varDiffStartTime: number;
  varDiffSharesFound: number;
  varDiffWindow: number;
  minDiff: number;
  recentShares: Denque<{ timestamp: number, difficulty: number }>;
}

type MinerData = {
  sockets: Set<Socket<any>>,
  workerStats: WorkerStats
};

type Contribution = {
  address: string;
  difficulty: number;
  timestamp: number;
  minerId: string;
};

export class SharesManager {
  private contributions: Map<bigint, Contribution> = new Map();
  private miners: Map<string, MinerData> = new Map();
  private poolAddress: string;
  private pushGateway: Pushgateway<RegistryContentType>;
  private monitoring: Monitoring;

  constructor(poolAddress: string, pushGatewayUrl: string) {
    this.poolAddress = poolAddress;
    this.monitoring = new Monitoring();
    this.pushGateway = new Pushgateway<RegistryContentType>(pushGatewayUrl);
    this.startHashRateLogging(60000);
    this.startStatsThread(); // Start the stats logging thread
  }

  getOrCreateWorkerStats(workerName: string, minerData: MinerData): WorkerStats {
    let workerStats = minerData.workerStats;
    if (!workerStats) {
      workerStats = {
        blocksFound: 0,
        sharesFound: 0,
        sharesDiff: 0,
        staleShares: 0,
        invalidShares: 0,
        workerName,
        startTime: Date.now(),
        lastShare: Date.now(),
        varDiffStartTime: Date.now(),
        varDiffSharesFound: 0,
        varDiffWindow: 0,
        minDiff: 1, // Set to initial difficulty
        recentShares: new Denque<{ timestamp: number, difficulty: number }>() // Initialize denque correctly
      };
      minerData.workerStats = workerStats;
      if (DEBUG) this.monitoring.debug(`SharesManager: Created new worker stats for ${workerName}`);
    }
    return workerStats;
  }

  startHashRateLogging(interval: number) {
    setInterval(() => {
      this.calcHashRates();
    }, interval);
  }

  async addShare(minerId: string, address: string, hash: string, difficulty: number, nonce: bigint, templates: any) {
    // Critical Section: Check and Add Share
    if (this.contributions.has(nonce)) {
      metrics.updateGaugeInc(minerDuplicatedShares, [minerId, address]);
      throw Error('Duplicate share');
    } else {
      this.contributions.set(nonce, { address, difficulty, timestamp: Date.now(), minerId });
    }

    const timestamp = Date.now();
    let minerData = this.miners.get(address);
    const currentDifficulty = minerData ? minerData.workerStats.minDiff : difficulty;

    metrics.updateGaugeInc(minerAddedShares, [minerId, address]);

    if (DEBUG) this.monitoring.debug(`SharesManager: Share added for ${minerId} - Address: ${address} - Nonce: ${nonce} - Hash: ${hash}`);

    // Initial setup for a new miner
    if (!minerData) {
      minerData = {
        sockets: new Set(),
        workerStats: {
          blocksFound: 0,
          sharesFound: 0,
          sharesDiff: 0,
          staleShares: 0,
          invalidShares: 0,
          workerName: minerId,
          startTime: Date.now(),
          lastShare: Date.now(),
          varDiffStartTime: Date.now(),
          varDiffSharesFound: 0,
          varDiffWindow: 0,
          minDiff: currentDifficulty,
          recentShares: new Denque<{ timestamp: number, difficulty: number }>() // Initialize recentShares
        }
      };
      this.miners.set(address, minerData);
    } else {
      // Atomically update worker stats
      minerData.workerStats.sharesFound++;
      minerData.workerStats.varDiffSharesFound++;
      minerData.workerStats.lastShare = timestamp;
      minerData.workerStats.minDiff = currentDifficulty;

      // Update recentShares with the new share
      minerData.workerStats.recentShares.push({ timestamp: Date.now(), difficulty: currentDifficulty });

      const windowSize = 10 * 60 * 1000; // 10 minutes window
      while (minerData.workerStats.recentShares.length > 0 && Date.now() - minerData.workerStats.recentShares.peekFront()!.timestamp > windowSize) {
        minerData.workerStats.recentShares.shift();
      }
    }

    const state = templates.getPoW(hash);
    if (!state) {
      if (DEBUG) this.monitoring.debug(`SharesManager: Stale header for miner ${minerId} and hash: ${hash}`);
      metrics.updateGaugeInc(minerStaleShares, [minerId, address]);
      throw Error('Stale header');
    }

    const [isBlock, target] = state.checkWork(nonce);
    if (isBlock) {
      if (DEBUG) this.monitoring.debug(`SharesManager: Work found for ${minerId} and target: ${target}`);
      metrics.updateGaugeInc(minerIsBlockShare, [minerId, address]);
      const report = await templates.submit(minerId, hash, nonce);
      if (report) minerData.workerStats.blocksFound++;
    }

    const validity = target <= calculateTarget(currentDifficulty);
    if (!validity) {
      if (DEBUG) this.monitoring.debug(`SharesManager: Invalid share for target: ${target} for miner ${minerId}`);
      metrics.updateGaugeInc(minerInvalidShares, [minerId, address]);
      throw Error('Invalid share');
    }

    if (DEBUG) this.monitoring.debug(`SharesManager: Contributed block added from: ${minerId} with address ${address} for nonce: ${nonce}`);
  }

  startStatsThread() {
    const start = Date.now();

    setInterval(() => {
      let str = "\n===============================================================================\n";
      str += "  worker name   |  avg hashrate  |   acc/stl/inv  |    blocks    |    uptime   \n";
      str += "-------------------------------------------------------------------------------\n";
      const lines: string[] = [];
      let totalRate = 0;

      this.miners.forEach((minerData, address) => {
        const stats = minerData.workerStats;
        const rate = getAverageHashrateGHs(stats);
        totalRate += rate;
        const rateStr = stringifyHashrate(rate);
        const ratioStr = `${stats.sharesFound}/${stats.staleShares}/${stats.invalidShares}`;
        lines.push(
          ` ${stats.workerName.padEnd(15)}| ${rateStr.padEnd(14)} | ${ratioStr.padEnd(14)} | ${stats.blocksFound.toString().padEnd(12)} | ${(Date.now() - stats.startTime) / 1000}s`
        );
      });

      lines.sort();
      str += lines.join("\n");
      const rateStr = stringifyHashrate(totalRate);
      const overallStats = Array.from(this.miners.values()).reduce((acc: any, minerData: MinerData) => {
        const stats = minerData.workerStats;
        acc.sharesFound += stats.sharesFound;
        acc.staleShares += stats.staleShares;
        acc.invalidShares += stats.invalidShares;
        return acc;
      }, { sharesFound: 0, staleShares: 0, invalidShares: 0 });
      const ratioStr = `${overallStats.sharesFound}/${overallStats.staleShares}/${overallStats.invalidShares}`;
      str += "\n-------------------------------------------------------------------------------\n";
      str += `                | ${rateStr.padEnd(14)} | ${ratioStr.padEnd(14)} | ${Array.from(this.miners.values()).reduce((acc, minerData) => acc + minerData.workerStats.blocksFound, 0).toString().padEnd(12)} | ${(Date.now() - start) / 1000}s`;
      str += "\n===============================================================================\n";
      console.log(str);
    }, 600000); // 10 minutes
  }

  calcHashRates() {
    let totalHashRate = 0;
    const baseWindowSize = 10 * 60 * 1000; // 10 minutes base window

    this.miners.forEach((minerData, address) => {
      const now = Date.now();

      // Adjust the window size dynamically based on miner's activity
      const sharesCount = minerData.workerStats.recentShares.length;
      const windowSize = Math.min(baseWindowSize, sharesCount * 1000); // Minimum 1 second per share, max 10 min

      // Extract relevant shares from recentShares
      const relevantShares = minerData.workerStats.recentShares.toArray().filter(share => now - share.timestamp <= windowSize);

      if (relevantShares.length === 0) return;

      // Weighted average based on time proximity
      let totalDifficulty = 0;
      let totalWeight = 0;
      relevantShares.forEach((share, index) => {
        const weight = 1 + (index / relevantShares.length); // More recent shares get more weight
        totalDifficulty += share.difficulty * weight;
        totalWeight += weight;
      });

      const avgDifficulty = totalDifficulty / totalWeight;
      const timeDifference = (now - relevantShares[0].timestamp) / 1000; // in seconds

      const workerHashRate = (avgDifficulty * relevantShares.length) / timeDifference;
      metrics.updateGaugeValue(minerHashRateGauge, [minerData.workerStats.workerName, address], workerHashRate);
      totalHashRate += workerHashRate;
    });

    metrics.updateGaugeValue(poolHashRateGauge, ['pool', this.poolAddress], totalHashRate);
    if (DEBUG) {
      this.monitoring.debug(`SharesManager: Total pool hash rate updated to ${totalHashRate} GH/s`);
    }
  }

  getMiners() {
    return this.miners;
  }

  resetContributions() {
    this.contributions.clear();
  }

  dumpContributions() {
    const contributions = Array.from(this.contributions.values());
    if (DEBUG) this.monitoring.debug(`SharesManager: Amount of contributions per miner for this cycle ${contributions.length}`);
    this.contributions.clear();
    return contributions;
  }

  startVardiffThread(sharesPerMin: number, varDiffStats: boolean, clampPow2: boolean) {
    setInterval(() => {
      const now = Date.now();

      this.miners.forEach(minerData => {
        const stats = minerData.workerStats;
        const elapsedMinutes = (now - stats.varDiffStartTime) / 60000; // Convert ms to minutes
        if (elapsedMinutes < 1) return;

        const sharesFound = stats.varDiffSharesFound;
        const shareRate = sharesFound / elapsedMinutes;
        const targetRate = sharesPerMin;

        if (DEBUG) this.monitoring.debug(`shareManager - VarDiff for ${stats.workerName}: sharesFound: ${sharesFound}, elapsedMinutes: ${elapsedMinutes}, shareRate: ${shareRate}, targetRate: ${targetRate}`);

        this.monitoring.debug(`shareManager - VarDiff for ${stats.workerName}: sharesFound: ${sharesFound}, elapsedMinutes: ${elapsedMinutes}, shareRate: ${shareRate}, targetRate: ${targetRate}, currentDiff: ${stats.minDiff}`);

        if (shareRate > targetRate * 1.1) {
          let newDiff = stats.minDiff * 1.2;
          if (clampPow2) {
            newDiff = Math.pow(2, Math.floor(Math.log2(newDiff)));
          }
          this.monitoring.debug(`shareManager: VarDiff - Increasing difficulty for ${stats.workerName} from ${stats.minDiff} to ${newDiff}`);
          stats.minDiff = newDiff;
        } else if (shareRate < targetRate * 0.9) {
          let newDiff = stats.minDiff / 1.2;
          if (clampPow2) {
            newDiff = Math.pow(2, Math.ceil(Math.log2(newDiff)));
          }
          if (newDiff < 1) {
            newDiff = 1;
          }
          this.monitoring.debug(`shareManager: VarDiff - Decreasing difficulty for ${stats.workerName} from ${stats.minDiff} to ${newDiff}`);
          stats.minDiff = newDiff;
        } else {
          this.monitoring.debug(`shareManager: VarDiff - No change in difficulty for ${stats.workerName} (current difficulty: ${stats.minDiff})`);
        };

        stats.varDiffSharesFound = 0;
        stats.varDiffStartTime = now;

        if (varDiffStats) {
          this.monitoring.log(`shareManager: VarDiff for ${stats.workerName}: sharesFound: ${sharesFound}, elapsed: ${elapsedMinutes.toFixed(2)}, shareRate: ${shareRate.toFixed(2)}, newDiff: ${stats.minDiff}`);
          metrics.updateGaugeValue(varDiff, [stats.workerName], stats.minDiff);
        }
      });
    }, 300000); // Run every 5 minutes
  }
}
