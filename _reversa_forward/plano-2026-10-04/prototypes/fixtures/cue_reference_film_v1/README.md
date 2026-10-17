# Fixture canônica "A luz da oficina" (mode F0)

Esta é a fixture autoral definida no `PLANO_EXECUTIVO_CUE_STUDIO.md` seção 6.
Aqui ela está materializada em arquivos estáticos (`project.json`, `shots.json`,
`continuity.json`, `speech.json`, `sound_cues.json`, `expected.json`) que o
renderizador F0 consome.

## Modo F0

Geração determinística por software, sem modelos IA. Adequado para CI, duração,
mix, export e falhas determinísticas. **Não comprova qualidade de IA** —
`acceptance.mode: F0` em `project.json`.

## Como renderizar

```bash
source .f0_venv/bin/activate
python3 _reversa_forward/plano-2026-10-04/prototypes/f0_render_luz_da_oficina.py
```

Saída em `out/luz_da_oficina/master.mp4` + stems `.wav` + relatório JSON
com critérios de aceite.

## Política Reversa

Esta fixture e seu renderizador vivem em `_reversa_forward/plano-2026-10-04/`,
respeitando `.reversa/reversa-config.json` (`allowLegacyEdits: false`).
Nenhum arquivo em `app/`, `ui/`, `tests/`, `scripts/` ou `docs/` foi tocado.
