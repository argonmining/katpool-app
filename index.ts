import { RpcClient, Encoding, Resolver } from "./wasm/kaspa";
import Treasury from "./src/treasury";
import Templates from "./src/stratum/templates";
import Stratum from "./src/stratum";
import Pool from "./src/pool";
import config from "./config.json";
import dotenv from 'dotenv';

dotenv.config();

const rpc = new RpcClient({
  resolver: new Resolver(),
  encoding: Encoding.Borsh,
  networkId: config.network
});
await rpc.connect();

const serverInfo = await rpc.getServerInfo();
if (!serverInfo.isSynced || !serverInfo.hasUtxoIndex) throw Error('Provided node is either not synchronized or lacks the UTXO index.');

const treasuryPrivateKey = process.env.TREASURY_PRIVATE_KEY;
if (!treasuryPrivateKey) {
  throw new Error('Environment variable TREASURY_PRIVATE_KEY is not set.');
}

const kaspoolPshGw = process.env.PUSHGATEWAY;
if (!kaspoolPshGw) {
  throw new Error('Environment variable PUSHGATEWAY is not set.');
}

const treasury = new Treasury(rpc, serverInfo.networkId, treasuryPrivateKey, config.treasury.fee);
const templates = new Templates(rpc, treasury.address, config.stratum.templates.cacheSize);


const stratum = new Stratum(templates, config.stratum.port, config.stratum.difficulty, kaspoolPshGw, treasury.address);
const pool = new Pool(treasury, stratum);


