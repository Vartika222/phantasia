"use strict";

require("dotenv").config();

const axios    = require("axios");
const FormData = require("form-data");
const fs       = require("fs");
const path     = require("path");

const PINATA_BASE = "https://api.pinata.cloud";

/**
 * Build Pinata auth headers from environment variables.
 * @returns {{ pinata_api_key: string, pinata_secret_api_key: string }}
 */
function pinataHeaders() {
  const key    = process.env.PINATA_API_KEY;
  const secret = process.env.PINATA_SECRET_API_KEY;

  if (!key || !secret) {
    throw new Error(
      "ipfs: PINATA_API_KEY and PINATA_SECRET_API_KEY must be set in your .env file"
    );
  }

  return {
    pinata_api_key:        key,
    pinata_secret_api_key: secret,
  };
}

/**
 * Upload a JSON object to IPFS via Pinata.
 * @param {object} jsonObject
 * @param {string} [name]
 * @returns {Promise<string>} ipfs://<CID>
 */
async function uploadJSON(jsonObject, name) {
  const pinName = name || "bioledger-metadata";

  const body = {
    pinataOptions:  { cidVersion: 1 },
    pinataMetadata: { name: pinName },
    pinataContent:  jsonObject,
  };

  const response = await axios.post(
    `${PINATA_BASE}/pinning/pinJSONToIPFS`,
    body,
    {
      headers: Object.assign({}, pinataHeaders(), { "Content-Type": "application/json" }),
    }
  );

  const cid = response.data.IpfsHash;
  console.log(`  [IPFS] JSON uploaded  → ipfs://${cid}  (${pinName})`);
  return `ipfs://${cid}`;
}

/**
 * Upload a file from disk to IPFS via Pinata.
 * @param {string} filePath
 * @param {string} [name]
 * @returns {Promise<string>} ipfs://<CID>
 */
async function uploadFile(filePath, name) {
  const fileName = name || path.basename(filePath);

  const form = new FormData();
  form.append("file",           fs.createReadStream(filePath), { filename: fileName });
  form.append("pinataOptions",  JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: fileName }));

  const formHeaders = form.getHeaders();

  const response = await axios.post(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: Object.assign({}, pinataHeaders(), formHeaders),
    }
  );

  const cid = response.data.IpfsHash;
  console.log(`  [IPFS] File uploaded  → ipfs://${cid}  (${fileName})`);
  return `ipfs://${cid}`;
}

/**
 * Upload an in-memory Buffer to IPFS via Pinata.
 * @param {Buffer}  buffer
 * @param {string}  filename
 * @param {string}  [pinName]
 * @returns {Promise<string>} ipfs://<CID>
 */
async function uploadBuffer(buffer, filename, pinName) {
  const label = pinName || filename;

  const form = new FormData();
  form.append("file",           buffer, { filename });
  form.append("pinataOptions",  JSON.stringify({ cidVersion: 1 }));
  form.append("pinataMetadata", JSON.stringify({ name: label }));

  const formHeaders = form.getHeaders();

  const response = await axios.post(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    form,
    {
      headers: Object.assign({}, pinataHeaders(), formHeaders),
    }
  );

  const cid = response.data.IpfsHash;
  console.log(`  [IPFS] Buffer uploaded → ipfs://${cid}  (${filename})`);
  return `ipfs://${cid}`;
}

/**
 * Test that Pinata credentials are valid.
 * @returns {Promise<boolean>}
 */
async function testAuthentication() {
  try {
    const response = await axios.get(
      `${PINATA_BASE}/data/testAuthentication`,
      { headers: pinataHeaders() }
    );
    return (
      response.data.message ===
      "Congratulations! You are communicating with the Pinata API!"
    );
  } catch (err) {
    console.error("  [IPFS] Auth test failed:", err.message);
    return false;
  }
}

module.exports = {
  uploadJSON,
  uploadFile,
  uploadBuffer,
  testAuthentication,
};