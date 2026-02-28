"use strict";

/**
 * hasher.js
 * Deterministic keccak256 hashing utilities for the BioLedger JS pipeline.
 *
 * Fix vs original: buildMetadata() was referenced in pipeline.js but
 * never defined in hasher.js — added here.
 */

const { ethers } = require("ethers");
const msgpack    = require("msgpack-lite");
const fs         = require("fs");
const path       = require("path");

// ── Primitives ────────────────────────────────────────────────────────────────

/**
 * keccak256 a raw Buffer / Uint8Array.
 * @param {Buffer|Uint8Array} bytes
 * @returns {string} 0x-prefixed hex
 */
function keccak256Bytes(bytes) {
  return ethers.keccak256(bytes);
}

/**
 * keccak256 a UTF-8 string.
 * @param {string} str
 * @returns {string} 0x-prefixed hex
 */
function hashString(str) {
  return keccak256Bytes(Buffer.from(str, "utf8"));
}

/**
 * keccak256 a file's raw bytes.
 * @param {string} filePath
 * @returns {string} 0x-prefixed hex
 */
function hashFile(filePath) {
  return keccak256Bytes(fs.readFileSync(filePath));
}

// ── Dataset Merkle Tree ───────────────────────────────────────────────────────

/**
 * Build a keccak256 Merkle tree over an ordered list of file paths.
 * Files MUST be sorted by the caller (register.py sorts; JS pipeline must too).
 *
 * @param {string[]} filePaths  Sorted list of absolute or relative paths
 * @returns {{ root: string, leaves: string[], tree: string[][] }}
 */
function buildDatasetMerkleTree(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error("hasher: no files provided to buildDatasetMerkleTree");
  }

  let layer     = filePaths.map((fp) => keccak256Bytes(fs.readFileSync(fp)));
  const allLayers = [layer.slice()];

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left     = layer[i];
      const right    = layer[i + 1] ?? layer[i]; // duplicate last leaf if odd
      // Sort pair before hashing — matches blockchain.py build_merkle_root
      const combined = [left, right].sort().join("");
      next.push(keccak256Bytes(Buffer.from(combined.replace(/^0x/g, ""), "hex")));
    }
    layer = next;
    allLayers.push(layer.slice());
  }

  return { root: layer[0], leaves: allLayers[0], tree: allLayers };
}

/**
 * Compute Merkle root from in-memory Buffers (no disk I/O).
 * @param {Buffer[]} buffers
 * @returns {string} 0x-prefixed hex root
 */
function merkleRootFromBuffers(buffers) {
  if (!buffers || buffers.length === 0) {
    throw new Error("hasher: empty buffers passed to merkleRootFromBuffers");
  }

  let layer = buffers.map((b) => keccak256Bytes(b));

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left     = layer[i];
      const right    = layer[i + 1] ?? layer[i];
      const combined = [left, right].sort().join("");
      next.push(keccak256Bytes(Buffer.from(combined.replace(/^0x/g, ""), "hex")));
    }
    layer = next;
  }

  return layer[0];
}

// ── Model Hashing ─────────────────────────────────────────────────────────────

/**
 * Hash a model file from disk.
 * @param {string} modelFilePath
 * @returns {string} 0x-prefixed hex
 */
function hashModelFile(modelFilePath) {
  return hashFile(modelFilePath);
}

/**
 * Hash a model from an in-memory Buffer.
 * @param {Buffer} modelBytes
 * @returns {string} 0x-prefixed hex
 */
function hashModelBytes(modelBytes) {
  return keccak256Bytes(modelBytes);
}

// ── Inference Hashing ─────────────────────────────────────────────────────────

/**
 * Hash an inference payload deterministically using canonical msgpack.
 * Object keys are sorted. Floats are rounded to 8 decimal places.
 * Matches blockchain.py keccak256_dict semantics.
 *
 * @param {object} payload
 * @returns {string} 0x-prefixed hex
 */
function hashInferencePayload(payload) {
  const normalized = normalizeForHashing(payload);
  const packed     = msgpack.encode(normalized);
  return keccak256Bytes(packed);
}

/**
 * Recursively normalize a value for deterministic hashing:
 *   - Object keys sorted alphabetically
 *   - Non-integer floats rounded to 8 dp
 *   - Arrays and primitives passed through
 *
 * @param {*} value
 * @returns {*}
 */
function normalizeForHashing(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeForHashing);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = normalizeForHashing(value[key]);
    }
    return sorted;
  }
  if (typeof value === "number" && !Number.isInteger(value)) {
    return parseFloat(value.toFixed(8));
  }
  return value;
}

// ── Metadata Builder ──────────────────────────────────────────────────────────

/**
 * Build a provenance metadata object for IPFS upload.
 * Called by pipeline.js for both dataset and model registrations.
 *
 * @param {"dataset"|"model"} type
 * @param {object}            fields  Additional fields to merge in
 * @returns {object}
 */
function buildMetadata(type, fields = {}) {
  return {
    type,
    createdAt: new Date().toISOString(),
    schema:    "bioledger/v2",
    ...fields,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  keccak256Bytes,
  hashString,
  hashFile,
  buildDatasetMerkleTree,
  merkleRootFromBuffers,
  hashModelFile,
  hashModelBytes,
  hashInferencePayload,
  normalizeForHashing,
  buildMetadata,
};