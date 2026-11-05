"""Versioned runtime libraries must remain loadable after archive flattening."""
import ast
from pathlib import Path


def repair():
    source = Path(__file__).resolve().parents[1] / 'app/services/llm_service.py'
    tree = ast.parse(source.read_text())
    node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == '_repair_linux_library_links')
    scope = {}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), scope)
    return scope['_repair_linux_library_links']


def test_restores_soname_and_unversioned_aliases_idempotently(tmp_path):
    library = tmp_path / 'libllama-common.so.0.9.0'
    library.write_bytes(b'fixture')
    repair()(str(tmp_path))
    repair()(str(tmp_path))
    assert (tmp_path / 'libllama-common.so.0').read_bytes() == b'fixture'
    assert (tmp_path / 'libllama-common.so').readlink() == Path(library.name)


def test_preserves_existing_aliases_and_skips_ambiguous_versions(tmp_path):
    (tmp_path / 'libllama.so.0.9.0').write_bytes(b'new')
    (tmp_path / 'libllama.so.0').write_bytes(b'existing')
    (tmp_path / 'libggml.so.0.1.0').write_bytes(b'one')
    (tmp_path / 'libggml.so.0.2.0').write_bytes(b'two')
    repair()(str(tmp_path))
    assert (tmp_path / 'libllama.so.0').read_bytes() == b'existing'
    assert not (tmp_path / 'libggml.so.0').exists()
