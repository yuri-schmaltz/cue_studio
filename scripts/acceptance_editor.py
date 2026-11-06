#!/usr/bin/env python3
"""Import a completed acceptance production using the real Editor store/UI.

Requires the local Vite server on port 3011. API requests are forwarded only to
an isolated backend created for this receipt, with its own private credential.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import hashlib
import uuid
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
DATA=Path(sys.argv[1]).resolve()
for _ in range(1800):
    receipt=json.loads((DATA/'receipt.json').read_text())
    if receipt.get('status')=='completed':break
    if receipt.get('status')=='failed':raise SystemExit('Production failed: '+receipt.get('error',''))
    time.sleep(2)
else:raise SystemExit('Production still running')
python=Path.home()/'.local/share/studio.cue.desktop/runtime/env/bin/python'
token=uuid.uuid4().hex+uuid.uuid4().hex
ready=DATA/'editor-ready.json'
env={**os.environ,'CUE_DESKTOP_DATA':str(DATA),'CUE_DESKTOP_READY':str(ready),'CUE_DESKTOP_TOKEN':token,'CUE_DESKTOP_INSTANCE':uuid.uuid4().hex,'CUE_UI_DIST':str(ROOT/'ui/dist')}
ready.unlink(missing_ok=True)
log=(DATA/'editor-engine.log').open('w')
worker=subprocess.Popen([str(python),'-u',str(DATA/'app/desktop_worker.py')],cwd=DATA/'app',env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
result={}
try:
    for _ in range(60):
        if ready.exists():break
        if worker.poll() is not None:raise RuntimeError('Editor backend exited')
        time.sleep(1)
    base='http://127.0.0.1:'+str(json.loads(ready.read_text())['port'])
    rejoin=urllib.request.Request(base+'/api/v1/director/pipelines/'+receipt['pipeline_id']+'/rejoin',data=b'{}',headers={'x-cue-desktop-token':token,'Content-Type':'application/json'})
    with urllib.request.urlopen(rejoin,timeout=120) as response: joined=json.load(response)
    receipt['joined']=joined
    receipt['rejoin_status']='passed'
    receipt['recovery_code_sha256']={name:hashlib.sha256((DATA/'app'/name).read_bytes()).hexdigest() for name in ['services/director_pipeline.py','services/editor_projects.py']}
    (DATA/'receipt.json').write_text(json.dumps(receipt,indent=2))
    with sync_playwright() as p:
        browser=p.chromium.launch()
        page=browser.new_page(viewport={'width':1440,'height':1000})
        def proxy(route):
            parsed=urllib.parse.urlsplit(route.request.url)
            headers={k:v for k,v in route.request.headers.items() if k.lower() not in ['host','origin','cookie','authorization']}
            headers['x-cue-desktop-token']=token
            response=page.request.fetch(base+parsed.path+('?' + parsed.query if parsed.query else ''),method=route.request.method,headers=headers,data=route.request.post_data_buffer,timeout=180000)
            route.fulfill(response=response)
        page.route('**/api/v1/**',proxy)
        page.goto('http://127.0.0.1:3011/')
        page.wait_for_timeout(1500)
        if page.get_by_role('button',name='Get started').count():page.get_by_role('button',name='Get started').click()
        result=page.evaluate('''async(pid)=>{
          const {useStore}=await import('/src/stores/useStore.ts');
          await useStore.getState().switchWorkspace('release-smoke');
          const {useEditorStore}=await import('/src/editor/useEditorStore.ts');
          window.acceptanceEditor=useEditorStore;
          await useEditorStore.getState().initialize('release-smoke');
          await useEditorStore.getState().createProject('Release final acceptance edit');
          const ok=await useEditorStore.getState().openDirectorRunInEditor(pid,'Release acceptance edit');
          if(!ok)throw Error(useEditorStore.getState().error || 'Director import failed');
          const project=await useEditorStore.getState().saveProject();
          if(!project)throw Error(useEditorStore.getState().error || 'Save failed');
          useStore.getState().setAppSection('editor');
          return {project_id:project.id,tracks:project.tracks.length,items:project.tracks.reduce((n,t)=>n+t.items.length,0),assets:Object.keys(project.assets).length};
        }''',receipt['pipeline_id'])
        assert result['items'] > 0
        page.wait_for_timeout(1200)
        page.screenshot(path=str(DATA/'editor-import.png'))
        page.evaluate('async()=>{await acceptanceEditor.getState().exportProject()}')
        job=page.evaluate('acceptanceEditor.getState().exportJobId')
        assert job, page.evaluate('acceptanceEditor.getState().error')
        result['export_job_id']=job
        for _ in range(120):
            response=page.request.get(base+'/api/v1/status/'+job,headers={'x-cue-desktop-token':token})
            state=response.json()
            if state.get('status')=='completed':result['export']=state;break
            if state.get('status') in ['failed','cancelled']:raise RuntimeError(str(state))
            page.wait_for_timeout(1000)
        else:raise TimeoutError('Editor export timeout')
        page.screenshot(path=str(DATA/'editor-export.png'))
        page.unroute_all(behavior='wait')
        browser.close()
    result['joined']=joined
    result['status']='passed'
    print(json.dumps({'status':'passed','project_id':result['project_id'],'items':result['items'],'export_job_id':job}),flush=True)
except BaseException as e:
    result['status']='failed';result['error']=str(e);raise
finally:
    (DATA/'editor-receipt.json').write_text(json.dumps(result,indent=2))
    worker.terminate()
    try:worker.wait(timeout=15)
    except subprocess.TimeoutExpired:worker.kill();worker.wait()
    log.close()
