import io
import zipfile

import pytest
from scripts.build_decord_wheel import repack, VERSION


def upstream(extra=None):
    buffer = io.BytesIO()
    files = {'decord/libdecord.so': b'ctypes native library', 'decord/__init__.py': b'original code',
             'decord-0.6.0.dist-info/WHEEL': b'Wheel-Version: 1.0\nTag: cp36-cp36m-manylinux2010_x86_64\n',
             'decord-0.6.0.dist-info/METADATA': b'Metadata-Version: 2.1\nName: decord\nVersion: 0.6.0\n',
             'decord-0.6.0.dist-info/RECORD': b''}
    files.update(extra or {})
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def test_rebuild_is_deterministic_and_preserves_runtime_bytes():
    source = upstream()
    result = repack(source)
    assert result == repack(source)
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        assert archive.read('decord/libdecord.so') == b'ctypes native library'
        assert archive.read('decord/__init__.py') == b'original code'
        assert b'Tag: py3-none-manylinux2010_x86_64' in archive.read(f'decord-{VERSION}.dist-info/WHEEL')
        assert b'Version: 0.6.0+cue1' in archive.read(f'decord-{VERSION}.dist-info/METADATA')
        assert b'decord/libdecord.so,sha256=' in archive.read(f'decord-{VERSION}.dist-info/RECORD')


def test_native_python_extension_cannot_be_retagged():
    with pytest.raises(ValueError, match='native Python extension'):
        repack(upstream({'decord/binding.cpython-36m-x86_64-linux-gnu.so': b'extension'}))
