"use strict";

/**
 * pipeline.js
 * High-level helpers that glue hasher + ipfs + contract calls together.
 *
 * Fixes vs original:
 *   1. registerDataset called contract.registerDatasetVersion() — method does
 *      not exist. Correct name is contract.registerDataset() and it takes
 *      (datasetHash, major, minor, patch, metadataURI).
 *   2. registerModel called contract.registerModelVersion() — does not exist.
 *      Correct name is contract.registerModel() and it takes
 *      (modelCommitment, modelArtifactHash, datasetHash, major, minor, patch, metadataURI).
 *   3. Version args (major, minor, patch) were missing entirely — added with
 *      caller-supplied semver or sensible defaults.
 *   4. logInference used contract.logInference correctly but event name was
 *      "InferenceLogged" (correct) — kept as-is.
 *   5. File sort added to registerDataset so Merkle root matches register.py.
 */

const path       = require("path");
const { ethers } = require("ethers");
const hasher     = require("./hasher");
const ipfsClient = require("./ipfs");

// ── Dataset ───────────────────────────────────────────────────────────────────

/**
 * Hash dataset files, upload metadata to IPFS, and call registerDataset().
 *
 * @param {object}            opts
 * @param {string[]}          opts.filePaths   Paths to dataset images (will be sorted)
 * @param {object}            opts.metadata     Extra fields for the IPFS provenance JSON
 * @param {ethers.Contract}   opts.contract     BioLedgerV2 contract instance
 * @param {boolean}           opts.ipfsEnabled  Upload metadata to IPFS (default true)
 * @param {number}            opts.major        Semver major (default 1)
 * @param {number}            opts.minor        Semver minor (default 0)
 * @param {number}            opts.patch        Semver patch (default 0)
 * @returns {Promise<{ merkleRoot: string, metadataURI: string, tx: object }>}
 */
async function registerDataset({
  filePaths,
  metadata    = {},
  contract,
  ipfsEnabled = true,
  major       = 1,
  minor       = 0,
  patch       = 0,
}) {
  console.log("\n[Pipeline] Registering dataset...");

  // FIX: sort so Merkle root is deterministic and matches register.py
  const sortedPaths = [...filePaths].sort();

  const { root: merkleRoot, leaves } = hasher.buildDatasetMerkleTree(sortedPaths);
  console.log(`  Merkle root : ${merkleRoot}`);

  const metaObject = hasher.buildMetadata("dataset", {
    merkleRoot,
    fileCount: sortedPaths.length,
    leaves,
    semver: `${major}.${minor}.${patch}`,
    ...metadata,
  });

  let metadataURI = "";
  if (ipfsEnabled) {
    metadataURI = await ipfsClient.uploadJSON(
      metaObject,
      `dataset-${merkleRoot.slice(2, 10)}`
    );
  }

  // FIX: correct method name and correct arg order
  const tx      = await contract.registerDataset(merkleRoot, major, minor, patch, metadataURI);
  const receipt = await tx.wait();
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { merkleRoot, metadataURI, tx: receipt };
}

// ── Model ─────────────────────────────────────────────────────────────────────

/**
 * Hash model artifact, upload metadata to IPFS, and call registerModel().
 *
 * @param {object}            opts
 * @param {string}            opts.modelPath      Path to centroid.pkl (or any model artifact)
 * @param {string}            opts.datasetHash    Merkle root of the active dataset (0x hex)
 * @param {string}            opts.modelCommitment keccak256 commitment from register.py (0x hex)
 * @param {object}            opts.metadata        Extra fields for the IPFS model card JSON
 * @param {ethers.Contract}   opts.contract        BioLedgerV2 contract instance
 * @param {boolean}           opts.ipfsEnabled     Upload metadata to IPFS (default true)
 * @param {number}            opts.major           Semver major (default 1)
 * @param {number}            opts.minor           Semver minor (default 0)
 * @param {number}            opts.patch           Semver patch (default 0)
 * @returns {Promise<{ modelHash: string, metadataURI: string, tx: object }>}
 */
