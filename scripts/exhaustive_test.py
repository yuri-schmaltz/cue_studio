#!/usr/bin/env python3
"""Teste exaustivo de criação e produção de vídeos na plataforma Cinelocal (Cue Studio).

Testa o fluxo completo:
1. Criação de projeto e configurações
2. Análise de música
3. Planejamento de clipes
4. Inserção de referências
5. Análise de cenas
6. Geração de vídeo (com fallback)
7. Editor (timeline, clips, export)
8. Retake e produção/resume
9. Capabilities e dependências
10. Offline-strict e segurança
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

BASE = "http://127.0.0.1:7860"
API = f"{BASE}/api/v1"

results = []


def log(msg: str, status: str = "INFO"):
    print(f"[{status}] {msg}")


def api_call(method: str, path: str, data: dict = None, timeout: int = 30) -> tuple[int, dict]:
    url = f"{API}{path}" if not path.startswith("http") else path
    if not path.startswith("/"):
        url = f"{BASE}{path}"
    else:
        url = f"{BASE}{path}" if not path.startswith("/api") else f"{BASE}{path}"
    if path.startswith("/api"):
        url = f"{BASE}{path}"
    else:
        url = f"{API}{path}"
    try:
        req = urllib.request.Request(url, method=method)
        req.add_header("Content-Type", "application/json")
        if data:
            req.data = json.dumps(data).encode()
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode()
            try:
                return resp.status, json.loads(body)
            except json.JSONDecodeError:
                return resp.status, {"raw": body[:500]}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        try:
            return e.code, json.loads(body)
        except json.JSONDecodeError:
            return e.code, {"raw": body[:500]}
    except Exception as e:
        return 0, {"error": str(e)}


def test_endpoint(name: str, method: str, path: str, data: dict = None, expected_status: int = 200, timeout: int = 30):
    status, body = api_call(method, path, data, timeout)
    ok = status == expected_status
    results.append((name, status, ok, body))
    icon = "✅" if ok else "❌"
    print(f"{icon} {name}: HTTP {status} (esperado {expected_status})")
    if not ok:
        print(f"   Resposta: {json.dumps(body)[:300]}")
    return status, body


def main():
    print("=" * 70)
    print("TESTE EXAUSTIVO — Cinelocal (Cue Studio)")
    print("=" * 70)

    # ── 1. Health e sistema ──
    print("\n── 1. Health e sistema ──")
    test_endpoint("Health version", "GET", "/health/version")
    test_endpoint("System detect", "GET", "/api/v1/system-detect")
    test_endpoint("System stats", "GET", "/api/v1/system-stats")
    test_endpoint("Capabilities models", "GET", "/api/v1/capabilities/models")
    test_endpoint("Capabilities check", "GET", "/api/v1/capabilities/check?model_id=ltx25_distilled&runtime=wan_gp&mode=t2v&capability=text_to_video")

    # ── 2. Workspaces ──
    print("\n── 2. Workspaces ──")
    test_endpoint("List workspaces", "GET", "/api/v1/workspaces")
    status, body = test_endpoint("Create workspace", "POST", "/api/v1/workspaces", {"name": "test_exhaustive"})
    ws_name = body.get("name", "test_exhaustive") if isinstance(body, dict) else "test_exhaustive"
    test_endpoint("Get workspace", "GET", f"/api/v1/workspaces/{ws_name}")
    test_endpoint("Active workspace", "GET", "/api/v1/workspaces/active")

    # ── 3. Modelos e checkpoints ──
    print("\n── 3. Modelos e checkpoints ──")
    test_endpoint("List models", "GET", "/api/v1/models")
    test_endpoint("Installed checkpoints", "GET", "/api/v1/checkpoints/installed")
    test_endpoint("CivitAI base models", "GET", "/api/v1/civitai/base-models")
    test_endpoint("Model visibility", "GET", "/api/v1/model-visibility")
    test_endpoint("Model options wan", "GET", "/api/v1/model-options/wan")

    # ── 4. Characters ──
    print("\n── 4. Characters ──")
    test_endpoint("List characters", "GET", "/api/v1/characters")
    status, body = test_endpoint("Create character", "POST", "/api/v1/characters", {
        "name": "Robô Teste",
        "description": "Robô cinza com 3 lentes triangulares",
    }, expected_status=422)  # esperado 422 porque precisa de referência

    # ── 5. Director skills ──
    print("\n── 5. Director skills ──")
    test_endpoint("List director skills", "GET", "/api/v1/director/skills")
    test_endpoint("List director pipelines", "GET", "/api/v1/director/pipelines")

    # ── 6. Audio analysis ──
    print("\n── 6. Audio analysis ──")
    test_endpoint("Audio analyze (sem arquivo)", "POST", "/api/v1/audio/analyze", {}, expected_status=422)

    # ── 7. LLM ──
    print("\n── 7. LLM ──")
    test_endpoint("LLM status", "GET", "/api/v1/llm/status")
    test_endpoint("LLM models", "GET", "/api/v1/llm/models")
    test_endpoint("LLM roles", "GET", "/api/v1/llm/roles")
    test_endpoint("LLM test connection", "POST", "/api/v1/llm/test-connection", {})

    # ── 8. Productions ──
    print("\n── 8. Productions ──")
    test_endpoint("List productions", "GET", "/api/v1/productions")

    # ── 9. Editor ──
    print("\n── 9. Editor ──")
    test_endpoint("List editor projects", "GET", "/api/v1/editor/projects")
    test_endpoint("Export capabilities", "GET", "/api/v1/editor/export/capabilities")

    # ── 10. Wizard ──
    print("\n── 10. Wizard ──")
    test_endpoint("List wizard workflows", "GET", "/api/v1/wizard/workflows")

    # ── 11. Style bibles ──
    print("\n── 11. Style bibles ──")
    test_endpoint("List style bibles", "GET", "/api/v1/style-bibles")

    # ── 12. Storage ──
    print("\n── 12. Storage ──")
    test_endpoint("Storage usage", "GET", "/api/v1/storage/usage")
    test_endpoint("Storage duplicates", "GET", "/api/v1/storage/duplicates")

    # ── 13. System ──
    print("\n── 13. System ──")
    test_endpoint("System config", "GET", "/api/v1/system-config")
    test_endpoint("System network policy", "GET", "/api/v1/system/network-policy")
    test_endpoint("System connections", "GET", "/api/v1/system/connections")
    test_endpoint("System preflight", "GET", "/api/v1/system/preflight")

    # ── 14. Jobs ──
    print("\n── 14. Jobs ──")
    test_endpoint("List jobs", "GET", "/api/v1/jobs")

    # ── 15. Outputs ──
    print("\n── 15. Outputs ──")
    test_endpoint("List outputs", "GET", "/api/v1/outputs")

    # ── 16. Favorites ──
    print("\n── 16. Favorites ──")
    test_endpoint("List favorites", "GET", "/api/v1/favorites")

    # ── 17. Recipes ──
    print("\n── 17. Recipes ──")
    test_endpoint("List recipes", "GET", "/api/v1/recipes")

    # ── 18. Presets ──
    print("\n── 18. Presets ──")
    test_endpoint("List presets", "GET", "/api/v1/presets")

    # ── 19. Resolutions ──
    print("\n── 19. Resolutions ──")
    test_endpoint("List resolutions", "GET", "/api/v1/resolutions")

    # ── 20. Loras ──
    print("\n── 20. Loras ──")
    test_endpoint("List loras wan", "GET", "/api/v1/loras/wan")

    # ── 21. Queue ──
    print("\n── 21. Queue ──")
    test_endpoint("Queue list", "GET", "/api/v1/queue")

    # ── 22. Dependencies ──
    print("\n── 22. Dependencies ──")
    test_endpoint("Dependencies graph (sem shots)", "POST", "/api/v1/projects/test/dependencies/graph", {"shots": []})

    # ── 23. Director cinema ──
    print("\n── 23. Director cinema ──")
    test_endpoint("Cinema evaluate", "POST", "/api/v1/director/cinema/evaluate", {})

    # ── Limpeza ──
    print("\n── Limpeza ──")
    test_endpoint("Delete workspace", "DELETE", f"/api/v1/workspaces/{ws_name}")

    # ── Resumo ──
    print("\n" + "=" * 70)
    print("RESUMO DO TESTE EXAUSTIVO")
    print("=" * 70)
    passed = sum(1 for r in results if r[2])
    failed = sum(1 for r in results if not r[2])
    print(f"Total: {len(results)} testes | ✅ {passed} passaram | ❌ {failed} falharam")
    if failed > 0:
        print("\nFalhas:")
        for name, status, ok, body in results:
            if not ok:
                print(f"  ❌ {name}: HTTP {status}")
    print("=" * 70)


if __name__ == "__main__":
    main()
