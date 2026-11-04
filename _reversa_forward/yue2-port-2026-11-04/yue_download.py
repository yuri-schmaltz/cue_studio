import os, sys
sys.argv = ["validate_yue"]
sys.path.insert(0, os.getcwd())
import wgp

print("[validate] model def:", wgp.get_model_def("yue").get("name"), flush=True)
fn1 = wgp.get_model_filename(model_type="yue", quantization="", dtype_policy="")
fn2 = wgp.get_model_filename(model_type="yue", quantization="", dtype_policy="", submodel_no=2)
print("[validate] stage1 url:", fn1, flush=True)
print("[validate] stage2 url:", fn2, flush=True)
wgp.download_models(fn1, "yue", 0, 1)
print("[validate] stage1 group done", flush=True)
wgp.download_models(fn2, "yue", 0, 2)
print("[validate] stage2 group done", flush=True)
print("[validate] ALL DONE", flush=True)
