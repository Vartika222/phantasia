# Phantasia

Cryptographically auditable biometric AI pipeline. Every inference — who was analyzed, by which model, trained on which dataset, in which environment — is anchored on-chain as an immutable lineage record.

Built to answer a single question at any future point in time: *did this exact model, trained on this exact data, produce this exact output?*

---

## How it works

```
┌─────────────────────────────────────────────────────────────────┐
│  TRAINING  (run once per model version)                         │
│                                                                 │
│  dataset/authorized/  ──► build_cluster.py ──► centroid.pkl     │
│  (face images)              DBSCAN + ArcFace    (cluster mean)  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  REGISTRATION  (run once after training + contract deployment)  │
│                                                                 │
│  register.py                                                    │
│  ├─ Merkle root of all dataset images  ──► registerDataset()    │
│  ├─ keccak256(artifact + script +                               │
│  │            hyperparams + pip freeze) ──► registerModel()     │
│  └─ saves registered_hashes.json  (loaded by app.py at start)  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────────┐
│  INFERENCE  (every request to POST /analyze)                    │
│                                                                 │
│  image ──► ArcFace embed ──► cosine distance vs centroid        │
│        ──► trust_score (0–100) + AUTHORIZED / SUSPICIOUS        │
│        ──► keccak256(image) + keccak256(output payload)         │
│        ──► logInference() on BioLedgerV2                        │
│        ──► inferenceId returned to caller                       │
└─────────────────────────────────────────────────────────────────┘
```

The result: every inference carries a verifiable chain — `Dataset → Model → Inference` — that can be retrieved and checked against on-chain records at any time via `GET /lineage/<inferenceId>`.

---

## Repository structure

```
phantasia/
│
├── Python backend (Flask API + ML pipeline)
│   ├── app.py                  Flask API — all HTTP endpoints
│   ├── ai_module.py            Thin wrapper: routes analyze_image() to trust.py
│   ├── trust.py                Core scoring: ArcFace embed → cosine dist → trust score
│   ├── embedder.py             DeepFace ArcFace embedding (returns None on failure)
│   ├── build_cluster.py        Training: DBSCAN cluster → centroid.pkl
│   ├── register.py             One-time registration: dataset + model → chain
│   ├── blockchain.py           Web3 bridge: hashing, BioLedgerClient, all contract calls
│   ├── config.py               Single source of truth for hyperparameters + paths
│   └── requirements.txt
│
├── Blockchain (Hardhat + Solidity)
│   ├── contracts/
│   │   ├── core/BioLedgerV2.sol          Main registry contract
│   │   ├── governance/BioToken.sol       ERC20 governance token (BIO, 10M supply)
│   │   ├── governance/BioDAO.sol         On-chain governance (vote → propose → execute)
│   │   └── interfaces/IBioLedgerV2.sol   Interface
│   ├── scripts/deploy.js                 Deployment script (all three contracts)
│   ├── test/BioLedger.test.js
│   ├── hardhat.config.js
│   └── package.json
```

---

## The model commitment

The `modelCommitment` is the core integrity primitive. It is computed as:

```
modelCommitment = keccak256(
    keccak256(centroid.pkl)           // artifact hash
  + keccak256(build_cluster.py)       // training script hash
  + keccak256(canonical JSON of hyperparameters)   // config hash
  + keccak256(pip freeze output)      // environment hash
)
```

Changing **anything** — the centroid, the script, a hyperparameter, or even a library version — produces a different `modelCommitment`, which is a different model as far as the chain is concerned. It must be re-registered. This is deliberate.

`config.py` is the authoritative source for all hyperparameters. `build_cluster.py`, `register.py`, `trust.py`, and `embedder.py` all import from it. There is no place where a hyperparameter can be changed for one step but not another.

---

## Smart contracts

### `BioLedgerV2` — the registry

Deployed to Polygon Amoy (testnet). Stores datasets, models, and inference records as immutable on-chain anchors.

**Role model:**

