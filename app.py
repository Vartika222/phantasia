"""
app.py — V2
Flask API with full V2 blockchain integration.
New endpoints: /verify, /batch/flush, /lineage/<id>

Fixes vs original:
  1. keccak256_bytes imported from blockchain — Web3_keccak_pair helper deleted.
  2. pair_hash now uses keccak256_bytes(a + b) consistently with blockchain.py.
"""

import os
import json
import logging
import datetime
from collections import deque

os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from ai_module import analyze_image
from blockchain import (
    get_client,
    keccak256_file,
    keccak256_dict,
    keccak256_bytes,    # FIX: import directly — replaces Web3_keccak_pair
    bytes32_to_hex,
    build_merkle_root,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)

app           = Flask(__name__)
CORS(app)
UPLOAD_FOLDER = "uploads"
HASHES_PATH   = "registered_hashes.json"
POLYGONSCAN   = os.getenv("POLYGONSCAN_BASE_URL", "https://amoy.polygonscan.com/tx")
BATCH_SIZE    = int(os.getenv("BATCH_SIZE", "50"))

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

_pending_batch: deque = deque()


def load_registered_hashes():
    if not os.path.exists(HASHES_PATH):
        raise FileNotFoundError(
            f"{HASHES_PATH} not found. Run register.py before starting app.py."
        )
    with open(HASHES_PATH) as f:
        return json.load(f)


try:
    _reg                   = load_registered_hashes()
    MODEL_COMMITMENT_HEX   = _reg["model_commitment"]
    DATASET_HASH_HEX       = _reg["dataset_hash"]
    MODEL_COMMITMENT_BYTES = bytes.fromhex(MODEL_COMMITMENT_HEX.replace("0x", ""))
    logger.info(f"Model commitment : {MODEL_COMMITMENT_HEX}")
    logger.info(f"Dataset hash     : {DATASET_HASH_HEX}")
except FileNotFoundError as e:
    logger.error(str(e))
    MODEL_COMMITMENT_BYTES = None
    MODEL_COMMITMENT_HEX   = None
    DATASET_HASH_HEX       = None


@app.route("/analyze", methods=["POST"])
def analyze():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400

    file     = request.files["image"]
    filepath = os.path.join(UPLOAD_FOLDER, file.filename)
    file.save(filepath)

    # 1. AI inference
    result = analyze_image(filepath)

    # 2. Compute hashes
    input_hash_bytes = keccak256_file(filepath)
    output_payload   = {
        "trust_score":     result["trust_score"],
        "anomaly":         result["anomaly"],
        "cosine_distance": result["cosine_distance"],
        "status":          result["status"],
    }
    output_hash_bytes = keccak256_dict(output_payload)

    # 3. Log on-chain
    chain_result = {}
    chain_error  = None

    if MODEL_COMMITMENT_BYTES is None:
        chain_error = "registered_hashes.json not loaded — run register.py first"
    else:
        try:
            client       = get_client()
            chain_result = client.log_inference(
                model_commitment = MODEL_COMMITMENT_BYTES,
                input_hash       = input_hash_bytes,
                output_hash      = output_hash_bytes,
            )
            # FIX: use keccak256_bytes from blockchain.py — no more Web3_keccak_pair
            pair_hash = keccak256_bytes(input_hash_bytes + output_hash_bytes)
            _pending_batch.append(pair_hash)
            if len(_pending_batch) >= BATCH_SIZE:
                _flush_batch(client)
        except Exception as e:
            chain_error = str(e)
            logger.error(f"log_inference failed: {e}")

    return jsonify({
        "trust_score":      result["trust_score"],
        "anomaly":          result["anomaly"],
        "cosine_distance":  result["cosine_distance"],
        "status":           result["status"],
        "filename":         file.filename,
        "input_hash":       bytes32_to_hex(input_hash_bytes),
        "output_hash":      bytes32_to_hex(output_hash_bytes),
        "model_commitment": MODEL_COMMITMENT_HEX,
        "dataset_hash":     DATASET_HASH_HEX,
        "blockchain": {
            "inference_id":    chain_result.get("inference_id"),
            "tx_hash":         chain_result.get("tx_hash"),
            "block_number":    chain_result.get("block_number"),
            "polygonscan_url": (
                f"{POLYGONSCAN}/{chain_result['tx_hash']}"
                if chain_result.get("tx_hash") else None
            ),
            "error": chain_error,
        },
    }), 200


@app.route("/verify", methods=["POST"])
def verify():
    """
    Verify an inference record on-chain.
    Body: { inference_id, input, output }
    Where input/output are the original payloads (not hashes).
    Returns: { verified: bool, reason: str }
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    inference_id = data.get("inference_id")
    input_data   = data.get("input")
    output_data  = data.get("output")

    if not all([inference_id, input_data is not None, output_data is not None]):
        return jsonify({"error": "inference_id, input, and output are required"}), 400

    try:
        # Recompute hashes from provided payloads
        if isinstance(input_data, str):
            # If input is a file path (image case) — hash the file
            input_hash_bytes = keccak256_file(input_data)
        else:
            input_hash_bytes = keccak256_dict(input_data)

        output_hash_bytes = keccak256_dict(output_data)

        client = get_client()
        result = client.verify_inference(
            inference_id_hex  = inference_id,
            input_hash_bytes  = input_hash_bytes,
            output_hash_bytes = output_hash_bytes,
        )
        return jsonify(result), 200
    except Exception as e:
        logger.error(f"verify failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/lineage/<inference_id>", methods=["GET"])
def lineage(inference_id):
    """Return full Dataset → Model → Inference lineage chain."""
    try:
        client = get_client()
        data   = client.get_lineage(inference_id)

        inf     = data["inference"]
        model   = data["model"]
        dataset = data["dataset"]

        ts = datetime.datetime.utcfromtimestamp(inf["timestamp"]).strftime(
            "%Y-%m-%d %H:%M:%S UTC"
        )

        data["summary"] = (
            f"Inference logged at {ts} "
            f"using model v{model.get('version', '?')} "
            f"trained on dataset v{dataset.get('version', '?')}."
        )

        return jsonify(data), 200
    except Exception as e:
        logger.error(f"lineage failed: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/batch/flush", methods=["POST"])
def batch_flush():
    """Manually flush pending batch to blockchain."""
    if MODEL_COMMITMENT_BYTES is None:
        return jsonify({"error": "Model commitment not loaded"}), 500
    if not _pending_batch:
        return jsonify({"status": "no pending inferences"}), 200
    try:
        result = _flush_batch(get_client())
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/health", methods=["GET"])
def health():
    status = {
        "status":                  "AI server running",
        "model_commitment_loaded": MODEL_COMMITMENT_BYTES is not None,
        "model_commitment":        MODEL_COMMITMENT_HEX,
        "pending_batch_size":      len(_pending_batch),
        "batch_flush_threshold":   BATCH_SIZE,
    }
    try:
        client = get_client()
        status["blockchain_connected"] = client.w3.is_connected()
        status["registrar_wallet"]     = client.address
    except Exception as e:
        status["blockchain_connected"] = False
        status["blockchain_error"]     = str(e)
    return jsonify(status), 200


def _flush_batch(client) -> dict:
    hashes = list(_pending_batch)
    _pending_batch.clear()
    return client.commit_batch(
        model_commitment = MODEL_COMMITMENT_BYTES,
        inference_hashes = hashes,
    )


if __name__ == "__main__":
    app.run(debug=True, port=5000)