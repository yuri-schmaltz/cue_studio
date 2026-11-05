"""Gera uma faixa de teste com o YuE v1, usando o mesmo caminho do app.

Repete o que o Cue Studio faz na hora de carregar um modelo de musica:
resolver o catalogo, baixar/localizar os pesos por estagio, montar o pipeline
e aplicar o perfil de memoria do MMGP (sem isso os pesos ficam na CPU e a
entrada na GPU quebra com "Expected all tensors to be on the same device").

Uso:
    cd app && env/bin/python ../_reversa_forward/yue2-port-2026-11-04/yue_generate.py
"""
import os
import sys
import time

sys.argv = ["yue_generate"]
APP_DIR = "/home/yurix/Documentos/cue_studio/app"
sys.path.insert(0, APP_DIR)
os.chdir(APP_DIR)

import torch
import wgp
from mmgp import offload

from models.TTS.yue_handler import family_handler

MODEL_TYPE = "yue"
LYRICS = (
    "[Verse]\n"
    "Morning light filters through the pines\n"
    "Every quiet road is yours and mine\n"
    "[Chorus]\n"
    "Softly the whole world starts to breathe\n"
    "Stay for one more song with me"
)
STYLE = "pop, dreamy, warm vocal, female, nostalgic"
OUT_WAV = "/tmp/yue_validation.wav"
RECEIPTS = "/home/yurix/Documentos/cue_studio/app/outputs/validation-2026-11-04"


def stamp(message: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {message}", flush=True)


def main() -> int:
    model_def = wgp.get_model_def(MODEL_TYPE)
    if model_def is None:
        stamp("ERRO: modelo 'yue' ausente do catalogo")
        return 1
    stage1 = wgp.get_model_filename(model_type=MODEL_TYPE, quantization="", dtype_policy="")
    stage2 = wgp.get_model_filename(
        model_type=MODEL_TYPE, quantization="", dtype_policy="", submodel_no=2
    )
    stamp(f"catalogo: {model_def.get('name')}")
    stamp(f"stage1: {stage1}")
    stamp(f"stage2: {stage2}")

    t0 = time.time()
    pipeline, pipe = family_handler.load_model([stage1, stage2], MODEL_TYPE, "yue", model_def)
    stamp(f"modelo carregado em {time.time() - t0:.1f}s")

    kwargs = {}
    kwargs["coTenantsMap"] = {}
    # O mesmo caminho do app: perfil resolvido pelo catálogo (que honra a
    # chave "memory_profile" do def) e budgets resolvidos pelo init_pipe
    # (que honra a chave "vram_budgets" do def).
    profile = wgp.compute_profile(-1, "audio", model_type=MODEL_TYPE)
    mmgp_profile = wgp.init_pipe(pipe, kwargs, profile, model_type=MODEL_TYPE)
    stamp(f"perfil: app={profile} mmgp={mmgp_profile} budgets={kwargs.get('budgets')}")
    offload.profile(
        pipe,
        profile_no=mmgp_profile,
        quantizeTransformer=False,
        perc_reserved_mem_max=0,
        vram_safety_coefficient=0.7,
        convertWeightsFloatTo=torch.bfloat16,
        **kwargs,
    )
    stamp("perfil de memoria aplicado")

    last = [time.time()]

    def on_progress(**kwargs):
        now = time.time()
        if now - last[0] > 30:
            last[0] = now
            stamp(f"progresso: {kwargs.get('denoising_extra')}")

    t0 = time.time()
    result = pipeline.generate(
        LYRICS,
        None,
        None,
        alt_prompt=STYLE,
        audio_prompt_type="",
        temperature=1.0,
        # Um segmento de 6 s custa ~600 tokens no Stage 1 (50 fps x 2 codebooks).
        yue_max_new_tokens=700,
        yue_run_n_segments=1,
        yue_stage2_batch_size=1,
        yue_segment_duration=6,
        seed=42,
        set_header_text=lambda text: stamp(text),
        callback=on_progress,
    )
    stamp(f"geracao concluida em {time.time() - t0:.1f}s")

    if result is None:
        stamp("ERRO: o pipeline devolveu None")
        return 1

    audio = result["x"]
    rate = result["audio_sampling_rate"]
    stamp(f"audio {tuple(audio.shape)} @ {rate} Hz")

    flat = audio.detach().float().cpu().flatten()
    peak = float(flat.abs().max())
    rms = float(flat.pow(2).mean().sqrt())
    seconds = audio.shape[-1] / rate
    stamp(f"peak {peak:.4f} | rms {rms:.5f} | duracao {seconds:.1f}s")

    import torchaudio

    clipped = audio.clamp(-0.99, 0.99).cpu()
    torchaudio.save(OUT_WAV, clipped, rate)
    os.makedirs(RECEIPTS, exist_ok=True)
    receipt = os.path.join(RECEIPTS, "yue_validation.wav")
    torchaudio.save(receipt, clipped, rate)
    stamp(f"wav: {OUT_WAV} ({os.path.getsize(OUT_WAV) / 1024:.0f} KB)")
    stamp(f"recibo: {receipt}")

    if peak < 0.001:
        stamp("ERRO: audio praticamente mudo")
        return 1
    stamp("YUE VALIDATION OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