| Role | Can do |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke all roles, pause/unpause |
| `DATA_CONTRIBUTOR_ROLE` | `registerDataset()` |
| `MODEL_TRAINER_ROLE` | `registerModel()` |
| `VALIDATOR_ROLE` | `activateDataset()`, `activateModel()` |
| `REGISTRAR_ROLE` | `logInference()`, `commitBatch()` |
| `GOVERNANCE_ROLE` | Held by BioDAO — executes passed proposals |

**Registration ≠ activation.** A dataset or model is registered when its hash is anchored on-chain. It becomes active only when a `VALIDATOR_ROLE` address calls `activate*()`. `logInference()` requires an active model backed by an active dataset.

**Batch commitments.** `commitBatch()` stores a Merkle root of N inference hashes in a single transaction. Individual proofs are kept off-chain. O(1) gas cost per batch regardless of N.

**Replay protection.** `inferenceId = keccak256(modelCommitment, inputHash, msg.sender, block.timestamp)` — same input at different times produces distinct auditable records.

**ZK hook.** `verifyZKProof()` is a no-op placeholder. The interface is stable — drop in a Groth16 or PLONK verifier without changing anything else.

### `BioToken` — governance token

ERC20 with vote delegation (`ERC20Votes`) and gasless approvals (`ERC20Permit`). Fixed supply of 10,000,000 BIO minted to deployer on construction. No mint function.

### `BioDAO` — governance

Token-weighted voting: propose → castVote → executeProposal.

| Parameter | Value |
|---|---|
| Voting period | 50,400 blocks (~7 days) |
| Proposal threshold | 1% of total supply |
| Quorum | 4% of total supply |
| Execution delay | 100 blocks after passing |

---

## Setup

### Prerequisites

