#!/usr/bin/env python3
"""Rebuild Decord's mis-tagged Linux ctypes wheel as an explicit local version.

No library or Python code is changed. The upstream archive is SHA-256 pinned;
only distribution version, WHEEL tag and RECORD are regenerated. The rebuilt
artifact uses uncompressed ZIP entries with fixed timestamps for reproducibility.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
from pathlib import Path
import urllib.request
import zipfile

UPSTREAM_URL = 'https://files.pythonhosted.org/packages/11/79/936af42edf90a7bd4e41a6cac89c913d4b47fa48a26b042d5129a9242ee3/decord-0.6.0-py3-none-manylinux2010_x86_64.whl'
UPSTREAM_SHA256 = '51997f20be8958e23b7c4061ba45d0efcd86bffd5fe81c695d0befee0d442976'
VERSION = '0.6.0+cue1'
FILENAME = f'decord-{VERSION}-py3-none-manylinux2010_x86_64.whl'


def repack(upstream: bytes) -> bytes:
    old_info = 'decord-0.6.0.dist-info/'
    new_info = f'decord-{VERSION}.dist-info/'
    with zipfile.ZipFile(io.BytesIO(upstream)) as source:
        files = {entry.filename: source.read(entry) for entry in source.infolist() if not entry.is_dir()}
    if any(name.endswith('.so') and name != 'decord/libdecord.so' for name in files):
        raise ValueError('Unexpected native Python extension; refusing to claim an ABI-independent wheel')
    wheel = files[old_info + 'WHEEL'].decode()
    if 'Tag: cp36-cp36m-manylinux2010_x86_64\n' not in wheel:
        raise ValueError('Upstream wheel tag changed; review the packaging repair')
    files[old_info + 'WHEEL'] = wheel.replace('Tag: cp36-cp36m-manylinux2010_x86_64', 'Tag: py3-none-manylinux2010_x86_64').encode()
    metadata = files[old_info + 'METADATA'].decode()
    if '\nVersion: 0.6.0\n' not in metadata:
        raise ValueError('Unexpected upstream version')
    files[old_info + 'METADATA'] = metadata.replace('\nVersion: 0.6.0\n', f'\nVersion: {VERSION}\n').encode()
    del files[old_info + 'RECORD']
    files = {name.replace(old_info, new_info, 1): data for name, data in files.items()}
    record = io.StringIO(newline='')
    writer = csv.writer(record, lineterminator='\n')
    for name, data in sorted(files.items()):
        digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b'=').decode()
        writer.writerow([name, 'sha256=' + digest, len(data)])
    writer.writerow([new_info + 'RECORD', '', ''])
    files[new_info + 'RECORD'] = record.getvalue().encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as target:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o644 << 16
            target.writestr(info, data)
    return output.getvalue()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=Path('app/.cache/runtime-wheels'))
    args = parser.parse_args()
    with urllib.request.urlopen(UPSTREAM_URL, timeout=60) as response:
        upstream = response.read()
    if hashlib.sha256(upstream).hexdigest() != UPSTREAM_SHA256:
        raise ValueError('Upstream artifact SHA-256 mismatch')
    result = repack(upstream)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    destination = args.output_dir / FILENAME
    if destination.exists() and destination.read_bytes() != result:
        raise ValueError('Existing rebuilt wheel differs; inspect before replacing')
    destination.write_bytes(result)
    print(f'{hashlib.sha256(result).hexdigest()}  {destination}')


if __name__ == '__main__':
    main()
