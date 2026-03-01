"""
config.py
Single source of truth for all hyperparameters used in build_cluster.py
and registered on-chain by register.py.

IMPORTANT: Any change here = new modelCommitment = re-registration required.
"""

HYPERPARAMETERS = {
    "dbscan_eps":         10.0,
    "dbscan_min_samples": 2,
    "anomaly_threshold":  0.4,
    "embedding_model":    "ArcFace",
    "deepface_backend":   "opencv",
    "enforce_detection":  False,
}

# Paths shared across scripts
AUTHORIZED_DIR       = "dataset/authorized"
CENTROID_PATH        = "centroid.pkl"
TRAINING_SCRIPT_PATH = "build_cluster.py"
ENV_SNAPSHOT_PATH    = "environment_snapshot.txt"
HASHES_OUTPUT_PATH   = "registered_hashes.json"