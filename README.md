# KASPA Mining Pool using rusty-kaspa WASM

Once the RPC connection is established, the pool initializes the treasury, which listens for UTXO events. When these events occur, the treasury processes them to track available funds. Next, templates are fetched and stored to generate job IDs for miners. These jobs are then distributed to miners for processing. Miners connect to the pool via the stratum protocol, subscribing and submitting their work (shares).

The shares are validated, and their difficulty is checked. Valid shares are counted, and blocks found are recorded. The pool uses this data to calculate the total hash rate and the contributions of each miner. Periodically, the pool distributes rewards based on each miner's contribution, allocating payments from the treasury and having them ready for the next payment cycle.

## How the block templates are fetched

We are fetching Block templates from GRPC endpoint. This is done through a Go-script. And this templates are passed on to a Redis channel.

## Download Kaspa WASM
** IMPORTANT **
Before anything, add wasm foolder to the local folder
You can download the latest form here: https://kaspa.aspectron.org/nightly/downloads/ move nodejs to the repo folder as wasm
unzip, rename and move `nodejs` that contains `kaspa` and kaspa-dev` to `wasm` folder locally.
Validate the location with the imports in the code.

## Docker Compose
The recommended installation is via docker compose. There are many instances that are required to have a full functionality of the pool solution.

![internal container design](images/katpool-internal-container-design.jpg)

### Container Instances

* katpool-app: main app and object of this repository
* katpool-db: postgres DB
* [katpool-monitor](https://github.com/argonmining/katpool-monitor): taking the initial config from katpool and sharing miner balances and total to prometheus and via APIs.
* prometheus: displaying metrics of the pool
* pushgateway: receiving metrics from katpool to have them passed to prometheus
* [katpool-payment](https://github.com/argonmining/katpool-payment) (still under development): taking balances from the database and distibuting payments

### Create env variables
create .env file
```
TREASURY_PRIVATE_KEY=<private key>
POSTGRES_USER=<db-user>
POSTGRES_PASSWORD=<db-passwd>
POSTGRES_DB=<db-name>
POSTGRES_HOSTNAME='katpool-db' # Configure the hostname.
DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOSTNAME}:5432/${POSTGRES_DB}"
PUSHGATEWAY="http://katpool-pushgateway:9091" # Configure the pushgateway url.
MONITOR="http://katpool-monitor:9302" # Configure the monitor url.
DEBUG=1
```
For now, all the instances share the same env var. However, in the future, it's better to set the private key to the payment app. katpool-app instance won't need it.

### requires folders and files

Create `postgres_data` folder at the repository root location for the postgres data files, and make that info persistant between restarts, and ensure the following files are present:
* prometheus.yml: prometheus scrape configuration
* init.sql: to setup the database the first time it's started
* migrate.sql: to make changes to current database. Add new table, update existing table. NOTE: Overwrite the content of this file for performing latest changes.
* nginx.conf
* config 
* **wasm** folder must the also available. Check download link above

Additionally:
* **prometheus_data** folder: Optionally you can uncomment prometheus_data in docker_compose.yml to bring persistency between restarts. Prometheus requires writes and read permissions.

### Configuration
In `prometheus.yml` **update the targets**.

Check `config/config.json` and do the required configurations to your pool.

Please refer to [Crontab.guru](https://crontab.guru/) to set these two cron expressions.

* **payoutCronSchedule**: cron schedule expression for payout. If not set or invalid, it will be defaulted to Twice a day (* */12 * * *).

* **backupCronSchedule**: cron schedule expression for backup. If not set or invalid, it will be defaulted to Twice a day (* */12 * * *).

* **thresholdAmount**: Miner rewards will be paid above this minimum amount in sompi

* **block_wait_time_seconds**: time to wait since last new block message from kaspad before manually requesting a new block. 

  * **Note**: It is to be set in **seconds**.

* **extraNonceSize** The value should be between 0 to 3.

* Here please prepend your own **node**. This has to be **GRPC endpoint**. 

  * If it fails, you can update the code in `index.ts` as

```JS
const rpc = new RpcClient({
  resolver: new Resolver(), // Random assignment
  encoding: Encoding.Borsh,
  networkId: config.network,
});
```

### Container Images

We have added public images to docker-compose.yml to make ieasier the deployment, but in case you want to do changes to the code and test it, you can create your own local image via:
```
docker build -t katpool-app:0.65 .
```
Dockerfile must be present int the same location where you are running this command.
remember to modify docker-image.yml with your own image.

### Start and check the pool

To start the pool, you need to run `docker compose up -d` or the required command depending of your docker setup
You can use `docker logs -f katpool-app` to see the output of your pool instance. We recommned to use DEBUG=1 at the beginning.
After ten minites you should be able to connect to the metrics, received info fo the state of the treasury and configurations via port 8080 at the following paths

* `http://<pool-server>:8080` it would take you to the promtheus interface. Check the `index.ts` file in `src/prometheus` folder for the metrics.
* `http://<pool-server>:8080/config` to see the initial config of the pool
* `http://<pool-server>:8080/balance` to see the balance for all miners
* `http://<pool-server>:8080/total` to see the total been rewarded to the miners ever

