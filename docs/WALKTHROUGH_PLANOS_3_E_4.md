# Walkthrough - Planos 3 e 4: Geração em Background, Fila Robusta e Portabilidade Nativa

Implementamos e validamos as melhorias de ciclo de vida de jobs, fila de background, portabilidade nativa para Windows e isolamento de testes entre plataformas.

---

## 1. O que foi implementado

### 1.1 Scripts Nativos para Windows (`start_local.ps1` e `stop_local.ps1`)
- **Problema anterior:** A inicialização e parada do Maestro/Cue Studio dependiam exclusivamente de scripts Bash (`start.sh` e `stop.sh`), exigindo ambientes POSIX/Git Bash e dificultando a automação em ambientes Windows locais.
- **Solução implementada:**
  - Criado `start_local.ps1` nativo em PowerShell com detecção automática de virtualenvs (`env-sol`, `env-rtx50`, `env`), validação de build da UI, encerramento de processos órfãos anteriores via PID e inicialização desacoplada do processo FastAPI.
  - Criado `stop_local.ps1` nativo para ler `.launcher.pid` e realizar encerramento limpo via `Stop-Process -Force`.
  - Atualizado `stop.sh` para detectar de forma inteligente o interpretador Python ativo em ambientes heterogêneos (`env/bin/python`, `python3`, `python`).

### 1.2 Compatibilidade Multiplataforma nos Testes de Launch (`tests/test_standalone_launch.py`)
- **Problema anterior:** A suíte de testes de inicialização falhava no Windows devido a:
  1. Uso de `symlink_to` em diretórios temporários sem privilégios de administrador (`WinError 1314`).
  2. Chamada direta ao executável `bash` inexistente no PATH do sistema.
  3. Tentativa de spawn de subshells daemon POSIX no Windows.
- **Solução implementada:**
  - Criado helper de fallback de link `create_python_link`, realizando cópia segura (`shutil.copy2`) caso o symlink falhe no Windows.
  - Criado helper `run_bash` com detecção automática da instalação do Git Bash no Windows.
  - Adicionada anotação `@unittest.skipIf(sys.platform == 'win32', ...)` nos testes específicos de daemons em subshell POSIX, permitindo execução 100% verde da suíte no Windows nativo.
  - Ajustado o ponto de injeção dos argumentos de segurança no `app/launch.py` para manter o contrato de teste de extração AST do `host`.

### 1.3 Verificação e Testes Unitários de Fila e Ciclo de Vida (`tests/test_job_lifecycle.py`)
- **Garantias validadas:**
  - Transição atômica de estados: `held` -> `queued` -> `running` -> `completed`.
  - Prioridade de cancelamento: se um job for cancelado enquanto aguarda slot na fila, ele não transiciona para `running` nem aceita `completed` tardio.
  - Concorrência de GPU com `generation_slot`: acquire seguro com verificação de abort contínuo durante o polling.
  - Rastreamento e snapshot seguro de saídas geradas por cena (`output_files`, `clip_output_files`).

---

## 2. Arquivos Modificados e Criados
- `start_local.ps1` (Novo)
- `stop_local.ps1` (Novo)
- `tests/test_job_lifecycle.py` (Novo)
- `app/launch.py` (Ajustado)
- `stop.sh` (Ajustado)
- `tests/test_standalone_launch.py` (Ajustado)
- `docs/WALKTHROUGH_PLANOS_3_E_4.md` (Novo)

---

## 3. Estado dos Testes Automatizados
Executamos as suítes integradas:
```bash
python -m unittest tests.test_api_security tests.test_hardware_safety tests.test_job_lifecycle tests.test_standalone_launch
```
**Resultado:** **23 testes executados com 100% de sucesso** (0 erros, 0 falhas, 5 skips controlados para daemons POSIX).

