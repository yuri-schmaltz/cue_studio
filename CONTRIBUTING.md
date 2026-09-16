# Contributing to Maestro

Thanks for your interest in improving Maestro! This is a local-first AI
video/image/music studio built on the [Wan2GP](https://github.com/deepbeepmeep/Wan2GP)
pipeline and distributed as a standalone Python application.

## Getting set up

Maestro is a standalone (fork) release, so the easiest dev loop is:

1. Follow [Install in README.md](README.md#install) from the repository root.
   It includes the pinned PyTorch CUDA runtime and the UI build.
2. Edit the source in place. The layout:
   - **Launcher scripts** (`start.sh`, `stop.sh`) live at the repo
     root.
   - **Backend** — `app/`: FastAPI endpoints in `app/launch.py`, the generation
     pipeline in `app/wgp.py`, and services (LLM, Director, recipes, etc.) in
     `app/services/`.
   - **Frontend** — `ui/`: a React + TypeScript + Tailwind app; global state in
     `ui/src/stores/useStore.ts`.
3. Start the backend (auto-builds the UI on first run if needed):
   ```bash
   ./start.sh
   ```
4. After changing the UI, rebuild it:
   ```
   cd ui
   npm install
   npm run build
   ```
   `start.sh` rebuilds automatically when `ui/dist/` is missing.

## Before you open a PR

Run these checks locally from the repository root:

```bash
# 1. UI type-check + build
(cd ui && npm run build && npm run test:control)

# 2. Python syntax on the modules you touched
python -m compileall -q app/launch.py app/wgp.py app/services

# 3. Standalone launch integration (isolated HTTP backend, no models)
python3 tests/test_standalone_launch.py
```

### Local data hygiene

A handful of artifacts are **locally generated or machine-specific** and must
never get committed — downloaded weights, CivitAI metadata sidecars, per-LoRA
generated guides, per-checkpoint finetune JSONs, the `app/env/` venv, the
`ui/node_modules/` tree, the `ui/dist/` build, and runtime logs under `logs/`.
These are all gitignored by design. If a build artifact or a venv file ever
shows up in `git status`, fix the leak (usually a path that should be
gitignored got `git add`-ed).

## Conventions

- **Match the surrounding code.** Follow the naming, structure, and comment
  style already in the file you're editing.
- **Keep the app local-first.** No telemetry, no phone-home, no required
  accounts. External API providers (OpenAI/Anthropic/etc.) stay strictly
  opt-in and off by default.
- **Third-party components keep their own licenses.** Notably the GPL-3.0
  seed-vc voice component is fetched from its own repository at install time
  (see the README license section) rather than vendored here — don't commit it
  back into `app/postprocessing/seedvc/`.

## Reporting bugs

Please use the **Bug report** issue template — it asks for backend logs
(typically the tail of `app/.launcher.log`) and GPU/VRAM/OS, which is almost
always what's needed to reproduce a local-generation issue.

## License

Maestro is released under the WanGP Non-Commercial Evaluation License (inherited
from upstream Wan2GP). By contributing you agree your contributions are licensed
under the same terms. See [LICENSE](LICENSE).
