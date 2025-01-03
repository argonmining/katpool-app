import { RpcClient, Encoding, Resolver } from "./wasm/kaspa";
import Treasury from "./src/treasury";
import Templates from "./src/stratum/templates";
import Stratum from "./src/stratum";
import Pool from "./src/pool";
import config from "./config/config.json";
import dotenv from 'dotenv';
import Monitoring from './src/monitoring'
import { PushMetrics } from "./src/prometheus";
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { ExitStatus, getParsedCommandLineOfConfigFile } from "typescript";

function shutdown() {
  console.log("\n\n Gracefully shutting down the pool")
  process.exit();
}

process.on('SIGINT', shutdown);

export let DEBUG = 0
if (process.env.DEBUG == "1") {
  DEBUG = 1;
}

// Send config.json to API server
async function sendConfig() {
  if (DEBUG) monitoring.debug(`Main: Trying to send config to katpool-monitor`);
  try {
    const configPath = path.resolve('./config/config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');

    const katpoolMonitor = process.env.MONITOR;
    if (!katpoolMonitor) {
      throw new Error('Environment variable MONITOR is not set.');
    }

    const response = await axios.post(`${katpoolMonitor}/postconfig`, {
      config: JSON.parse(configData),
    });

    monitoring.log(`Main: Config sent to API server. Response status: ${response.status}`);
  } catch (error) {
    monitoring.error(`Main: Error sending config: ${error}`);
  }
}

const monitoring = new Monitoring();
monitoring.log(`Main: Starting katpool App`)

dotenv.config();

monitoring.log(`Main: network: ${config.network}`);

let rpcUrl = "kaspad:17110"

if( config.network === "testnet-10" ) {
  rpcUrl = "kaspad:17210"
} else if( config.network === "testnet-11" ) {
  rpcUrl = "kaspad:17310"
}

monitoring.log(`Main: rpc url: ${rpcUrl}`);

const rpc = new RpcClient({
  url: rpcUrl, // This is WRPC end point
  // resolver: new Resolver(
  //   {
  //     urls : ["http://localhost:16210/"],
  //   }
  // ),
  encoding: Encoding.Borsh,
  networkId: config.network,
});

try{  
  await rpc.connect();
} catch(err) {
  monitoring.error(`Error while connecting to rpc url : ${rpc.url} Error: ${err}`)
}

monitoring.log(`Main: RPC connection started`)

try {
  const serverInfoTest = await rpc.getServerInfo();
  monitoring.log("server info: ", serverInfoTest)
} catch(err)
{
  monitoring.error("Error while getting server info: ", err)
}

const serverInfo = await rpc.getServerInfo();
if (!serverInfo.isSynced || !serverInfo.hasUtxoIndex) throw Error('Provided node is either not synchronized or lacks the UTXO index.');

const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
if (!treasuryPrivateKey) {
  throw new Error('Environment variable TREASURY_PRIVATE_KEY is not set.');
}


const katpoolPshGw = process.env.PUSHGATEWAY;
if (!katpoolPshGw) {
  throw new Error('Environment variable PUSHGATEWAY is not set.');
}
export const metrics = new PushMetrics(katpoolPshGw);

sendConfig();

const treasury = new Treasury(rpc, serverInfo.networkId, treasuryPrivateKey, config.treasury.fee);
const templates = new Templates(rpc, treasury.address, config.stratum.templates.cacheSize);

const stratum = new Stratum(templates, config.stratum.port, config.stratum.difficulty, katpoolPshGw, treasury.address, config.stratum.sharesPerMinute);
const pool = new Pool(treasury, stratum, stratum.sharesManager);