"use strict";

const { ethers }  = require("ethers");
const msgpack     = require("msgpack-lite");
const fs          = require("fs");
const path        = require("path");

// ── Primitives ────────────────────────────────────────────────────────────────

function keccak256Bytes(bytes) {
  return ethers.keccak256(bytes);
}

function hashString(str) {
  return keccak256Bytes(Buffer.from(str, "utf8"));
}

function hashFile(filePath) {
  return keccak256Bytes(fs.readFileSync(filePath));
}

// ── Dataset Merkle Tree ───────────────────────────────────────────────────────

/**
 * Build a keccak256 Merkle tree over an ordered list of file paths.
 * Returns the root as a bytes32 hex string.
 */
function buildDatasetMerkleTree(filePaths) {
  if (!filePaths || filePaths.length === 0) {
    throw new Error("hasher: no files provided");
  }

  let layer = filePaths.map((fp) => keccak256Bytes(fs.readFileSync(fp)));
  const allLayers = [layer.slice()];

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left  = layer[i];
      const right = layer[i + 1] ?? layer[i];
      const combined = [left, right].sort().join("");
      next.push(keccak256Bytes(Buffer.from(combined.replace(/^0x/, ""), "hex")));
    }
    layer = next;
    allLayers.push(layer.slice());
  }

  return { root: layer[0], leaves: allLayers[0], tree: allLayers };
}

/**
 * Compute Merkle root from in-memory buffers (no disk I/O).
 */
function merkleRootFromBuffers(buffers) {
  if (!buffers || buffers.length === 0) throw new Error("hasher: empty buffers");

  let layer = buffers.map((b) => keccak256Bytes(b));

  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left  = layer[i];
      const right = layer[i + 1] ?? layer[i];
      const combined = [left, right].sort().join("");
      next.push(keccak256Bytes(Buffer.from(combined.replace(/^0x/, ""), "hex")));
    }
    layer = next;
  }

  return layer[0];
}

// ── Model Hashing ─────────────────────────────────────────────────────────────

function hashModelFile(modelFilePath) {
  return hashFile(modelFilePath);
}

function hashModelBytes(modelBytes) {
  return keccak256Bytes(modelBytes);
}

// ── Inference Hashing ─────────────────────────────────────────────────────────

/**
 * Hash an inference payload deterministically using canonical msgpack.
 * Object keys are sorted. Floats are rounded to 8 decimal places.
 * Use this for BOTH input and output payloads.
 */
function hashInferencePayload(payload) {
  const normalized = normalizeForHashing(payload);
  const packed     = msgpack.encode(normalized);
  return keccak256Bytes(packed);
}

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

// ── Metadata ─────────────────────────────────────────────────────────────────