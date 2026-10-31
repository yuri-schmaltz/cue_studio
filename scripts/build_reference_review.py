#!/usr/bin/env python3
"""Build a local review page for a measured real master; never approve it."""
from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from app.services.reference_acceptance import file_hash


def build_review(folder: Path) -> Path:
    folder = folder.resolve()
    master = folder / 'master.mp4'
    report = json.loads((folder / 'technical-report.json').read_text())
    digest = file_hash(master)
    if report.get('master_sha256') != digest or not all(report.get('checks', {}).values()) or not report.get('checks'):
        raise ValueError('Review requires the unchanged technically validated master')
    dimensions = [
        ('identity', 'Identidade', 'Mesmo robô, cabeça preservada em todos os quadros, desenho com três lentes, dois braços e duas pernas; um único cubo. Em S06, perfil natural pode ocultar lentes; conferir a identidade durante toda a caminhada.'),
        ('continuity', 'Continuidade', 'Cubo, mão direita, lâmpada e posições seguem a ação entre os planos.'),
        ('motion', 'Movimento', 'Ações legíveis, sem deformações ou saltos incompatíveis.'),
        ('appearance', 'Aparência', 'Geometria, luz e materiais consistentes entre os planos.'),
        ('pt_br_voice', 'Voz PT-BR', 'Falas corretas, inteligíveis e completas, incluindo as terminações.'),
        ('sound_editing', 'Montagem sonora', 'Música, efeitos e falas bem posicionados e equilibrados.'),
    ]
    fields = ''.join(
        '<label>' + label + '<select data-score="' + key + '" required>'
        '<option value="">Selecione</option>' + ''.join(f'<option value="{i}">{i}</option>' for i in range(5)) +
        '</select><small>' + explanation + '</small></label>'
        for key, label, explanation in dimensions
    )
    speech = ''.join(
        f'<label>Fala {i}<audio controls preload="none" src="V0{i}-raw.wav"></audio></label>'
        for i in range(1, 5) if (folder / f'V0{i}-raw.wav').is_file()
    )
    document = r'''<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Revisão — A luz da oficina</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:980px;margin:auto;padding:24px;background:#101820;color:#edf2f7}
video{width:100%;border-radius:8px;background:#000}label{display:block;margin:18px 0}small{display:block;color:#b9c6d4}
input:not([type=checkbox]),select,textarea,button{font:inherit;padding:10px;border-radius:6px;border:1px solid #6e8297}
select{margin-left:16px}textarea{box-sizing:border-box;width:100%;min-height:100px}button{cursor:pointer;background:#90d7c0}
code{overflow-wrap:anywhere;font-size:12px}audio{display:block;width:100%;max-width:480px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:600px){.grid{grid-template-columns:1fr}}a{color:#90d7c0}
</style><h1>A luz da oficina</h1>
<p>Assista ao filme, ouça as falas e registre sua avaliação. Escala de 0 a 4; cada dimensão precisa de pelo menos 3 para aprovação. Registre erros críticos mesmo que outras dimensões estejam boas.</p>
<video controls preload="metadata" src="master.mp4"></video>
<details><summary>Ouvir cada fala separadamente</summary>__SPEECH__</details>
<p><small>Arquivo desta revisão: SHA-256</small><code>__HASH__</code></p>
<form id="review"><label>Seu nome <input id="reviewer" required autocomplete="name"></label>
<div class="grid">__FIELDS__</div>
<label>Erros críticos observados (um por linha; deixe vazio somente se não houver nenhum)<textarea id="errors"></textarea></label>
<label><input type="checkbox" id="speech"> Conferi todas as falas: texto correto e sem palavras cortadas.</label>
<label><input type="checkbox" id="title"> Conferi o título: “A luz da oficina”.</label>
<button>Baixar minha revisão</button><p id="status" role="status"></p>
<details id="fallback"><summary>Se o download não aparecer, copie o JSON abaixo</summary>
<p><small>O mesmo conteúdo do arquivo baixado. Salve como <code>creative-review.json</code> nesta mesma pasta. Se o navegador renomear o arquivo, por exemplo <code>creative-review (1).json</code>, renomeie de volta para <code>creative-review.json</code>.</small></p>
<textarea id="json" readonly rows="14"></textarea></details></form>
<p>Salve o arquivo baixado como <code>creative-review.json</code> nesta mesma pasta. A revisão vale apenas para o master identificado acima.</p>
<script>
const masterHash=__HASH_JSON__;
document.querySelector('#review').addEventListener('submit',event=>{
 event.preventDefault();
 const scores=Object.fromEntries([...document.querySelectorAll('[data-score]')].map(el=>[el.dataset.score,Number(el.value)]));
 const review={master_sha256:masterHash,reviewer:document.querySelector('#reviewer').value.trim(),reviewed_at:new Date().toISOString(),scores,
 critical_errors:document.querySelector('#errors').value.split('\n').map(x=>x.trim()).filter(Boolean),
 speech_correct_and_untruncated:document.querySelector('#speech').checked,title_correct:document.querySelector('#title').checked};
 const text=JSON.stringify(review,null,2);
 // The download can be blocked by a browser policy or a download shelf
 // that never shows up. The same text is always visible below, so a
 // reviewer never loses a ten minute review to a missing file.
 document.querySelector('#json').value=text;
 const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download='creative-review.json';
 document.body.appendChild(link);link.click();setTimeout(()=>{link.remove();URL.revokeObjectURL(url);},1000);
 document.querySelector('#status').textContent='Sua avaliação foi exportada. O teste de aceite verificará notas, erros críticos e vínculo com o master.';
});</script></html>'''
    document = document.replace('__SPEECH__', speech).replace('__FIELDS__', fields).replace('__HASH__', html.escape(digest)).replace('__HASH_JSON__', json.dumps(digest))
    path = folder / 'review.html'
    path.write_text(document)
    return path


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('validation_dir', type=Path)
    args = parser.parse_args()
    print(build_review(args.validation_dir))
