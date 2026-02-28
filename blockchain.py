"""
blockchain.py — V2
Bridge between Python AI backend and BioLedgerV2 smart contract.
"""

import os
import json
import logging
from pathlib import Path

from web3 import Web3
from web3.middleware import ExtraDataToPOAMiddleware
from eth_account import Account
from dotenv import load_dotenv

load_dotenv()
logger = logging.getLogger(__name__)

RPC_URL          = os.getenv("BLOCKCHAIN_RPC_URL", "http://127.0.0.1:8545")
PRIVATE_KEY      = os.getenv("REGISTRAR_PRIVATE_KEY")
CONTRACT_ADDRESS = os.getenv("BIOLEDGER_CONTRACT_ADDR")

ABI_PATH = Path(
    os.getenv(
        "BIOLEDGER_ABI_PATH",
        "/Users/vm/bioledger/artifacts/contracts/core/BioLedgerV2.sol/BioLedgerV2.json"
    )
)


# ── Hashing ───────────────────────────────────────────────────────────────────

def keccak256_file(filepath: str) -> bytes:
    with open(filepath, "rb") as f:
        return Web3.keccak(f.read())

def keccak256_bytes(data: bytes) -> bytes:
    return Web3.keccak(data)

def keccak256_dict(payload: dict) -> bytes:
    import math

    def normalize(val):
        if isinstance(val, dict):
            return {k: normalize(v) for k, v in sorted(val.items())}
        if isinstance(val, list):
            return [normalize(v) for v in val]
        if isinstance(val, float):
            if math.isnan(val) or math.isinf(val):
                raise ValueError(f"Non-serializable float: {val}")
            return round(val, 8)
        return val

    canonical = json.dumps(normalize(payload), separators=(",", ":"), sort_keys=True)
    return Web3.keccak(text=canonical)

def bytes32_to_hex(b: bytes) -> str:
    return "0x" + b.hex()

def build_merkle_root(hashes: list) -> bytes:
    if not hashes:
        raise ValueError("merkle_root: empty hash list")
    layer = list(hashes)
    while len(layer) > 1:
        next_layer = []
        for i in range(0, len(layer), 2):
            left  = layer[i]
            right = layer[i + 1] if i + 1 < len(layer) else layer[i]
            pair  = left + right if left.hex() <= right.hex() else right + left
            next_layer.append(Web3.keccak(pair))
        layer = next_layer
    return layer[0]


# ── Model Commitment ──────────────────────────────────────────────────────────

def compute_model_commitment(
    artifact_path: str,
    training_script_path: str,
    hyperparameters: dict,
    environment_path: str,
) -> tuple:
    """
    modelCommitment = keccak256(
        keccak256(centroid.pkl)         artifactHash
        keccak256(build_cluster.py)     scriptHash
        keccak256(canonical JSON)       hyperparamsHash
        keccak256(pip freeze snapshot)  environmentHash
    )
    Returns (model_commitment_bytes, model_artifact_hash_bytes)
    """
    artifact_hash    = keccak256_file(artifact_path)
    script_hash      = keccak256_file(training_script_path)
    hyperparams_hash = keccak256_dict(hyperparameters)
    environment_hash = keccak256_file(environment_path)

    combined         = artifact_hash + script_hash + hyperparams_hash + environment_hash
    model_commitment = Web3.keccak(combined)

    logger.info(f"  artifact_hash    : {bytes32_to_hex(artifact_hash)}")
    logger.info(f"  script_hash      : {bytes32_to_hex(script_hash)}")
    logger.info(f"  hyperparams_hash : {bytes32_to_hex(hyperparams_hash)}")
    logger.info(f"  environment_hash : {bytes32_to_hex(environment_hash)}")
    logger.info(f"  modelCommitment  : {bytes32_to_hex(model_commitment)}")

    return model_commitment, artifact_hash


def capture_environment_snapshot(output_path: str = "environment_snapshot.txt") -> str:
    import subprocess
    result = subprocess.run(["pip", "freeze"], capture_output=True, text=True, check=True)
    with open(output_path, "w") as f:
        f.write(result.stdout)
    logger.info(f"  Environment snapshot saved → {output_path}")
    return output_path


# ── Client ────────────────────────────────────────────────────────────────────