- Python ≥ 3.9
- Node.js ≥ 18
- A funded wallet on Polygon Amoy ([faucet](https://faucet.polygon.technology/))

### 1. Python environment

```bash
pip install -r requirements.txt
```

### 2. Blockchain environment

```bash
npm install
npm run compile        # compiles contracts, generates ABI artifacts
```

### 3. Environment variables

Create `.env` in the project root:

```env
# Blockchain — Python side
BLOCKCHAIN_RPC_URL=https://rpc-amoy.polygon.technology/
REGISTRAR_PRIVATE_KEY=0x...
BIOLEDGER_CONTRACT_ADDR=0x...         # filled in after deploy
BIOLEDGER_ABI_PATH=./artifacts/contracts/core/BioLedgerV2.sol/BioLedgerV2.json

# Blockchain — Hardhat side
PRIVATE_KEY=0x...
POLYGON_AMOY_RPC_URL=https://rpc-amoy.polygon.technology/
POLYGONSCAN_API_KEY=...               # optional, for contract verification

# Role wallets — optional, deployer gets all roles if unset
DATA_CONTRIBUTOR_WALLET=0x...
MODEL_TRAINER_WALLET=0x...
VALIDATOR_WALLET=0x...
PIPELINE_WALLET=0x...                 # gets REGISTRAR_ROLE

# Flask
BATCH_SIZE=50                         # inferences buffered before auto-flush
POLYGONSCAN_BASE_URL=https://amoy.polygonscan.com/tx
```

---

## Running the pipeline

Follow these steps in order. Steps 1–3 are done once per model version. Step 4 runs continuously.

### Step 1 — Prepare dataset

Put authorized face images in `dataset/authorized/`. Supported formats: `.jpg`, `.jpeg`, `.png`, `.bmp`.

Minimum 3 images. More is better — the centroid is more stable with 10–20 diverse images of the same subject under different lighting and angles.

```
dataset/
└── authorized/
    ├── alice_01.jpg
    ├── alice_02.jpg
    └── alice_03.jpg
```

### Step 2 — Train the cluster

```bash
python build_cluster.py
```

Embeds all images with ArcFace, runs DBSCAN, computes the centroid of the main cluster, saves `centroid.pkl`. Fails loudly if DBSCAN finds no valid cluster — there is no silent fallback (a poisoned centroid would silently compromise the integrity of every subsequent inference).

To tune clustering, edit `config.py`:

```python
HYPERPARAMETERS = {
    "dbscan_eps":         10.0,   # increase if too few points form a cluster
    "dbscan_min_samples": 2,      # minimum cluster size
    "anomaly_threshold":  0.4,    # cosine distance gate: above = SUSPICIOUS
    "embedding_model":    "ArcFace",
    "deepface_backend":   "opencv",
    "enforce_detection":  False,  # set True in production
}
```

> Any change to `config.py` means a new `modelCommitment`. You must re-run `build_cluster.py` and `register.py`.

### Step 3 — Deploy contracts (first time only)

```bash
# local testnet
npm run node                         # starts Hardhat local node
npm run deploy:local

# Polygon Amoy
npm run deploy:polygon
```

The deploy script outputs a `deployments/<network>.json` with all contract addresses. Copy `BioLedgerV2` into `BIOLEDGER_CONTRACT_ADDR` in your `.env`.

### Step 4 — Register dataset and model

```bash
python register.py --version 1.0.0
```

This:
1. Captures `pip freeze` → `environment_snapshot.txt`
2. Builds a Merkle root of all dataset images → `registerDataset()` + `activateDataset()`
3. Computes `modelCommitment` → `registerModel()` + `activateModel()`
4. Saves everything to `registered_hashes.json`

`registered_hashes.json` is loaded by `app.py` at startup. It must exist before running the server.

### Step 5 — Start the API

```bash
python app.py
```

Server runs on `http://localhost:5000`.

---

## API reference

### `POST /analyze`

Submit a face image for scoring.

**Request:** `multipart/form-data` with field `image`.

**Response:**

```json
{
  "trust_score":      87.4,
  "anomaly":          false,
  "cosine_distance":  0.1260,
  "status":           "AUTHORIZED",
  "filename":         "alice.jpg",
  "input_hash":       "0x3a1f...",
  "output_hash":      "0xc72b...",
  "model_commitment": "0xfa93...",
  "dataset_hash":     "0x4d2e...",
  "blockchain": {
    "inference_id":    "0x8e1c...",
    "tx_hash":         "0xabc1...",
    "block_number":    4821903,
    "polygonscan_url": "https://amoy.polygonscan.com/tx/0xabc1..."
  }
}
```

`trust_score` and `anomaly` are always consistent: `threshold=0.4` → `trust_score=60` is the crossover. A score above 60 is AUTHORIZED; below is SUSPICIOUS.

Inferences are buffered in-memory and flushed as a Merkle batch to `commitBatch()` every `BATCH_SIZE` requests (default 50).

---

### `POST /verify`

Verify a previous inference against its on-chain record.

**Request:**

```json
{
  "inference_id": "0x8e1c...",
  "input":        "/path/to/original/image.jpg",
  "output": {
    "trust_score": 87.4,
    "anomaly": false,
    "cosine_distance": 0.126,
    "status": "AUTHORIZED"
  }
}
```

**Response:**

```json
{
  "verified":     true,
  "reason":       "Input and output hashes match on-chain record",
  "inference_id": "0x8e1c...",
  "timestamp":    1712345678,
  "called_by":    "0xregistrar..."
}
```

---

### `GET /lineage/<inference_id>`

Full Dataset → Model → Inference provenance chain.

**Response:**

```json
{
  "inference": { "inferenceId": "0x...", "modelCommitment": "0x...", "inputHash": "0x...", "outputHash": "0x...", "timestamp": 1712345678, "calledBy": "0x..." },
  "model":     { "modelCommitment": "0x...", "modelArtifactHash": "0x...", "datasetHash": "0x...", "version": {...}, "registeredBy": "0x..." },
  "dataset":   { "datasetHash": "0x...", "version": {...}, "registeredBy": "0x..." },
  "summary":   "Inference logged at 2024-04-05 14:21:18 UTC using model v1.0.0 trained on dataset v1.0.0."
}
```

---

### `POST /batch/flush`

Manually flush the pending inference buffer to `commitBatch()` without waiting for `BATCH_SIZE` to be reached. Useful before a planned shutdown.

---

### `GET /health`

```json
{
  "status":                  "AI server running",
  "model_commitment_loaded": true,
  "model_commitment":        "0xfa93...",
  "pending_batch_size":      12,
  "batch_flush_threshold":   50,
  "blockchain_connected":    true,
  "registrar_wallet":        "0xregistrar..."
}
```

---

## Trust score interpretation

| Cosine distance | Trust score | Status |
|---|---|---|
| 0.00 – 0.40 | 60 – 100 | `AUTHORIZED` |
| 0.40 – 1.00 | 0 – 60 | `SUSPICIOUS` |

The threshold (0.4) is set in `config.py` under `anomaly_threshold` and is baked into the `modelCommitment`. Changing it produces a new model version that must be re-registered.

---

## Re-registering a new model version

1. Make changes (new dataset images, updated hyperparameters, dependency upgrades)
2. Re-run `build_cluster.py`
3. Re-run `register.py --version 1.1.0` (bump the version)
4. Update `BIOLEDGER_CONTRACT_ADDR` in `.env` if you redeployed the contract
5. Restart `app.py`

The old `modelCommitment` remains on-chain permanently. Historical inferences remain verifiable.

---

## Environment variables — full reference

| Variable | Used by | Default | Notes |
|---|---|---|---|
| `BLOCKCHAIN_RPC_URL` | `blockchain.py` | `http://127.0.0.1:8545` | Hardhat local or Polygon Amoy RPC |
| `REGISTRAR_PRIVATE_KEY` | `blockchain.py` | — | Wallet with `REGISTRAR_ROLE` |
| `BIOLEDGER_CONTRACT_ADDR` | `blockchain.py` | — | From `deployments/<network>.json` |
| `BIOLEDGER_ABI_PATH` | `blockchain.py` | hardcoded local path | Relative path works: `./artifacts/...` |
| `PRIVATE_KEY` | `hardhat.config.js` | — | Deployer wallet |
| `POLYGON_AMOY_RPC_URL` | `hardhat.config.js` | — | Required for Amoy deploy |
| `POLYGONSCAN_API_KEY` | `hardhat.config.js` | `""` | Optional — for contract verification |
| `DATA_CONTRIBUTOR_WALLET` | `scripts/deploy.js` | deployer | Gets `DATA_CONTRIBUTOR_ROLE` |
| `MODEL_TRAINER_WALLET` | `scripts/deploy.js` | deployer | Gets `MODEL_TRAINER_ROLE` |
| `VALIDATOR_WALLET` | `scripts/deploy.js` | deployer | Gets `VALIDATOR_ROLE` |
| `PIPELINE_WALLET` | `scripts/deploy.js` | deployer | Gets `REGISTRAR_ROLE` |
| `BATCH_SIZE` | `app.py` | `50` | Inferences buffered before auto-flush |
| `POLYGONSCAN_BASE_URL` | `app.py` | `https://amoy.polygonscan.com/tx` | Prefix for explorer links |

---

## Known limitations / what's next

- **`enforce_detection=False`** — non-face images will return an embedding rather than erroring. Set to `True` in production and handle `ValueError` at the call site in `embedder.py`.
- **`BIOLEDGER_ABI_PATH` is hardcoded** to an absolute local path in `blockchain.py`. Set the env var to a relative path before deploying anywhere other than the original dev machine.
- **Batch Merkle proofs are off-chain** — `commitBatch()` stores only the root. If you need to prove a specific inference is inside a committed batch, you need to store and serve the individual proofs separately.
- **ZK verifier is a stub** — `verifyZKProof()` always returns `true`. Replace the body with a real Groth16/PLONK verifier when ready; the interface is already in place.
- **BioDAO not wired to BioLedger** — `GOVERNANCE_ROLE` is granted to BioDAO on deploy, but no DAO-callable proposals are defined yet that exercise it.
