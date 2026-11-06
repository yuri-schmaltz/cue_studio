# Reprodução

Base: 56c0bd5d64a468fb4339811b3829117af899d5ee

Ubuntu/Linux, Python 3.11, branch main. Teste isolado por AST sem importar modelos.

Antes: pytest tests/test_delete_upload.py, 3 falhas/3 testes (rota ausente).
Depois: pytest tests/test_delete_upload.py tests/test_upload_sandbox.py, 18 testes aprovados.

Classificação: deterministic. Arquivos temporários exclusivamente.