class BioLedgerClient:

    def __init__(self):
        if not PRIVATE_KEY:
            raise EnvironmentError("REGISTRAR_PRIVATE_KEY not set")
        if not CONTRACT_ADDRESS:
            raise EnvironmentError("BIOLEDGER_CONTRACT_ADDR not set")
        if not ABI_PATH.exists():
            raise FileNotFoundError(
                f"ABI not found at {ABI_PATH}. Run 'npm run compile' first."
            )

        self.w3 = Web3(Web3.HTTPProvider(RPC_URL))
        self.w3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        if not self.w3.is_connected():
            raise ConnectionError(f"Cannot connect to RPC at {RPC_URL}")

        self.account = Account.from_key(PRIVATE_KEY)
        self.address = self.account.address
        logger.info(f"blockchain: connected — wallet {self.address}")

        with open(ABI_PATH) as f:
            artifact = json.load(f)

        self.contract = self.w3.eth.contract(
            address=Web3.to_checksum_address(CONTRACT_ADDRESS),
            abi=artifact["abi"],
        )

    def _send(self, fn) -> dict:
        nonce   = self.w3.eth.get_transaction_count(self.address)
        gas_est = fn.estimate_gas({"from": self.address})
        tx = fn.build_transaction({
            "from":     self.address,
            "nonce":    nonce,
            "gas":      int(gas_est * 1.2),
            "gasPrice": self.w3.eth.gas_price,
        })
        signed  = self.w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
        tx_hash = self.w3.eth.send_raw_transaction(signed.raw_transaction)
        receipt = self.w3.eth.wait_for_transaction_receipt(tx_hash, timeout=120)
        if receipt.status != 1:
            raise RuntimeError(f"Transaction reverted — {tx_hash.hex()}")
        logger.info(f"blockchain: confirmed block {receipt.blockNumber}")
        return receipt

    # ── Dataset ───────────────────────────────────────────────────────────────

    def register_dataset(
        self,
        dataset_hash: bytes,
        major: int,
        minor: int,
        patch: int,
        metadata_uri: str = "",
    ) -> dict:
        if self.contract.functions.datasetExists(dataset_hash).call():
            return {"status": "already_registered", "dataset_hash": bytes32_to_hex(dataset_hash)}
        fn = self.contract.functions.registerDataset(
            dataset_hash, major, minor, patch, metadata_uri
        )
        receipt = self._send(fn)
        return {
            "status":       "registered",
            "tx_hash":      receipt.transactionHash.hex(),
            "block_number": receipt.blockNumber,
            "dataset_hash": bytes32_to_hex(dataset_hash),
        }

    def activate_dataset(self, dataset_hash: bytes) -> dict:
        if self.contract.functions.datasetIsActive(dataset_hash).call():
            return {"status": "already_active"}
        receipt = self._send(self.contract.functions.activateDataset(dataset_hash))
        return {
            "status":       "activated",
            "tx_hash":      receipt.transactionHash.hex(),
            "block_number": receipt.blockNumber,
        }

    # ── Model ─────────────────────────────────────────────────────────────────

    def register_model(
        self,
        model_commitment: bytes,
        model_artifact_hash: bytes,
        dataset_hash: bytes,
        major: int,
        minor: int,
        patch: int,
        metadata_uri: str = "",
    ) -> dict:
        if self.contract.functions.modelExists(model_commitment).call():
            return {"status": "already_registered", "model_commitment": bytes32_to_hex(model_commitment)}
        fn = self.contract.functions.registerModel(
            model_commitment, model_artifact_hash, dataset_hash,
            major, minor, patch, metadata_uri
        )
        receipt = self._send(fn)
        return {
            "status":           "registered",
            "tx_hash":          receipt.transactionHash.hex(),
            "block_number":     receipt.blockNumber,
            "model_commitment": bytes32_to_hex(model_commitment),
            "artifact_hash":    bytes32_to_hex(model_artifact_hash),
        }

    def activate_model(self, model_commitment: bytes) -> dict:
        if self.contract.functions.modelIsActive(model_commitment).call():
            return {"status": "already_active"}
        receipt = self._send(self.contract.functions.activateModel(model_commitment))
        return {
            "status":       "activated",
            "tx_hash":      receipt.transactionHash.hex(),
            "block_number": receipt.blockNumber,
        }

    # ── Inference ─────────────────────────────────────────────────────────────

    def log_inference(
        self,
        model_commitment: bytes,
        input_hash: bytes,
        output_hash: bytes,
    ) -> dict:
        fn      = self.contract.functions.logInference(model_commitment, input_hash, output_hash)
        receipt = self._send(fn)
        inference_id = None
        try:
            logs = self.contract.events.InferenceLogged().process_receipt(receipt)
            if logs:
                inference_id = bytes32_to_hex(logs[0]["args"]["inferenceId"])
        except Exception as e:
            logger.warning(f"Could not parse InferenceLogged event: {e}")
        return {
            "status":       "logged",
            "inference_id": inference_id,
            "tx_hash":      receipt.transactionHash.hex(),
            "block_number": receipt.blockNumber,
        }

    # ── Batch ─────────────────────────────────────────────────────────────────

    def commit_batch(self, model_commitment: bytes, inference_hashes: list) -> dict:
        if not inference_hashes:
            raise ValueError("commit_batch: empty list")
        batch_root = build_merkle_root(inference_hashes)
        count      = len(inference_hashes)
        fn         = self.contract.functions.commitBatch(model_commitment, batch_root, count)
        receipt    = self._send(fn)
        batch_id   = None
        try:
            logs = self.contract.events.BatchCommitted().process_receipt(receipt)
            if logs:
                batch_id = bytes32_to_hex(logs[0]["args"]["batchId"])
        except Exception as e:
            logger.warning(f"Could not parse BatchCommitted event: {e}")
        return {
            "status":     "committed",
            "batch_id":   batch_id,
            "batch_root": bytes32_to_hex(batch_root),
            "count":      count,
            "tx_hash":    receipt.transactionHash.hex(),
        }

    # ── Lineage ───────────────────────────────────────────────────────────────

    def get_lineage(self, inference_id_hex: str) -> dict:
        raw_id = bytes.fromhex(inference_id_hex.replace("0x", ""))
        inference_raw, model_raw, dataset_raw = (
            self.contract.functions.getLineage(raw_id).call()
        )

        def to_dict(raw, fields):
            record = dict(zip(fields, raw))
            for k, v in record.items():
                if isinstance(v, bytes):
                    record[k] = bytes32_to_hex(v)
            return record

        return {
            "inference": to_dict(inference_raw, [
                "inferenceId", "modelCommitment", "inputHash",
                "outputHash", "timestamp", "calledBy", "exists",
            ]),
            "model": to_dict(model_raw, [
                "modelCommitment", "modelArtifactHash", "datasetHash",
                "version", "timestamp", "metadataURI", "registeredBy", "active", "exists",
            ]),
            "dataset": to_dict(dataset_raw, [
                "datasetHash", "version", "timestamp", "metadataURI",
                "registeredBy", "active", "exists",
            ]),
        }

    # ── Verify ────────────────────────────────────────────────────────────────

    def verify_inference(
        self,
        inference_id_hex: str,
        input_hash_bytes: bytes,
        output_hash_bytes: bytes,
    ) -> dict:
        raw_id = bytes.fromhex(inference_id_hex.replace("0x", ""))

        if not self.contract.functions.inferenceExists(raw_id).call():
            return {"verified": False, "reason": "Inference ID not found on-chain"}

        record          = self.contract.functions.getInference(raw_id).call()
        on_chain_input  = bytes32_to_hex(record[2])
        on_chain_output = bytes32_to_hex(record[3])
        provided_input  = bytes32_to_hex(input_hash_bytes)
        provided_output = bytes32_to_hex(output_hash_bytes)

        if on_chain_input != provided_input:
            return {
                "verified": False,
                "reason":   (
                    f"Input hash mismatch. "
                    f"On-chain: {on_chain_input}, provided: {provided_input}"
                ),
            }
        if on_chain_output != provided_output:
            return {
                "verified": False,
                "reason":   (
                    f"Output hash mismatch. "
                    f"On-chain: {on_chain_output}, provided: {provided_output}"
                ),
            }

        return {
            "verified":     True,
            "reason":       "Input and output hashes match on-chain record",
            "inference_id": inference_id_hex,
            "timestamp":    record[4],
            "called_by":    record[5],
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_client = None

def get_client() -> BioLedgerClient:
    global _client
    if _client is None:
        _client = BioLedgerClient()
    return _client