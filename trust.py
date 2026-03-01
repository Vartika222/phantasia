"""
trust.py
Computes a trust score for a face image against the trained centroid.

The ANOMALY_THRESHOLD (cosine distance) is the authoritative gate for
access decisions. The trust_score (0–100) is a human-readable readout
derived from the same distance — they will always agree directionally.

Score interpretation:
  cos_dist 0.00–0.40 → AUTHORIZED  (score 60–100)
  cos_dist 0.40–1.00 → SUSPICIOUS  (score  0–60)
"""

import pickle
from scipy.spatial.distance import cosine
import numpy as np
from embedder import get_embedding
from config import HYPERPARAMETERS, CENTROID_PATH


# Pull threshold from config so it matches what was registered on-chain
ANOMALY_THRESHOLD: float = HYPERPARAMETERS["anomaly_threshold"]  # 0.4


def compute_trust_score(img_path: str) -> dict:
    """
    Compute a trust score for the face in img_path.

    Returns a dict with keys:
      trust_score     float  0–100 (higher = more similar to authorized cluster)
      anomaly         bool   True  if cosine_distance > ANOMALY_THRESHOLD
      cosine_distance float  raw distance from centroid (4 dp)
      status          str    "AUTHORIZED" | "SUSPICIOUS"
      error/reason    str    present only on failure paths
    """
    # ── Load centroid ─────────────────────────────────────────────────────────
    try:
        with open(CENTROID_PATH, "rb") as f:
            centroid = pickle.load(f)
    except FileNotFoundError:
        return {
            "trust_score":     0.0,
            "anomaly":         True,
            "cosine_distance": None,
            "status":          "ERROR",
            "error":           f"centroid.pkl not found at '{CENTROID_PATH}'. Run build_cluster.py first.",
        }

    # ── Embed face ────────────────────────────────────────────────────────────
    embedding = get_embedding(img_path)
    if embedding is None:
        return {
            "trust_score":     0.0,
            "anomaly":         True,
            "cosine_distance": None,
            "status":          "ERROR",
            "reason":          "No face detected in image (or embedding failed).",
        }

    # ── Score ─────────────────────────────────────────────────────────────────
    # cosine() returns distance: 0.0 = identical vectors, 1.0 = orthogonal
    cos_dist    = float(cosine(embedding, centroid))
    trust_score = round(max(0.0, min(100.0, (1.0 - cos_dist) * 100.0)), 2)

    # ANOMALY_THRESHOLD is the authoritative binary gate.
    # trust_score is a derived readout — they are consistent by construction:
    #   threshold=0.4 → trust_score=60 is the crossover point.
    anomaly = cos_dist > ANOMALY_THRESHOLD

    return {
        "trust_score":     trust_score,
        "anomaly":         bool(anomaly),
        "cosine_distance": round(cos_dist, 4),
        "status":          "SUSPICIOUS" if anomaly else "AUTHORIZED",
    }