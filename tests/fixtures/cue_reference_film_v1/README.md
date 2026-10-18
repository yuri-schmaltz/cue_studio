# Fixture canônica — "A luz da oficina" (cue-reference-film-v1)

Substitui a proposta original "O robô e a estação". Fixture autoral, sem
dependências externas. Usada para validar o fluxo completo de produção
audiovisual local (Eixo 7 / A29, marcos M1-M3).

## Identidade

- ID: `cue-reference-film-v1`
- Título: "A luz da oficina"
- Duração: 60 s
- Timeline: 24 fps, 1.440 frames
- Master: review-720p-v1 (1280x720)
- Áudio: 48 kHz, estéreo, 2.880.000 amostras/canal

## Bíblia fixa

- Robô `robot_01`: corpo cinza claro, detalhes azul-escuros, 2 pernas, 2 braços,
  rosto com 3 lentes circulares em disposição triangular, sem boca humana.
  Geometria crítica não muda.
- Cubo `red_cube`: vermelho fosco, sem texto.
- Oficina `room_a`: mesa à direita, porta ao fundo, janela à esquerda, luz
  matinal suave.
- Base `lamp_base`: pedestal simples com cavidade para cubo e lâmpada âmbar
  desligada.

## Lista de planos fechada (12 × 120 frames)

| Plano | Frames | Enquadramento/ação | Estado de saída |
|-------|--------|--------------------|-----------------|
| S01 | 0–120 | Geral da oficina vazia, lâmpada apagada | Ambiente estabelecido |
| S02 | 120–240 | Robô entra pela porta, esquerda→direita | Robô próximo à mesa |
| S03 | 240–360 | Close das três lentes olhando o cubo | Cubo ainda na mesa |
| S04 | 360–480 | Plano médio; robô pega cubo com mão direita | Cubo na mão direita |
| S05 | 480–600 | Detalhe da mão/cubo, sem mudar geometria | Pegada conservada |
| S06 | 600–720 | Plano médio; robô caminha até o pedestal | Movimento esquerda→direita |
| S07 | 720–840 | Geral; robô diante da base | Cubo na mão direita |
| S08 | 840–960 | Detalhe; cubo inserido na cavidade | Mão livre, cubo na base |
| S09 | 960–1080 | Lâmpada acende âmbar gradualmente | Luz acesa |
| S10 | 1080–1200 | Close do robô iluminado, três lentes intactas | Robô observa a luz |
| S11 | 1200–1320 | Geral; robô recua e contempla a oficina | Cubo permanece na base |
| S12 | 1320–1440 | Plano estável com título final sobreposto | Encerramento |

## Narração PT-BR (4 falas literais)

| Cue | Janela | Texto |
|-----|--------|-------|
| V01 | 5–12 s | "Na oficina silenciosa, uma pequena descoberta." |
| V02 | 15–23 s | "Cada peça encontra o seu lugar." |
| V03 | 35–43 s | "Basta um gesto para acender uma ideia." |
| V04 | 50–57 s | "E uma nova história pode começar." |

## Música

- Instrumental autoral, 60 s.
- Alvo: 96 BPM, 4/4, timbre suave sem canto.

## Efeitos

- Passos discretos: S02, S06.
- Toque do cubo: S04.
- Encaixe: 37,5 s.
- Acendimento: 40 s.
- Ambiente contínuo leve.
- Título sobreposto apenas em S12: "A luz da oficina" (composto pelo editor).

## Modos de teste (F0–F3)

| Modo | Geração | Finalidade | Não comprova |
|------|---------|------------|--------------|
| F0 determinístico | Clips geométricos, tom/ruído e voz sintética/fixa | CI, duração, mix, export, falhas | Qualidade de IA |
| F1 híbrido | Mídias congeladas com jobs reais de edição/retake controlado | Integração sem downloads | Consumo do modelo |
| F2 IA completa | Modelos locais homologados geram cadeia inteira | Aceite M2/M3 | Determinismo entre GPUs |
| F3 recuperação | F1/F2 com interrupções controladas | Reconciliação e preservação | Retomada de difusão se backend não suporta |

## Critérios de aceite da fixture

| Métrica | Aceite |
|---------|--------|
| Duração de vídeo | Exatamente 1.440 frames a 24 fps |
| Stems | 2.880.000 amostras/canal, alinhamento comum |
| Posicionamento de cue | Erro ≤ 1 frame da timeline |
| Drift A/V do master | ≤ 1 frame entre início e fim do ensaio |
| Loudness do preset | −16 LUFS ± 1 LU, true peak ≤ −1 dBTP |
| Fala | Nenhuma palavra truncada; texto literal conservado |
| Aceitação artística (F2) | Identidade, continuidade, movimento, aparência, voz pt-BR e coerência de som/montagem todos ≥ 3 em escala 0–4 |

Erros críticos: número de lentes muda em plano de rosto; cubo duplica/desaparece na ação principal; mão/objeto contradiz o estado central; fala trocada; título incorreto; trilha original perdida no rerun.
