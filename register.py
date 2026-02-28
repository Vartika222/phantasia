"""
register.py — V2
Run once after build_cluster.py and contract deployment.
Captures pip freeze, computes modelCommitment, registers + activates all.

Fix vs original:
  HYPERPARAMETERS now imported from config.py instead of redefined here.
  This guarantees the on-chain commitment matches what build_cluster.py used.
"""

import os
import sys
import json
import argparse
import logging
from pathlib import Path

from web3 import Web3
from dotenv import load_dotenv
from blockchain import (
    get_client,
    keccak256_file,
    bytes32_to_hex,
    build_merkle_root,
    compute_model_commitment,
    capture_environment_snapshot,
)
from config import (
    HYPERPARAMETERS,
    AUTHORIZED_DIR,
    CENTROID_PATH,
    TRAINING_SCRIPT_PATH,
    ENV_SNAPSHOT_PATH,
    HASHES_OUTPUT_PATH,
)

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(message)s")
logger = logging.getLogger(__name__)


def build_dataset_hash(authorized_dir: str) -> bytes:
    image_exts = {".jpg", ".jpeg", ".png", ".bmp"}
    files = sorted([
        os.path.join(authorized_dir, f)
        for f in os.listdir(authorized_dir)
        if Path(f).suffix.lower() in image_exts
    ])
    if not files:
        raise ValueError(f"No images found in {authorized_dir}")

    logger.info(f"  Hashing {len(files)} dataset images...")
    leaves = [keccak256_file(fp) for fp in files]
    for fp, leaf in zip(files, leaves):
        logger.info(f"    {os.path.basename(fp):30s} → {bytes32_to_hex(leaf)[:18]}...")

    root = build_merkle_root(leaves)
    logger.info(f"  Dataset Merkle root: {bytes32_to_hex(root)}")
    return root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-env-snapshot", action="store_true")
    parser.add_argument("--version", default="1.0.0")
    args = parser.parse_args()

    try:
        major, minor, patch = [int(x) for x in args.version.split(".")]
    except ValueError:
        logger.error("--version must be MAJOR.MINOR.PATCH e.g. 1.0.0")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("  BioLedger V2 Registration")
    logger.info("=" * 60)

    client = get_client()
    logger.info(f"  Wallet  : {client.address}")
    logger.info(f"  Version : {major}.{minor}.{patch}")

    # 0. Environment snapshot
    if not args.skip_env_snapshot:
        logger.info("\n[0/4] Capturing environment snapshot...")
        capture_environment_snapshot(ENV_SNAPSHOT_PATH)
    else:
        if not os.path.exists(ENV_SNAPSHOT_PATH):
            logger.error(f"{ENV_SNAPSHOT_PATH} not found. Remove --skip-env-snapshot.")
            sys.exit(1)
        logger.info(f"\n[0/4] Using existing {ENV_SNAPSHOT_PATH}")

    # 1. Register + activate dataset
    logger.info("\n[1/4] Registering dataset...")
    dataset_hash = build_dataset_hash(AUTHORIZED_DIR)

    ds = client.register_dataset(dataset_hash, major, minor, patch)
    logger.info(f"  Status  : {ds['status']}")
    if "tx_hash" in ds:
        logger.info(f"  Tx      : {ds['tx_hash']}")

    logger.info("  Activating dataset...")
    da = client.activate_dataset(dataset_hash)
    logger.info(f"  Status  : {da['status']}")
    if "tx_hash" in da:
        logger.info(f"  Tx      : {da['tx_hash']}")

    # 2. Compute model commitment
    logger.info("\n[2/4] Computing model commitment...")
    model_commitment, model_artifact_hash = compute_model_commitment(
        artifact_path        = CENTROID_PATH,
        training_script_path = TRAINING_SCRIPT_PATH,
        hyperparameters      = HYPERPARAMETERS,
        environment_path     = ENV_SNAPSHOT_PATH,
    )

    # 3. Register + activate model
    logger.info("\n[3/4] Registering model...")
    mr = client.register_model(
        model_commitment    = model_commitment,
        model_artifact_hash = model_artifact_hash,
        dataset_hash        = dataset_hash,
        major=major, minor=minor, patch=patch,
    )
    logger.info(f"  Status  : {mr['status']}")
    if "tx_hash" in mr:
        logger.info(f"  Tx      : {mr['tx_hash']}")

    logger.info("  Activating model...")
    ma = client.activate_model(model_commitment)
    logger.info(f"  Status  : {ma['status']}")
    if "tx_hash" in ma:
        logger.info(f"  Tx      : {ma['tx_hash']}")

    # 4. Save hashes
    logger.info("\n[4/4] Saving registered_hashes.json...")
    output = {
        "version":              f"{major}.{minor}.{patch}",
        "dataset_hash":         bytes32_to_hex(dataset_hash),
        "model_commitment":     bytes32_to_hex(model_commitment),
        "model_artifact_hash":  bytes32_to_hex(model_artifact_hash),
        "hyperparameters":      HYPERPARAMETERS,
        "environment_snapshot": ENV_SNAPSHOT_PATH,
    }
    with open(HASHES_OUTPUT_PATH, "w") as f:
        json.dump(output, f, indent=2)

    logger.info(f"  Saved → {HASHES_OUTPUT_PATH}")
    logger.info("\n" + "=" * 60)
    logger.info("  Done. Run app.py now.")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()