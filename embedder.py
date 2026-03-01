"""
embedder.py
Wraps DeepFace ArcFace embedding. Returns None on failure — callers
must handle None explicitly; do NOT silently use it as a valid embedding.
"""

from deepface import DeepFace
import numpy as np
from config import HYPERPARAMETERS


def get_embedding(img_path: str) -> np.ndarray | None:
    """
    Return a 512-dim ArcFace embedding for the face in img_path.
    Returns None if DeepFace raises or returns an empty result.

    NOTE: enforce_detection=False means non-face images will still
    return an embedding. Acceptable for dev; set True in production
    and handle the resulting exception at the call site.
    """
    try:
        result = DeepFace.represent(
            img_path        = img_path,
            model_name      = HYPERPARAMETERS["embedding_model"],   # "ArcFace"
            detector_backend= HYPERPARAMETERS["deepface_backend"],  # "opencv"
            enforce_detection=HYPERPARAMETERS["enforce_detection"], # False
        )
        if not result:
            return None
        return np.array(result[0]["embedding"])
    except Exception as e:
        print(f"  [embedder] ERROR for {img_path}: {e}")
        return None