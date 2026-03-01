"""
test.py
Manual test runner for the AI pipeline (build_cluster → trust).

Runs compute_trust_score against all images in authorized/, unknown/,
and poison/ folders and prints a results table.

Usage:
    python test.py
    python test.py --verbose

Fixes vs original:
  1. Imports compute_trust_score from trust (not ai_module.analyze_image,
     which never existed).
  2. os.listdir replaced with sorted() — deterministic output.
  3. [:3] slice removed — all authorized images are tested.
  4. Structured tabular output with per-folder pass/fail summary.
  5. Folder-not-found is a warning, not a crash.
"""

import os
import sys
import argparse
from pathlib import Path
from trust import compute_trust_score

DATASETS = {
    "AUTHORIZED": "dataset/authorized",
    "UNKNOWN":    "dataset/unknown",
    "POISON":     "dataset/poison",
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp"}

COL_FILE   = 32
COL_STATUS = 12
COL_SCORE  =  8
COL_DIST   =  8


def run_tests(verbose: bool = False) -> int:
    """Run all tests. Returns number of unexpected results."""
    total_unexpected = 0

    for label, folder in DATASETS.items():
        print()
        print("=" * 68)
        print(f"  {label}  ({folder})")
        print("=" * 68)
        print(f"  {'FILE':<{COL_FILE}} {'STATUS':<{COL_STATUS}} {'SCORE':>{COL_SCORE}} {'DIST':>{COL_DIST}}")
        print("  " + "-" * 64)

        if not os.path.isdir(folder):
            print(f"  [SKIP] Folder not found: {folder}")
            continue

        files = sorted(
            f for f in os.listdir(folder)
            if Path(f).suffix.lower() in IMAGE_EXTS
        )

        if not files:
            print(f"  [SKIP] No images found in {folder}")
            continue

        folder_unexpected = 0

        for filename in files:
            path   = os.path.join(folder, filename)
            result = compute_trust_score(path)

            status = result.get("status", "ERROR")
            score  = result.get("trust_score")
            dist   = result.get("cosine_distance")

            score_str = f"{score:.2f}" if score is not None else "N/A"
            dist_str  = f"{dist:.4f}" if dist  is not None else "N/A"

            # Flag unexpected results: authorized should pass, others should be suspicious
            unexpected = ""
            if label == "AUTHORIZED" and result.get("anomaly", True):
                unexpected = " ← FAIL"
                folder_unexpected += 1
            elif label in ("UNKNOWN", "POISON") and not result.get("anomaly", False):
                unexpected = " ← UNEXPECTED PASS"
                folder_unexpected += 1

            print(
                f"  {filename:<{COL_FILE}} "
                f"{status:<{COL_STATUS}} "
                f"{score_str:>{COL_SCORE}} "
                f"{dist_str:>{COL_DIST}}"
                f"{unexpected}"
            )

            if verbose and "error" in result:
                print(f"    error: {result['error']}")
            if verbose and "reason" in result:
                print(f"    reason: {result['reason']}")

        total_unexpected += folder_unexpected
        if folder_unexpected:
            print(f"\n  ⚠  {folder_unexpected} unexpected result(s) in {label}")
        else:
            print(f"\n  ✓  All {len(files)} result(s) as expected in {label}")

    print()
    print("=" * 68)
    if total_unexpected:
        print(f"  DONE — {total_unexpected} unexpected result(s) across all folders")
    else:
        print("  DONE — All results as expected")
    print("=" * 68)
    print()

    return total_unexpected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="BioLedger pipeline test runner")
    parser.add_argument("--verbose", "-v", action="store_true", help="Print error details")
    args = parser.parse_args()

    unexpected = run_tests(verbose=args.verbose)
    sys.exit(1 if unexpected else 0)