### Backup

Optionally, you can add a backup process to the DB. Check the ./backup folder.
You can build the suggested image via `docker build -t katpool-backup:0.4 .` and uncomment its part in the docker-compose.yml file.
We recommend to transfer the database dump files to other location as additional protection.

## Service Account Creation and Credentials for Google Cloud Backup

### Creating project in google cloud console
 - Head over and Login to https://console.cloud.google.com/ 
 - Go to Topbar right beside the Google Cloud logo
 - Create New Project
 - Select your newly created project

### Enabling drive api serivce
 - From the navigation menu, select API & services (https://console.cloud.google.com/apis/dashboard)
 - Click on ENABLE APIS AND SERVICES (https://console.cloud.google.com/apis/library)
 - Go to the Google Workspace in sidebar
 - Then click on Google Drive API (https://console.cloud.google.com/apis/library/drive.googleapis.com)
 - Click on Enable button
 
### Creating the google cloud service account 
 - Go to (https://console.cloud.google.com/iam-admin/serviceaccounts)
 - Click on CREATE SERVICE ACCOUNT, give the service account name, skip the optional fields

### Creating credentials for the service account
 - Go to your newly created service account 
 - Go to KEYS tab and click on ADD KEY -> Create new key -> Key type : JSON
 - Your credentials json file will be downloaded

### Running cloud backup script
 - Add that json file to backup folder as "google-credentials.json"
 - Configure the email address to access the dump file in config as "backupEmailAddress" Then execute the below commads:
```bash
  cd backup/
  bun run cloudBackup.ts fileName.sql
```

## How to install locally using bun (not recommended)
To install dependencies:

```bash
bun install
```

## How the go-script is run

This go-script needs to be kept running along the pool.

Build the binary 
```
cd katpool-app/go/
go build .
```

Run the binary
```
./getNewBlockTemplate
```

## How the Database is setup
We are using Postgres as our database:
```sql
CREATE TABLE IF NOT EXISTS miners_balance (
  id VARCHAR(255) PRIMARY KEY, 
  miner_id VARCHAR(255), 
  wallet VARCHAR(255),
  balance NUMERIC
);
CREATE TABLE IF NOT EXISTS wallet_total (
  address VARCHAR(255) PRIMARY KEY,
  total NUMERIC
);
CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    wallet_address TEXT[] NOT NULL,
    amount BIGINT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    transaction_hash VARCHAR(255) NOT NULL
);
```

To run:

```bash
TREASURY_PRIVATE_KEY=<private_key> DATABASE_URL='postgresql://<psql_user>:<psql_password>@<psql_hostname>:5432/<psql_db>' bun run index.ts
```

## Additonal notes
This project was created using `bun init` in bun v1.0.31. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
Special thanks to [KaffinPX](https://github.com/KaffinPX) for providing the foundation of this project.

# App Components Description

### The Mining Cycle: Step-by-Step

1. **Starting the Server**:
   - The Stratum server starts and begins listening for connections from miners.
   - The server connects to the Kaspa network via the RPC client to fetch block templates.

2. **Fetching Block Templates**:
   - The server fetches a new block template from the Kaspa network.
   - It creates a PoW object from the template to help miners validate their work.
   - The block template and PoW object are stored in the `templates` map.

3. **Distributing Jobs to Miners**:
   - A job is created from the block template, encoding the necessary data.
   - The job is sent to all connected miners, instructing them on what work to perform.

4. **Miners Start Working**:
   - Each miner starts working on the job by trying to find a valid nonce.
   - A valid nonce, when combined with the block template and hashed, must meet the difficulty target.

5. **Submitting Shares**:
   - When a miner finds a nonce, they submit a share back to the server.
   - The server checks if the share is valid:
     - It retrieves the PoW object from the `templates` map.
     - It validates the nonce against the difficulty target.
   
6. **Accepting or Rejecting Shares**:
   - **Valid Share**: If the nonce is valid and meets the target, the server:
     - Adds the share to the `works` map for tracking.
     - If the share completes a valid block, it submits the block to the Kaspa network.
     - Notifies the miner of the successful submission.
   - **Invalid Share**: If the nonce is invalid or duplicated:
     - The share is rejected.
     - The miner is notified of the rejection.

7. **Handling New Templates**:
   - As new block templates are created (typically when a new block is added to the blockchain), the server fetches the new templates.
   - The server sends the new job to all miners, starting the cycle again.

### Example Cycle

1. **Server Starts**: The server starts and listens for miners.
2. **Fetch Template**: The server gets a block template from Kaspa.
3. **Create Job**: The server creates a job from the template.
4. **Distribute Job**: The job is sent to miners.
5. **Miners Work**: Miners start finding a valid nonce.
6. **Submit Share**: A miner submits a share.
7. **Validate Share**:
   - **If Valid**:
     - The share is added to `works`.
     - If it's a valid block, it's submitted to Kaspa.
     - Miner is notified of success.
   - **If Invalid**:
     - The share is rejected.
     - Miner is notified of rejection.
8. **New Template**: A new block is added to the blockchain.
9. **Fetch New Template**: The server fetches a new block template, and the cycle repeats.

### Summary

The Stratum app manages the entire lifecycle of mining jobs, from distributing tasks to miners, validating their work, and submitting completed blocks to the Kaspa network. This ensures a smooth and efficient mining operation, with miners continuously working on up-to-date templates and the pool efficiently handling their contributions.

## Stratum

Explanation of the TypeScript Code for the Stratum Part of a Mining Pool in Kaspa
This TypeScript code defines a Stratum class that handles the stratum protocol for a Kaspa mining pool. Stratum is a communication protocol for mining pools, which allows miners to connect to the pool and submit their work. The Stratum class extends EventEmitter to handle various events and includes methods for managing miner connections, contributions, and communication with the mining pool server.

### Detailed Breakdown

#### Imports

- **`Socket`**: Represents a network socket used for communication.
- **`EventEmitter`**: Base class for creating event-driven applications.
- **`randomBytes`**: Used to generate random bytes, typically for extra nonces.
- **`Server`**, **`Miner`**, **`Worker`**: Import server-related entities.
- **`Request`**, **`Response`**, **`Event`**, **`errors`**: Protocol definitions for requests, responses, and errors.
- **`Templates`**: Manages job templates.
- **`calculateTarget`**, **`Address`**: Utilities for target calculation and address validation.
- **`Encoding`**, **`encodeJob`**: Job encoding utilities.

#### Class `Stratum`

##### Properties

- **`server`**: An instance of the `Server` class, handling the mining pool server.
- **`templates`**: Manages job templates.
- **`contributions`**: Tracks contributions from miners.
- **`subscriptors`**: Keeps track of subscribed miners' sockets.
- **`miners`**: Maps miner addresses to their associated sockets.

##### Constructor

- **`templates`**: Templates manager.
- **`port`**: Server port.
- **`initialDifficulty`**: Initial mining difficulty.

Sets up the server, templates, and registers template announcements.

##### Methods

- **`dumpContributions()`**:
  - Clears and returns the current contributions.
  
- **`addShare(address: string, hash: string, difficulty: number, nonce: bigint)`**:
  - Checks for duplicate shares.
  - Validates the work against the target difficulty.
  - Submits the valid block to the templates.
  - Adds the contribution to the map.

- **`announceTemplate(id: string, hash: string, timestamp: bigint)`**:
  - Encodes the job and sends it to all subscribed miners.

- **`reflectDifficulty(socket: Socket<Miner>)`**:
  - Sends the current mining difficulty to a miner.

- **`onMessage(socket: Socket<Miner>, request: Request)`**:
  - Handles various stratum protocol messages (`mining.subscribe`, `mining.authorize`, `mining.submit`).
  - Manages subscriptions, authorizations, and share submissions.

#### `onMessage` Method

- **`mining.subscribe`**:
  - Adds the socket to the subscribers set and emits a subscription event.

- **`mining.authorize`**:
  - Validates the address and manages worker registration.
  - Sets the extra nonce and sends difficulty information.

- **`mining.submit`**:
  - Validates and processes submitted shares.
  - Handles errors and sends appropriate responses.

## Stratum server

This code defines a Server class that sets up and manages TCP socket connections for a stratum server, which is a part of a mining pool infrastructure. It listens for incoming connections, handles incoming data, and processes messages according to the stratum protocol.

### Detailed Breakdown

#### Constructor
- **Parameters**: `port`, `difficulty`, `onMessage`.
- **Function**: 
  - Sets the initial difficulty.
  - Binds the `onMessage` callback.
  - Configures the TCP socket listener to handle connections on the specified port.

#### `onConnect(socket: Socket<Miner>)`
- **Purpose**: Initializes the `data` property of the socket with default miner settings.
- **Function**:
  - Sets the initial difficulty, an empty map for workers, the default encoding, and an empty string for cached bytes.

#### `onData(socket: Socket<Miner>, data: Buffer)`
- **Purpose**: Processes incoming data, splits it into messages, and handles each message.
- **Function**:
  - Appends incoming data to `cachedBytes`.
  - Splits the concatenated string by newline characters to separate messages.
  - Processes each complete message:
    - Parses the message.
    - Invokes the `onMessage` callback with the parsed message.
    - Sends the response back to the miner.
  - Updates `cachedBytes` with any remaining partial message.
  - Ends the connection if `cachedBytes` exceeds 512 characters to prevent potential overflow issues.

This class effectively manages the lifecycle of miner connections, from establishing a connection, receiving and processing data, to responding to requests and handling errors.

## Stratum templates

This TypeScript code defines a Templates class responsible for managing mining job templates for a Kaspa mining pool. The class interfaces with a RpcClient to retrieve new block templates, manage proof-of-work (PoW) computations, and handle job submissions.

### Key Components

1. **Imports**:
   - `IBlock`, `RpcClient`, `Header`, `PoW`: Types and classes from the Kaspa WebAssembly module.
   - `Jobs`: A class handling job-related operations.

2. **Templates Class**:
   - Manages block templates and proof-of-work data.
   - Interacts with the Kaspa RPC client to get new block templates and submit completed work.

### Class Properties

- **`rpc`**: An instance of `RpcClient` to communicate with the Kaspa node.
- **`address`**: The mining pool's payout address.
- **`templates`**: A map storing block templates and their corresponding PoW data.
- **`jobs`**: An instance of the `Jobs` class to manage job-related operations.
- **`cacheSize`**: The maximum number of templates to cache.

### Constructor

- **Parameters**: `rpc`, `address`, `cacheSize`.
- **Function**: Initializes the `rpc` client, payout address, cache size, and sets up the `templates` and `jobs`.

### Methods

#### `getHash(id: string)`

- **Purpose**: Retrieves the hash for a given job ID.
- **Function**: Delegates to the `jobs` instance to get the hash.

#### `getPoW(hash: string)`

- **Purpose**: Retrieves the PoW object for a given block hash.
- **Function**: Looks up the PoW object in the `templates` map.

#### `submit(hash: string, nonce: bigint)`

- **Purpose**: Submits a completed block to the Kaspa node.
- **Function**:
  - Retrieves the block template and header for the given hash.
  - Sets the nonce and finalizes the header.
  - Updates the block template with the new hash.
  - Submits the block via the RPC client.
  - Deletes the template from the cache.

#### `register(callback: (id: string, hash: string, timestamp: bigint) => void)`

- **Purpose**: Registers a callback to handle new block templates.
- **Function**:
  - Adds an event listener for new block templates from the RPC client.
  - Retrieves and processes the new block template.
  - Creates a PoW object for the template.
  - Adds the template and PoW to the `templates` map.
  - Derives a job ID and invokes the callback.
  - Ensures the cache does not exceed the specified size.
  - Subscribes to new block template events via the RPC client.

### Usage

This `Templates` class is integral to managing the lifecycle of mining job templates in the pool. It handles:
- Retrieving new block templates from the Kaspa node.
- Managing the cache of templates and corresponding PoW data.
- Submitting completed blocks back to the node.
- Notifying the mining pool of new job templates.

By efficiently managing these tasks, the `Templates` class ensures that miners always have up-to-date job templates to work on, and completed work is promptly submitted to the Kaspa network.

## Pool

The `Pool` class is designed to manage the interactions between the mining pool's components, such as treasury, stratum, database, and monitoring systems. Here's a breakdown of its components and methods:

### Imports
- **`Treasury`** and **`Stratum`**: Type imports for interacting with the pool's treasury and stratum components.
- **`Database`**: Handles database operations.
- **`Monitoring`**: Manages logging and monitoring of pool activities.
- **`sompiToKaspaStringWithSuffix`**

### Class `Pool`

#### Properties
- **`treasury`**: Instance of the `Treasury` class, managing the pool's funds.
- **`stratum`**: Instance of the `Stratum` class, handling miner connections and contributions.
- **`database`**: Instance of the `Database` class, managing miner balances.
- **`monitoring`**: Instance of the `Monitoring` class, logging pool activities.

#### Constructor
- **Parameters**: `treasury`, `stratum`
- **Function**:
  - Initializes the `treasury`, `stratum`, `database`, and `monitoring` properties.
  - Sets up event listeners for miner subscriptions (`subscription`), coinbase transactions (`coinbase`).

#### Methods

1. **`allocate(amount: bigint)`**:
   - **Purpose**: Allocates rewards to miners based on their contributions (similar to `distribute` but without resetting balances).
   - **Process**:
     - Collects contributions from the `stratum`.
     - Calculates the total work done by miners.
     - Logs the allocation event.
     - Allocates the rewards proportionally based on the miners' contributions.