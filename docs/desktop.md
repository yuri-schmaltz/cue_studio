# Cue Studio Desktop

Cue Studio can run as a Tauri desktop application. Rust owns the window and
the lifecycle of exactly one local Python worker; Python/PyTorch remains the
AI engine. The worker binds only to loopback and requires a private token plus
the first-party session cookie before serving the UI or media.

## Development

Use the Rust toolchain selected by `rustup` and run:

```bash
cd ui
npm run desktop:dev
```

The normal web build remains available with `npm run build`. The desktop
bundle stages source code and the compiled UI under `ui/src-tauri/runtime/`
and `ui/src-tauri/web/`; model checkpoints, virtual environments, generated
outputs and user configuration are excluded.

## Runtime installation

On first launch the splash screen can install the Python runtime. It creates
`runtime/env` below the operating-system application-data directory, verifies
the SHA-256 requirements manifest, and installs the pinned `app/requirements.txt`
there. The packaged source tree stays read-only. Existing environments can be
selected with **Choose existing runtime** when a managed environment is
already available.

The desktop host keeps outputs, projects, models, SQLite state and logs in the
same application-data directory. It never downloads checkpoints or starts an
inference job during installation.

## Release verification

```bash
cd ui
npm run desktop:prepare
PATH="$HOME/.cargo/bin:$PATH" cargo test --manifest-path src-tauri/Cargo.toml --no-default-features
python3 ../scripts/desktop-smoke.py
PATH="$HOME/.cargo/bin:$PATH" npm run desktop:build
```

The smoke test uses a private data directory, opens the real Tauri window via
`tauri-driver`, checks the authenticated boundary (`401` without credentials
and `403` for a foreign origin), and verifies that closing the window reaps
the worker. It does not load a model or contact the existing web backend.
