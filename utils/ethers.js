"use strict";

require("dotenv").config();

const { ethers } = require("ethers");
const fs         = require("fs");
const path       = require("path");

// Load ABIs from Hardhat artifacts
const BioLedgerArtifact = require("../artifacts/contracts/core/BioLedger.sol/BioLedger.json");
const BioTokenArtifact  = require("../artifacts/contracts/governance/BioToken.sol/BioToken.json");
const BioDAOArtifact    = require("../artifacts/contracts/governance/BioDAO.sol/BioDAO.json");

/**
 * Load the deployment artifact for a given network.
 * @param {string} networkName  e.g. "localhost" | "polygonAmoy"
 * @returns {object} deployment artifact with contract addresses
 */
function loadDeployment(networkName) {
  const artifactPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${networkName}.json`
  );

  if (!fs.existsSync(artifactPath)) {
    throw new Error(
      `ethers.js: No deployment found for network "${networkName}". ` +
      `Run "npm run deploy:${networkName}" first.`
    );
  }

  return JSON.parse(fs.readFileSync(artifactPath, "utf8"));
}

/**
 * Create an ethers provider from environment or default to localhost.
 * @returns {ethers.JsonRpcProvider}
 */
function getProvider() {
  const rpc = process.env.POLYGON_AMOY_RPC_URL || "http://127.0.0.1:8545";
  return new ethers.JsonRpcProvider(rpc);
}

/**
 * Create a signer (wallet) from PRIVATE_KEY in .env.
 * @param {ethers.JsonRpcProvider} [provider]
 * @returns {ethers.Wallet}
 */
function getSigner(provider) {
  const pk = process.env.PRIVATE_KEY;

  if (!pk) {
    throw new Error("ethers.js: PRIVATE_KEY not set in .env");
  }

  const resolvedProvider = provider || getProvider();
  return new ethers.Wallet(pk, resolvedProvider);
}

/**
 * Return all three contract instances connected to a signer.
 * This is the main export your backend should use.
 *
 * @param {string} networkName  "localhost" | "polygonAmoy"
 * @returns {{
 *   bioLedger: ethers.Contract,
 *   bioToken:  ethers.Contract,
 *   bioDAO:    ethers.Contract,
 *   signer:    ethers.Wallet,
 *   provider:  ethers.JsonRpcProvider,
 *   addresses: object
 * }}
 *
 * @example
 * const { bioLedger, signer } = getContracts("localhost");
 * await bioLedger.registerDatasetVersion(hash, uri);
 */
function getContracts(networkName) {
  const deployment = loadDeployment(networkName);
  const provider   = getProvider();
  const signer     = getSigner(provider);

  const bioLedger = new ethers.Contract(
    deployment.contracts.BioLedger,
    BioLedgerArtifact.abi,
    signer
  );

  const bioToken = new ethers.Contract(
    deployment.contracts.BioToken,
    BioTokenArtifact.abi,
    signer
  );

  const bioDAO = new ethers.Contract(
    deployment.contracts.BioDAO,
    BioDAOArtifact.abi,
    signer
  );

  return {
    bioLedger,
    bioToken,
    bioDAO,
    signer,
    provider,
    addresses: deployment.contracts,
  };
}

/**
 * Convenience: connect to localhost (hardhat node).
 * @returns same shape as getContracts()
 */
function getLocalContracts() {
  return getContracts("localhost");
}

/**
 * Convenience: connect to Polygon Amoy testnet.
 * @returns same shape as getContracts()
 */
function getPolygonContracts() {
  return getContracts("polygonAmoy");
}

module.exports = {
  getProvider,
  getSigner,
  getContracts,
  getLocalContracts,
  getPolygonContracts,
  loadDeployment,
};