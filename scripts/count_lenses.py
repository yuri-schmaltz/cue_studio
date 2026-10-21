"""Count the robot's cyan camera lenses in reference-film frames.

This is a thin CLI over app/services/reference_identity.py, which owns the
metric so the F2 gate and this script can never disagree.

Usage:
    python scripts/count_lenses.py FRAME_OR_CLIP [FRAME_OR_CLIP ...]
"""
from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services.reference_identity import EXPECTED_LENSES, analyse  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    results = []
    for name in argv[1:]:
        path = Path(name)
        if not path.is_file():
            print(f'missing: {path}')
            return 1
        result = analyse(path)
        results.append(result)
        print(f'{path.name}: frames={result["frames"]} '
              f'distribution={result["distribution"]} '
              f'expected({EXPECTED_LENSES})={result["share_with_expected"] * 100:.1f}%')
    print(json.dumps(results, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
