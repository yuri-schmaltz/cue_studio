"""Import local workspace settings while referencing existing media and models."""
from pathlib import Path
import argparse
import json
import os
import tempfile
from datetime import datetime, timezone


def import_workspace(source: Path, data: Path) -> dict:
    source, data = source.resolve(), data.resolve()
    if (source / 'app/wgp_config.json').is_file():
        source = source / 'app'
    candidates = (source / 'config/wgp_config.json', source / 'wgp_config.json')
    config_path = next((path for path in candidates if path.is_file()), None)
    if config_path is None:
        raise ValueError('Select a workspace containing wgp_config.json or config/wgp_config.json')
    imported = json.loads(config_path.read_text())
    if not isinstance(imported, dict):
        raise ValueError('Workspace configuration must be a JSON object')
    # Convert paths relative to the legacy application's working directory.
    def absolute(value):
        if not isinstance(value, str) or not value.strip():
            raise ValueError('Workspace paths must be non-empty strings')
        return str((source / value).resolve())
    for key in ('save_path', 'image_save_path', 'audio_save_path', 'loras_root'):
        if imported.get(key):
            imported[key] = absolute(imported[key])
    if 'checkpoints_paths' in imported:
        if not isinstance(imported['checkpoints_paths'], list):
            raise ValueError('checkpoints_paths must be a list')
        imported['checkpoints_paths'] = [absolute(path) for path in imported['checkpoints_paths']]
    elif (source / 'ckpts').is_dir():
        imported['checkpoints_paths'] = [str(source / 'ckpts')]
    services = imported.setdefault('services', {})
    if not isinstance(services, dict):
        raise ValueError('services must be a JSON object')
    if services.get('projects_root_path'):
        services['projects_root_path'] = absolute(services['projects_root_path'])
    elif (source / 'projects').is_dir():
        services['projects_root_path'] = str(source / 'projects')
    target = data / 'config/wgp_config.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    current = json.loads(target.read_text()) if target.is_file() else {}
    merged = {**current, **imported}
    merged['services'] = {**current.get('services', {}), **services}
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%f')
    backup = target.with_name(f'wgp_config.before-import-{stamp}.json')
    if target.exists():
        with backup.open('x') as handle:
            handle.write(target.read_text())
    with tempfile.NamedTemporaryFile(mode='w', dir=target.parent, delete=False) as handle:
        json.dump(merged, handle, indent=2)
        temporary = Path(handle.name)
    os.replace(temporary, target)
    report = {'source': str(source), 'config': str(target), 'backup': str(backup) if backup.exists() else None,
              'projectsRoot': services.get('projects_root_path'), 'modelPaths': imported.get('checkpoints_paths', []),
              'mode': 'reference existing files; configuration copied; no model or media files moved'}
    (data / f'workspace-import-{stamp}.json').write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--data', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(import_workspace(args.source, args.data)))
