"use strict";

const { ethers }  = require("ethers");
const hasher      = require("./hasher");
const ipfsClient  = require("./ipfs");

async function registerDataset({ filePaths, metadata = {}, contract, ipfsEnabled = true }) {
  console.log("\n[Pipeline] Registering dataset...");

  const { root: merkleRoot, leaves } = hasher.buildDatasetMerkleTree(filePaths);
  console.log(`  Merkle root : ${merkleRoot}`);

  const metaObject = hasher.buildMetadata("dataset", {
    merkleRoot,
    fileCount: filePaths.length,
    leaves,
    ...metadata,
  });

  let metadataURI = "";
  if (ipfsEnabled) {
    metadataURI = await ipfsClient.uploadJSON(metaObject, `dataset-${merkleRoot.slice(2, 10)}`);
  }

  const tx      = await contract.registerDatasetVersion(merkleRoot, metadataURI);
  const receipt = await tx.wait();
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { merkleRoot, metadataURI, tx: receipt };
}

async function registerModel({ modelPath, datasetHash, metadata = {}, contract, ipfsEnabled = true }) {
  console.log("\n[Pipeline] Registering model...");

  const modelHash = hasher.hashModelFile(modelPath);
  console.log(`  Model hash  : ${modelHash}`);
  console.log(`  Dataset ref : ${datasetHash}`);

  const metaObject = hasher.buildMetadata("model", {
    modelHash,
    datasetHash,
    modelFile: require("path").basename(modelPath),
    ...metadata,
  });

  let metadataURI = "";
  if (ipfsEnabled) {
    metadataURI = await ipfsClient.uploadJSON(metaObject, `model-${modelHash.slice(2, 10)}`);
  }

  const tx      = await contract.registerModelVersion(modelHash, datasetHash, metadataURI);
  const receipt = await tx.wait();
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { modelHash, metadataURI, tx: receipt };
}

async function logInference({ modelHash, input, output, contract }) {
  console.log("\n[Pipeline] Logging inference...");

  const inputHash  = hasher.hashInferencePayload(input);
  const outputHash = hasher.hashInferencePayload(output);
  console.log(`  Input hash  : ${inputHash}`);
  console.log(`  Output hash : ${outputHash}`);

  const tx      = await contract.logInference(modelHash, inputHash, outputHash);
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
    } catch (_) {}
  }

  console.log(`  Inference ID: ${inferenceId}`);
  console.log(`  Confirmed   : block ${receipt.blockNumber}, tx ${receipt.hash}`);

  return { inferenceId, inputHash, outputHash, tx: receipt };
}

module.exports = { registerDataset, registerModel, logInference };