"""
build_cluster.py
Trains the authorized-face cluster and saves centroid.pkl.

Run BEFORE register.py.

Fixes applied vs original:
  1. Files are now sorted — reproducible Merkle roots in register.py.
  2. DBSCAN fallback removed — silent degradation was a security hole.
     If no cluster found, script fails loudly instead of using noise points.
  3. Hyperparameters imported from config.py (single source of truth).
     Changing them here is impossible without changing them everywhere.
  4. Image extension set now includes .bmp to match register.py.
"""

import os
import sys
import numpy as np
import pickle
from pathlib import Path
from sklearn.cluster import DBSCAN
from embedder import get_embedding
from config import HYPERPARAMETERS, AUTHORIZED_DIR, CENTROID_PATH


def build_cluster() -> bool:
    print("=" * 50)
    print("  BioLedger — build_cluster.py")
    print("=" * 50)

    image_exts = {".jpg", ".jpeg", ".png", ".bmp"}

    # FIX 1: sorted() — deterministic order required for reproducible Merkle root
    files = sorted([
        f for f in os.listdir(AUTHORIZED_DIR)
        if Path(f).suffix.lower() in image_exts
    ])

    if not files:
        print(f"ERROR: No images found in {AUTHORIZED_DIR}")
        return False

    print(f"Found {len(files)} images in {AUTHORIZED_DIR}")

    embeddings = []
    failed     = []

    for filename in files:
        full_path = os.path.join(AUTHORIZED_DIR, filename)
        print(f"  Processing: {filename}")
        emb = get_embedding(full_path)
        if emb is not None:
            embeddings.append(emb)
        else:
            failed.append(filename)
            print(f"  WARNING: No embedding for {filename} — skipping")

    print(f"\nSuccessfully embedded : {len(embeddings)} faces")
    if failed:
        print(f"Failed / skipped      : {failed}")

    if len(embeddings) < 3:
        print("ERROR: Need at least 3 valid face embeddings to build a reliable cluster.")
        return False

    embeddings_arr = np.array(embeddings)

    # Use hyperparameters from config — never hardcoded
    clustering = DBSCAN(
        eps        = HYPERPARAMETERS["dbscan_eps"],
        min_samples= HYPERPARAMETERS["dbscan_min_samples"],
    ).fit(embeddings_arr)

    labels     = clustering.labels_
    unique     = set(labels)
    print(f"DBSCAN labels found   : {unique}")

    # FIX 2: No silent fallback. If DBSCAN finds no cluster (all noise = -1),
    # raise instead of using noise points. This prevents a poisoned centroid.
    main_mask    = labels == 0
    main_cluster = embeddings_arr[main_mask]

    if len(main_cluster) == 0:
        print(
            "ERROR: DBSCAN found no valid cluster (all points classified as noise).\n"
            "  → Check dataset quality, lighting consistency, or adjust eps/min_samples in config.py.\n"
            "  → Current eps={eps}, min_samples={ms}".format(
                eps=HYPERPARAMETERS["dbscan_eps"],
                ms =HYPERPARAMETERS["dbscan_min_samples"],
            )
        )
        return False

    print(f"Main cluster size     : {len(main_cluster)} faces")

    if len(unique) > 1 and -1 in unique:
        noise_count = list(labels).count(-1)
        print(f"WARNING: {noise_count} image(s) marked as noise by DBSCAN — excluded from centroid.")

    centroid = np.mean(main_cluster, axis=0)

    with open(CENTROID_PATH, "wb") as f:
        pickle.dump(centroid, f)

    print(f"\nSUCCESS: centroid.pkl saved ({CENTROID_PATH})")
    print(f"  Centroid shape: {centroid.shape}")
    return True


if __name__ == "__main__":
    ok = build_cluster()
    sys.exit(0 if ok else 1)