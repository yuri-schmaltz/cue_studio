#!/usr/bin/env python3
"""Gerador determinístico F0 para a fixture 'A luz da oficina'.

Produz clips geométricos (sem IA), áudio sintético (tons), monta a timeline
com FFmpeg e valida os critérios de aceite da fixture. Modo F0: CI, duração,
mix, export, falhas — não comprova qualidade de IA.
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

FIXTURE_DIR = Path(__file__).resolve().parent
PROJECT = json.loads((FIXTURE_DIR / "project.json").read_text())
SHOTS = json.loads((FIXTURE_DIR / "shots.json").read_text())
SPEECH = json.loads((FIXTURE_DIR / "speech.json").read_text())
SOUND = json.loads((FIXTURE_DIR / "sound_cues.json").read_text())
EXPECTED = json.loads((FIXTURE_DIR / "expected.json").read_text())

FPS = PROJECT["timebase"]["numerator"]
W, H = PROJECT["canvas"]["width"], PROJECT["canvas"]["height"]
DURATION_SECONDS = EXPECTED["duration_seconds"]
TOTAL_FRAMES = EXPECTED["total_frames"]
SAMPLE_RATE = SPEECH["sample_rate"]
TOTAL_SAMPLES = SPEECH["total_samples_per_channel"]

# Cor base por shot (distinguíveis visualmente).
SHOT_COLORS = {
    "S01": "0x404040",   # oficina vazia, cinza escuro
    "S02": "0x204060",   # robô entrando, azul escuro
    "S03": "0x102030",   # close lentes, quase preto
    "S04": "0x303020",   # robô + cubo, cinza+vermelho escuro
    "S05": "0x502020",   # detalhe cubo, vermelho escuro
    "S06": "0x204060",   # robô caminhando, azul
    "S07": "0x303020",   # robô na base
    "S08": "0x101020",   # cubo encaixado, escuro
    "S09": "0x603000",   # lâmpada âmbar
    "S10": "0x704010",   # robô iluminado âmbar+azul
    "S11": "0x303030",   # robô recuando, cinza
    "S12": "0x202040",   # título, azul escuro
}


def sh(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, check=True, **kw)


def make_shot_clip(shot_id: str, out: Path) -> None:
    """Gera um clip geométrico de 120 frames a 24fps, 720p."""
    color = SHOT_COLORS[shot_id]
    n_frames = 120
    # Filtro: cor sólida + um retângulo animado que se move (simula ação).
    # x avança da esquerda para a direita ao longo dos 120 frames.
    filter_graph = (
        f"color=c={color}:s={W}x{H}:r={FPS}:duration={n_frames/FPS},"
        f"drawbox=x='w*(t/{n_frames/FPS})':y=ih/2:w=ih/10:h=ih/10:"
        f"color=white@0.7:t=fill"
    )
    sh([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", filter_graph,
        "-frames:v", str(n_frames),
        "-pix_fmt", "yuv420p",
        str(out),
    ])


def make_audio_master(out: Path) -> None:
    """Gera o master de áudio: narração (tons por cue), música (batida 96 BPM),
    efeitos e ambiente contínuo. 48 kHz estéreo, 2.880.000 amostras/canal."""
    dur = DURATION_SECONDS
    # Inputs lavfi sequenciais:
    #   [0..3] = sine das 4 cues de narração
    #   [4]    = sine da música (110 Hz)
    #   [5]    = ruído rosa do ambiente
    inputs: list[str] = []
    for cue in SPEECH["cues"]:
        freq = 220 + SPEECH["cues"].index(cue) * 110
        inputs.extend(["-f", "lavfi", "-i",
                       f"sine=frequency={freq}:sample_rate={SAMPLE_RATE}:duration={dur}"])
    inputs.extend(["-f", "lavfi", "-i",
                   f"sine=frequency=110:sample_rate={SAMPLE_RATE}:duration={dur}"])
    inputs.extend(["-f", "lavfi", "-i",
                   f"anoisesrc=color=pink:sample_rate={SAMPLE_RATE}:duration={dur}"])

    filter_parts: list[str] = []
    for i, cue in enumerate(SPEECH["cues"]):
        filter_parts.append(
            f"[{i}]volume=0.3:enable='between(t,{cue['start_seconds']},{cue['end_seconds']})'[n{i}];"
        )
    filter_parts.append(
        f"[4]volume=0.15:enable='gt(mod(t,0.625),0.6)'[m];"
    )
    filter_parts.append("[5]volume=0.05[amb];")

    mix_inputs = "".join(f"[n{i}]" for i in range(len(SPEECH["cues"]))) + "[m][amb]"
    filter_parts.append(
        f"{mix_inputs}amix=inputs={len(SPEECH['cues'])+2}:duration=longest[aout]"
    )

    filter_complex = "".join(filter_parts)

    sh([
        "ffmpeg", "-y",
        *inputs,
        "-filter_complex", filter_complex,
        "-map", "[aout]",
        "-ar", str(SAMPLE_RATE),
        "-ac", "2",
        "-t", str(dur),
        str(out),
    ])


def assemble_master(video_clips: list[Path], audio: Path, out: Path) -> None:
    """Concatena clips de vídeo e adiciona áudio. Exporta master H.264/AAC."""
    # Lista de concatenação.
    concat_list = FIXTURE_DIR / "_f0_concat.txt"
    with open(concat_list, "w") as f:
        for c in video_clips:
            f.write(f"file '{c}'\n")

    sh([
        "ffmpeg", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-i", str(audio),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-ar", str(SAMPLE_RATE), "-ac", "2",
        "-shortest",
        str(out),
    ])
    concat_list.unlink(missing_ok=True)


def probe(path: Path) -> dict:
    res = sh([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=nb_frames,r_frame_rate,width,height,pix_fmt",
        "-of", "json", str(path),
    ])
    return json.loads(res.stdout)


def probe_audio(path: Path) -> dict:
    res = sh([
        "ffprobe", "-v", "error", "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels,duration",
        "-of", "json", str(path),
    ])
    return json.loads(res.stdout)


def main() -> int:
    tmp = Path(tempfile.mkdtemp(prefix="cue-f0-"))
    print(f"[F0] diretório temporário: {tmp}")

    # 1. Gerar clips de cada shot.
    clips: list[Path] = []
    for shot in SHOTS["shots"]:
        clip = tmp / f"{shot['id']}.mp4"
        make_shot_clip(shot["id"], clip)
        clips.append(clip)
        print(f"[F0] clip {shot['id']}: {clip.name}")

    # 2. Gerar áudio master.
    audio = tmp / "audio_master.wav"
    make_audio_master(audio)
    print(f"[F0] áudio master: {audio.name}")

    # 3. Montar e exportar master de vídeo.
    master = tmp / "master_review-720p-v1.mp4"
    assemble_master(clips, audio, master)
    print(f"[F0] master exportado: {master.name}")

    # 4. Validar critérios de aceite.
    vinfo = probe(master)
    streams = vinfo.get("streams", [])
    if not streams:
        print("[F0] FALHA: nenhum stream de vídeo no master.")
        return 1
    vs = streams[0]
    nb_frames = int(vs.get("nb_frames", 0))
    r_frame_rate = vs.get("r_frame_rate", "0/1")
    # r_frame_rate é "24/1".
    num, den = r_frame_rate.split("/")
    fps = float(num) / float(den) if den != "0" else 0

    ainfo = probe_audio(master)
    astr = ainfo.get("streams", [{}])[0]
    sample_rate = int(astr.get("sample_rate", 0))
    channels = int(astr.get("channels", 0))
    duration = float(astr.get("duration", 0))

    ok = True
    checks = [
        ("frames == 1440", nb_frames == TOTAL_FRAMES),
        ("fps == 24", abs(fps - FPS) < 0.01),
        ("sample_rate == 48000", sample_rate == SAMPLE_RATE),
        ("channels == 2", channels == 2),
        ("duration ~ 60s", abs(duration - DURATION_SECONDS) < 0.5),
    ]
    for name, result in checks:
        status = "OK" if result else "FALHA"
        print(f"[F0] {name}: {status} (valor={nb_frames if 'frames' in name else fps if 'fps' in name else sample_rate if 'sample' in name else channels if 'channels' in name else duration:.2f})")
        ok = ok and result

    # Áudio: amostras por canal = sample_rate * duracao * canais? Não: amostras/canal = rate * duracao.
    expected_samples = SAMPLE_RATE * DURATION_SECONDS
    print(f"[F0] áudio duração: {duration:.2f}s (amostras/canal esperadas ~{expected_samples})")

    # Limpeza.
    for c in clips:
        c.unlink(missing_ok=True)
    audio.unlink(missing_ok=True)
    master.unlink(missing_ok=True)
    tmp.rmdir()

    if ok:
        print("[F0] TODOS OS CRITÉRIOS DE ACEITE PASSARAM.")
        return 0
    print("[F0] ALGUNS CRITÉRIOS FALHARAM.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
