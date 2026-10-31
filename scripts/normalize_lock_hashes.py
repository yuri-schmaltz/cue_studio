#!/usr/bin/env python3
"""Keep SHA-256 hashes from uv output; reject dependencies without them.

Some nightly indexes advertise both MD5 and SHA-256. The runtime lock
auditor deliberately accepts only SHA-256. Removing the weaker hashes
does not change pins or the set of artifacts authenticated by SHA-256.
"""
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.lockfile import parse_requirements


def normalize_hashes(text: str) -> str:
    normalized = re.sub(
        r"(?m)^[ \t]+--hash=md5:[0-9a-fA-F]{32}[ \t]*(?:\\)?[ \t]*\n", "", text,
    )
    requirements = parse_requirements(normalized)
    if not requirements or any(not req.hashes for req in requirements):
        raise ValueError("Every locked requirement must retain a SHA-256 hash")
    return normalized


if __name__ == '__main__':
    path = Path(sys.argv[1])
    normalized = normalize_hashes(path.read_text())
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(normalized)
    temporary.replace(path)
