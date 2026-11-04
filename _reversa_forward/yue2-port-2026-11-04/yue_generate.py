import os, sys, time
sys.argv = ["validate_yue_gen"]
sys.path.insert(0, "/home/yurix/Documentos/cue_studio/app")
os.chdir("/home/yurix/Documentos/cue_studio/app")
import torch, wgp
from mmgp import offload
from models.TTS.yue_handler import family_handler

model_type = "yue"
model_def = wgp.get_model_def(model_type)
fn1 = wgp.get_model_filename(model_type=model_type, quantization="", dtype_policy="")
fn2 = wgp.get_model_filename(model_type=model_type, quantization="", dtype_policy="", submodel_no=2)
print(f"[gen] carregando YuE", flush=True)

t0 = time.time()
pipeline, pipe = family_handler.load_model([fn1, fn2], model_type, "yue", model_def)
print(f"[gen] modelo carregado em {time.time()-t0:.1f}s", flush=True)

# Repete o preparo de memória que o app faz (wgp.init_pipe + offload.profile):
# sem isso os pesos ficam na CPU e o embedding do Llama colide com a GPU.
kwargs = {"budgets": {"transformer": 100, "transformer2": 100, "*": 1000}}
offloadobj = offload.profile(
    pipe,
    profile_no=offload.profile_type.HighRAM_HighVRAM,
    quantizeTransformer=False,
    perc_reserved_mem_max=0,
    vram_safety_coefficient=0.7,
    convertWeightsFloatTo=torch.bfloat16,
    **kwargs,
)
print("[gen] offload profile aplicado", flush=True)

lyrics = "[Verse]\nMorning light filters through the pines\nEvery quiet road is yours and mine"
style = "pop, dreamy, warm vocal, female, nostalgic"

t0 = time.time()
result = pipeline.generate(
    lyrics, None, None,
    alt_prompt=style,
    audio_prompt_type="",
    temperature=1.0,
    yue_max_new_tokens=150,
    yue_run_n_segments=1,
    yue_stage2_batch_size=1,
    yue_segment_duration=6,
    seed=42,
    set_header_text=lambda t: print(f"[gen] {t}", flush=True),
    callback=lambda **kw: print(f"[gen] tok {kw.get('step_idx')} {kw.get('denoising_extra')}", flush=True),
)
print(f"[gen] geração levou {time.time()-t0:.1f}s", flush=True)

audio = result["x"]
sr = result["audio_sampling_rate"]
print(f"[gen] audio tensor {tuple(audio.shape)} @ {sr} Hz", flush=True)

import torchaudio
out = "/tmp/yue_validation.wav"
torchaudio.save(out, audio.clamp(-0.99, 0.99).cpu(), sr)
print(f"[gen] salvo {out} ({os.path.getsize(out)/1024:.0f} KB, {audio.shape[-1]/sr:.1f}s)", flush=True)
print("[gen] YUE VALIDATION OK", flush=True)
