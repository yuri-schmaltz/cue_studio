#!/usr/bin/env python3
"""Teste exaustivo com dados reais do usuário.

Usa arquivos reais de /home/yuri/Google/midias e /home/yuri/Google/documentos.
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

# Dados reais do usuário
ROTEIRO = Path("/home/yuri/Google/documentos/04-biblioteca/roteiros-autorais/noir cyberpunk/roteiro_noir_cyberpunk.md")
MUSICA = Path("/home/yuri/Google/midias/audios/musicas/flight_of_the_silverbird.ogg")
IMAGENS_DIR = Path("/home/yuri/Google/midias/imagens/robos")
VOZ = Path("/home/yuri/Google/midias/audios/vozes/yuri.ogg")
VIDEO_REF = Path("/home/yuri/Google/midias/videos/my eyes")

results = []


def log(msg, status="INFO"):
    print(f"[{status}] {msg}")


def api_call(method, path, data=None, timeout=60, files=None):
    url = f"{BASE}{path}" if path.startswith("/") else f"{API}{path}"
    if path.startswith("/api"):
        url = f"{BASE}{path}"
    elif not path.startswith("/"):
        url = f"{API}{path}"
    else:
        url = f"{BASE}{path}"
    try:
        if files:
            # multipart form data
            import mimetypes
            boundary = "----WebKitFormBoundary7MA4YWxkTrZu0gW"
            body = b""
            for key, (filename, content, content_type) in files.items():
                body += f"--{boundary}\r\n".encode()
                body += f'Content-Disposition: form-data; name="{key}"; filename="{filename}"\r\n'.encode()
                body += f"Content-Type: {content_type}\r\n\r\n".encode()
                body += content + b"\r\n"
            if data:
                for key, val in data.items():
                    body += f"--{boundary}\r\n".encode()
                    body += f'Content-Disposition: form-data; name="{key}"\r\n\r\n'.encode()
                    body += f"{val}\r\n".encode()
            body += f"--{boundary}--\r\n".encode()
            req = urllib.request.Request(url, data=body, method=method)
            req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        else:
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


def test(name, method, path, data=None, expected=200, timeout=60, files=None):
    status, body = api_call(method, path, data, timeout, files)
    ok = status == expected
    results.append((name, status, ok))
    icon = "✅" if ok else "❌"
    print(f"{icon} {name}: HTTP {status}")
    if not ok:
        print(f"   {json.dumps(body)[:200]}")
    return status, body


def main():
    print("=" * 70)
    print("TESTE EXAUSTIVO COM DADOS REAIS")
    print("=" * 70)
    print(f"Roteiro: {ROTEIRO}")
    print(f"Música: {MUSICA}")
    print(f"Imagens: {IMAGENS_DIR}")
    print(f"Voz: {VOZ}")

    # ── 1. Health ──
    print("\n── 1. Health ──")
    test("Health", "GET", "/health/version")

    # ── 2. Upload de roteiro ──
    print("\n── 2. Upload de roteiro ──")
    if ROTEIRO.exists():
        content = ROTEIRO.read_bytes()
        status, body = test("Upload roteiro", "POST", "/api/v1/director/script/read",
                            files={"file": (ROTEIRO.name, content, "text/markdown")})
        if status == 200:
            print(f"   Texto extraído: {len(body.get('text',''))} chars")
            print(f"   Truncado: {body.get('truncated', False)}")
    else:
        print(f"   Roteiro não encontrado: {ROTEIRO}")

    # ── 3. Upload de música ──
    print("\n── 3. Upload de música ──")
    if MUSICA.exists():
        content = MUSICA.read_bytes()
        status, body = test("Upload música", "POST", "/api/v1/upload-audio",
                            files={"file": (MUSICA.name, content, "audio/ogg")})
        if status == 200:
            print(f"   Upload OK: {body}")
            audio_name = body.get("filename", MUSICA.name)
        else:
            audio_name = MUSICA.name
    else:
        print(f"   Música não encontrada: {MUSICA}")
        audio_name = None

    # ── 4. Análise de áudio ──
    print("\n── 4. Análise de áudio ──")
    if audio_name:
        status, body = test("Analyze audio", "POST", "/api/v1/audio/analyze", {"filename": audio_name})
        if status == 200:
            print(f"   Análise: {json.dumps(body)[:300]}")

    # ── 5. Planejamento de estrutura ──
    print("\n── 5. Planejamento de estrutura ──")
    if audio_name:
        status, body = test("Plan structure", "POST", "/api/v1/audio/plan-structure", {"filename": audio_name})
        if status == 200:
            print(f"   Estrutura: {json.dumps(body)[:300]}")

    # ── 6. Sugestão de clipes ──
    print("\n── 6. Sugestão de clipes ──")
    if audio_name:
        status, body = test("Suggest clips", "POST", "/api/v1/audio/suggest-clips", {"filename": audio_name})
        if status == 200:
            print(f"   Clipes sugeridos: {json.dumps(body)[:300]}")

    # ── 7. Classificação de seções ──
    print("\n── 7. Classificação de seções ──")
    if audio_name:
        status, body = test("Classify sections", "POST", "/api/v1/director/classify-sections", {"filename": audio_name})
        if status == 200:
            print(f"   Seções: {json.dumps(body)[:300]}")

    # ── 8. Upload de imagens de referência ──
    print("\n── 8. Upload de imagens de referência ──")
    imgs = list(IMAGENS_DIR.glob("*.jpg"))[:3] + list(IMAGENS_DIR.glob("*.png"))[:2]
    uploaded_imgs = []
    for img in imgs:
        content = img.read_bytes()
        ct = "image/jpeg" if img.suffix.lower() in (".jpg", ".jpeg") else "image/png"
        status, body = test(f"Upload imagem {img.name}", "POST", "/api/v1/upload",
                            files={"file": (img.name, content, ct)})
        if status == 200:
            uploaded_imgs.append(body.get("filename", img.name))
            print(f"   Upload OK: {img.name}")

    # ── 9. Criação de personagem com referência ──
    print("\n── 9. Criação de personagem ──")
    if uploaded_imgs:
        status, body = test("Create character", "POST", "/api/v1/characters", {
            "name": "Robô Referência",
            "description": "Robô cinza com 3 lentes triangulares",
        })
        print(f"   Character: {json.dumps(body)[:200]}")

    # ── 10. Director skills ──
    print("\n── 10. Director skills ──")
    status, body = test("Director skills", "GET", "/api/v1/director/skills")
    if status == 200:
        print(f"   Skills: {json.dumps(body)[:300]}")

    # ── 11. Planejamento de short film ──
    print("\n── 11. Planejamento de short film ──")
    if ROTEIRO.exists():
        roteiro_text = ROTEIRO.read_text(encoding="utf-8")[:5000]
        status, body = test("Plan short film script", "POST", "/api/v1/director/plan-short-film-script", {
            "story_description": roteiro_text,
        }, timeout=120)
        if status == 200:
            print(f"   Plano: {json.dumps(body)[:300]}")

    # ── 12. Geração de vídeo (Studio) ──
    print("\n── 12. Geração de vídeo (Studio) ──")
    status, body = test("Generate video", "POST", "/api/v1/generate", {
        "model_type": "wan",
        "prompt": "um robô cinza com 3 lentes triangulares em uma oficina",
        "width": 512,
        "height": 512,
        "num_frames": 16,
    }, timeout=60)
    if status in (200, 202):
        print(f"   Geração: {json.dumps(body)[:300]}")

    # ── 13. Editor ──
    print("\n── 13. Editor ──")
    test("Editor projects", "GET", "/api/v1/editor/projects")
    test("Export capabilities", "GET", "/api/v1/editor/export/capabilities")

    # ── 14. Style bibles ──
    print("\n── 14. Style bibles ──")
    test("Style bibles", "GET", "/api/v1/style-bibles")

    # ── 15. Models ──
    print("\n── 15. Models ──")
    test("Models list", "GET", "/api/v1/models")
    test("Installed checkpoints", "GET", "/api/v1/checkpoints/installed")

    # ── 16. LLM ──
    print("\n── 16. LLM ──")
    test("LLM status", "GET", "/api/v1/llm/status")
    test("LLM models", "GET", "/api/v1/llm/models")

    # ── 17. Productions ──
    print("\n── 17. Productions ──")
    test("Productions list", "GET", "/api/v1/productions")

    # ── 18. Capabilities ──
    print("\n── 18. Capabilities ──")
    test("Capabilities models", "GET", "/api/v1/capabilities/models")
    test("Capabilities check", "GET", "/api/v1/capabilities/check?model_id=flux_2_klein_9b&runtime=diffusers&mode=t2i&capability=text_to_image")

    # ── 19. Dependencies ──
    print("\n── 19. Dependencies ──")
    test("Dependencies graph", "POST", "/api/v1/projects/test_real/dependencies/graph", {"shots": []})

    # ── 20. Outputs ──
    print("\n── 20. Outputs ──")
    test("Outputs list", "GET", "/api/v1/outputs")

    # ── 21. Queue ──
    print("\n── 21. Queue ──")
    test("Queue list", "GET", "/api/v1/queue")

    # ── 22. System ──
    print("\n── 22. System ──")
    test("System detect", "GET", "/api/v1/system-detect")
    test("System stats", "GET", "/api/v1/system-stats")
    test("System preflight", "GET", "/api/v1/system/preflight")
    test("System network policy", "GET", "/api/v1/system/network-policy")
    test("System connections", "GET", "/api/v1/system/connections")

    # ── 23. Wizard ──
    print("\n── 23. Wizard ──")
    test("Wizard workflows", "GET", "/api/v1/wizard/workflows")

    # ── 24. Storage ──
    print("\n── 24. Storage ──")
    test("Storage usage", "GET", "/api/v1/storage/usage")

    # ── Resumo ──
    print("\n" + "=" * 70)
    print("RESUMO — TESTE EXAUSTIVO COM DADOS REAIS")
    print("=" * 70)
    passed = sum(1 for r in results if r[2])
    failed = sum(1 for r in results if not r[2])
    print(f"Total: {len(results)} | ✅ {passed} passaram | ❌ {failed} falharam")
    if failed > 0:
        print("\nFalhas:")
        for name, status, ok in results:
            if not ok:
                print(f"  ❌ {name}: HTTP {status}")
    print("=" * 70)


if __name__ == "__main__":
    main()
