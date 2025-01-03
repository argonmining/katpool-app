import type { WorkerStats } from './sharesManager'; // Import WorkerStats

const bigGig = Math.pow(10, 9);
const maxTarget = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF');
const minHash = (BigInt(1) << BigInt(256)) / maxTarget;

export function stringifyHashrate(ghs: number): string {
  const unitStrings = ["M", "G", "T", "P", "E", "Z", "Y"];
  let unit = unitStrings[0];
  let hr = ghs * 1000; // Default to MH/s

  for (const u of unitStrings) {
    if (hr < 1000) {
      unit = u;
      break;
    }
    hr /= 1000;
  }

  return `${hr.toFixed(2)}${unit}H/s`;
}

// Define the structure of a single share
type Share = {
  timestamp: number;
  difficulty: number;
  workerName: string;
};

export function getAvgHashRateWorkerWise(stats: WorkerStats) {
  const windowSize = 10 * 60 * 1000; // 10 minutes window
  const relevantShares: Record<string, Share[]> = {};
  
  const myMap = new Map<string, number>(); // Map to store hash rates for each worker

  // Use Denque's toArray() method to filter relevant shares
  stats.recentShares.toArray().forEach((share: Share) => {
    if (Date.now() - share.timestamp <= windowSize) {
      if (!relevantShares[share.workerName]) {
        relevantShares[share.workerName] = [];
      }
      relevantShares[share.workerName].push(share);
    }
  });

  Object.keys(relevantShares).forEach(workerName => {
    myMap.set(workerName, calculateHashRate(relevantShares[workerName]));
  });

  return myMap;
}

function calculateHashRate(relevantShares: Share[]) {
  if (relevantShares.length === 0) return 0;

  const avgDifficulty = relevantShares.reduce((acc, share) => acc + diffToHash(share.difficulty), 0) / relevantShares.length;
  const timeDifference = (Date.now() - relevantShares[0].timestamp) / 1000; // in seconds

  return (avgDifficulty * relevantShares.length) / timeDifference;
}

// Function to convert difficulty to hash
export function diffToHash(diff: number): number {
    const hashVal = Number(minHash) * diff;
    const result = hashVal / bigGig;

    return result;
}