async function registerModel({
  modelPath,
  datasetHash,
  modelCommitment,
  metadata    = {},
  contract,
  ipfsEnabled = true,
  major       = 1,
  minor       = 0,
  patch       = 0,
}) {
  console.log("\n[Pipeline] Registering model...");

  // modelArtifactHash = hash of raw centroid.pkl bytes
  const modelArtifactHash = hasher.hashModelFile(modelPath);
  console.log(`  Model artifact hash : ${modelArtifactHash}`);
  console.log(`  Model commitment    : ${modelCommitment}`);
  console.log(`  Dataset ref         : ${datasetHash}`);

  const metaObject = hasher.buildMetadata("model", {
    modelCommitment,
    modelArtifactHash,
    datasetHash,
    modelFile: path.basename(modelPath),
    semver:    `${major}.${minor}.${patch}`,
    ...metadata,
  });

  let metadataURI = "";
  if (ipfsEnabled) {
    metadataURI = await ipfsClient.uploadJSON(
      metaObject,
      `model-${modelCommitment.slice(2, 10)}`
    );
  }

  // FIX: correct method name and correct arg order
  // registerModel(commitment, artifactHash, datasetHash, major, minor, patch, metadataURI)
  const tx      = await contract.registerModel(
    modelCommitment,
    modelArtifactHash,
    datasetHash,
    major, minor, patch,
    metadataURI
  );
  const receipt = await tx.wait();
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { modelArtifactHash, modelCommitment, metadataURI, tx: receipt };
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Hash input/output payloads and call logInference() on-chain.
 *
 * @param {object}            opts
 * @param {string}            opts.modelCommitment  Active model commitment (0x hex)
 * @param {object}            opts.input            Raw inference input (face image metadata, etc.)
 * @param {object}            opts.output           Raw inference output (trust score result, etc.)
 * @param {ethers.Contract}   opts.contract         BioLedgerV2 contract instance
 * @returns {Promise<{ inferenceId: string, inputHash: string, outputHash: string, tx: object }>}
 */
async function logInference({ modelCommitment, input, output, contract }) {
  console.log("\n[Pipeline] Logging inference...");

  const inputHash  = hasher.hashInferencePayload(input);
  const outputHash = hasher.hashInferencePayload(output);
  console.log(`  Input hash  : ${inputHash}`);
  console.log(`  Output hash : ${outputHash}`);

  const tx      = await contract.logInference(modelCommitment, inputHash, outputHash);
  const receipt = await tx.wait();

  const iface = contract.interface;
  let inferenceId = null;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "InferenceLogged") {
        inferenceId = parsed.args.inferenceId;
        break;
      }
    } catch (_) {
      // non-matching log — continue
    }
  }

  console.log(`  Inference ID: ${inferenceId}`);
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { inferenceId, inputHash, outputHash, tx: receipt };
}

// ── Batch ─────────────────────────────────────────────────────────────────────

/**
 * Commit a Merkle root of N inference hashes in one transaction.
 * More gas-efficient than logInference() for high-volume deployments.
 *
 * @param {object}            opts
 * @param {string}            opts.modelCommitment   Active model commitment (0x hex)
 * @param {string[]}          opts.inferenceHashes   Array of 0x-prefixed inference hashes
 * @param {ethers.Contract}   opts.contract          BioLedgerV2 contract instance
 * @returns {Promise<{ batchId: string, batchRoot: string, count: number, tx: object }>}
 */
async function commitBatch({ modelCommitment, inferenceHashes, contract }) {
  console.log("\n[Pipeline] Committing batch...");

  if (!inferenceHashes || inferenceHashes.length === 0) {
    throw new Error("commitBatch: inferenceHashes must not be empty");
  }

  // Build Merkle root from raw hex hashes converted to Buffers
  const buffers  = inferenceHashes.map((h) =>
    Buffer.from(h.replace(/^0x/, ""), "hex")
  );
  const batchRoot = hasher.merkleRootFromBuffers(buffers);
  const count     = inferenceHashes.length;

  console.log(`  Batch root  : ${batchRoot}`);
  console.log(`  Count       : ${count}`);

  const tx      = await contract.commitBatch(modelCommitment, batchRoot, count);
  const receipt = await tx.wait();

  const iface = contract.interface;
  let batchId = null;

  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === "BatchCommitted") {
        batchId = parsed.args.batchId;
        break;
      }
    } catch (_) {}
  }

  console.log(`  Batch ID    : ${batchId}`);
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { batchId, batchRoot, count, tx: receipt };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = { registerDataset, registerModel, logInference, commitBatch };