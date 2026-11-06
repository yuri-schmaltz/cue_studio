#!/usr/bin/env python3
"""One isolated, real Director production using locally cached models.

Records each approval and preserves outputs. Never retries submissions or edits
an existing user workspace. Run after npm run desktop:prepare.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request
import urllib.error
import uuid
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'app/.cache' / ('release-acceptance-' + time.strftime('%Y%m%d-%H%M%S'))
DATA.mkdir(parents=True)
APP = DATA / 'app'
shutil.copytree(ROOT / 'ui/src-tauri/runtime/app', APP)
(APP/'ckpts').symlink_to(ROOT/'app/ckpts', target_is_directory=True)
(DATA/'config').mkdir()
config = {'save_path':str(DATA/'outputs'),'image_save_path':str(DATA/'outputs'),'audio_save_path':str(DATA/'outputs'),'checkpoints_paths':[str(ROOT/'app/ckpts')], 'services':{'projects_root_path':str(DATA/'projects'),'llm_device':'cuda','llm_provider':'local','llm_model_id':'Abhiray/gemma-4-E4B-it-heretic-GGUF','use_director_v2':True,'director_prompt_polish':'off'}}
(DATA/'config/wgp_config.json').write_text(json.dumps(config))
token=uuid.uuid4().hex+uuid.uuid4().hex
ready=DATA/'ready.json'
env={**os.environ,'CUE_DESKTOP_DATA':str(DATA),'CUE_DESKTOP_READY':str(ready),'CUE_DESKTOP_TOKEN':token,'CUE_DESKTOP_INSTANCE':uuid.uuid4().hex,'CUE_UI_DIST':str(ROOT/'ui/dist')}
python=Path.home()/'.local/share/studio.cue.desktop/runtime/env/bin/python'
log=(DATA/'engine.log').open('w')
worker=subprocess.Popen([str(python),'-u',str(APP/'desktop_worker.py')],cwd=APP,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
report={'data':str(DATA),'worker_pid':worker.pid,'source_manifest_sha256':hashlib.sha256((APP/'runtime-code-manifest.json').read_bytes()).hexdigest(),'approvals':[]}
(DATA/'receipt.json').write_text(json.dumps(report,indent=2))
print(str(DATA),flush=True)
base=''


def request(path, body=None, method=None):
    data=None if body is None else json.dumps(body).encode()
    req=urllib.request.Request(base+path,data=data,method=method,headers={'x-cue-desktop-token':token,'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=180) as r:return json.load(r)
    except urllib.error.HTTPError as e:raise RuntimeError(f'{path}: {e.code} {e.read().decode()[:2000]}')


try:
    for _ in range(60):
        if worker.poll() is not None:raise RuntimeError('Engine exited during startup')
        if ready.exists():
            base='http://127.0.0.1:'+str(json.loads(ready.read_text())['port']);break
        time.sleep(1)
    else:raise RuntimeError('Engine did not start')
    request('/api/v1/workspaces',{'name':'release-smoke'})
    params={'workspace':'release-smoke','pipeline_type':'short_film_story','skill_type':'short_film','auto_mode':False,'use_director_v2':True,'scene_description':'A single continuous three-second shot of a small red clay cube on a plain wooden table. Warm steady light, locked camera. The cube gently rotates a few degrees. No people, no text, no dialogue, no cuts. Exactly one scene.','target_duration':3,'narrative_mode':False,'characters':[],'seamless':False,'shot_image_guidance':'generate','fps':24,'frames_steps':8,'frames_minimum':9,'image_model':'flux2_klein_9b','image_params':{'resolution':'512x288','num_inference_steps':4,'guidance_scale':1},'video_model':'ltx2_22B_distilled_1_1','video_params':{'resolution':'512x288','num_inference_steps':8,'guidance_scale':1,'input_video_strength':0.7},'director_resolution_preset':'480p','director_aspect_ratio':'16:9','llm_provider':'local','llm_device':'cuda','llm_model_id':config['services']['llm_model_id']}
    if len(sys.argv) > 1:
        prior = Path(sys.argv[1]).resolve()
        saved = json.loads((prior/'status.json').read_text())
        previous_pid = saved['id']
        previous_root = prior/'projects/release-smoke/.director'/previous_pid
        params.update(prepared_clip_plans=saved['clip_plans'],
                      prepared_planned_clips=saved['planned_clips'],
                      prepared_clip_image_paths=[str(previous_root/name) for name in saved['clip_images']])
        report['reused_approved_plan_from'] = str(prior)
    (DATA/'request.json').write_text(json.dumps(params,indent=2))
    pid=request('/api/v1/director/pipeline/start',params)['pipeline_id'];report['pipeline_id']=pid
    print('Pipeline '+pid,flush=True)
    previous=None
    deadline=time.monotonic()+2700
    while time.monotonic()<deadline:
        state=request('/api/v1/director/pipeline/'+pid)
        summary=(state.get('status'),state.get('phase'),state.get('pause_reason'),state.get('progress',{}).get('message'))
        if summary!=previous: print(summary,flush=True);previous=summary
        (DATA/'status.json').write_text(json.dumps(state,indent=2))
        if state.get('status')=='paused':
            report['approvals'].append({'reason':state.get('pause_reason'),'digest':state.get('review_digest'),'clip_count':len(state.get('clip_plans',[]))})
            request('/api/v1/director/pipeline/'+pid+'/continue',{'clip_plans':state.get('clip_plans',[]),'review_digest':state.get('review_digest')})
        elif state.get('status')=='completed':
            report['status']='completed';report['result']=state;break
        elif state.get('status') in ['failed','cancelled']:
            raise RuntimeError(json.dumps(state.get('error') or state.get('errors') or state)[:4000])
        (DATA/'receipt.json').write_text(json.dumps(report,indent=2))
        time.sleep(3)
    else:raise TimeoutError('Production exceeded 45 minutes')
    if len(state.get('clip_plans', [])) > 1:
        report['joined']=request('/api/v1/director/pipelines/'+pid+'/rejoin',{})
    planned = sum(clip.get('_director_duration_sec', 0) for clip in state.get('clip_plans', []))
    report['timing'] = {'requested_seconds': params['target_duration'], 'planned_seconds': planned}
    if len(state.get('clip_plans', [])) != 1 or abs(planned - params['target_duration']) > 0.2:
        raise AssertionError(f'Plan does not respect requested duration: {report["timing"]}')
    videos = sorted((DATA/'projects').rglob('*.mp4'))
    durations = []
    for video in videos:
        probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration,nb_frames',
                                         '-of', 'json', str(video)], text=True)
        metadata = json.loads(probe)
        stream = next(item for item in metadata['streams'] if item.get('codec_type') == 'video')
        durations.append({'path': str(video.relative_to(DATA)),
                          'seconds': float(metadata['format']['duration']),
                          'video_seconds': float(stream['duration']),
                          'video_frames': int(stream['nb_frames'])})
    if not durations or any(abs(item[key] - params['target_duration']) > 0.25
                            for item in durations for key in ('seconds', 'video_seconds')):
        raise AssertionError(f'Render does not respect requested duration: {durations}')
    report['timing']['rendered'] = durations
    report['timing']['status'] = 'passed'
except BaseException as e:
    report['status']='failed';report['error']=str(e);raise
finally:
    (DATA/'receipt.json').write_text(json.dumps(report,indent=2))
    if base:
        try: request('/api/v1/llm/unload', {})
        except Exception: pass
    worker.terminate()
    try:worker.wait(timeout=15)
    except subprocess.TimeoutExpired:worker.kill();worker.wait()
    log.close()
