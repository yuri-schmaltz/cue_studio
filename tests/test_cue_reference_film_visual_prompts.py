"""Os prompts do filme precisam descrever a cena, não apenas o estado dela.

A revisão criativa do master v7 rejeitou o filme por três defeitos
visuais: uma lâmpada acesa ao lado do cubo em S08, o pedestal ausente em
alguns planos e a mesa ausente em outros. A causa não foi o modelo: os
prompts por plano diziam *o estado* ("a lâmpada está apagada", "a mesa
está vazia") sem dizer *o que está no quadro*, e nenhum prompt negativo
proibia uma lâmpada acesa extra. A âncora de ambiente descrevia a cena
certa e mesmo assim o plano não herdava a presença dela.

Estes testes guardam a receita contra a regressão: cada plano declara o
que está no quadro, os planos fechados proíbem qualquer lâmpada e o
prompt negativo proíbe a lâmpada extra sem proibir a lâmpada legítima do
pedestal.
"""
from __future__ import annotations

import json
from pathlib import Path

FIXTURE = Path(__file__).parent / "fixtures" / "cue_reference_film_v1"
VISUAL = json.loads((FIXTURE / "visual_prompts.json").read_text())
SHOTS = json.loads((FIXTURE / "shots.json").read_text())["shots"]
SHOT_IDS = [shot["id"] for shot in SHOTS]

# Os planos em que a mesa e o pedestal têm de aparecer: são os planos
# abertos, onde o defeito do v7 (um plano sem mesa ou sem pedestal) era
# visível.
WIDE_SHOTS = {"S01", "S02", "S04", "S06", "S07", "S11", "S12"}
# Os planos fechados: a moldura é pequena demais para a mesa e o
# pedestal, e qualquer lâmpada dentro do quadro é um defeito.
CLOSE_SHOTS = {"S03", "S05", "S08", "S10"}

# Termos que proíbem a lâmpada acesa sem proibir a lâmpada do pedestal,
# que é legítima em S09, S11 e S12.
EXTRA_LAMP_TERMS = (
    "extra lamp", "second lamp", "oil lamp", "kerosene lamp", "table lamp",
    "desk lamp", "floor lamp", "hanging lamp", "chandelier", "lantern",
)


def _shot(shot_id: str) -> str:
    """O prompt de imagem do plano, em minúsculas para a comparação."""
    return VISUAL["shots"][shot_id.upper()]["image"].lower()


def test_location_declares_the_two_pieces_of_furniture():
    """A bíblia de cena precisa dizer que a mesa e o pedestal existem."""
    location = VISUAL["location"].lower()
    assert "table" in location, "a âncora de ambiente precisa descrever a mesa"
    assert "pedestal" in location, "a âncora de ambiente precisa descrever o pedestal"
    assert "socket" in location, "o pedestal precisa do encaixe quadrado do cubo"
    assert "bulb" in location, "o pedestal precisa da lâmpada âmbar no topo"
    assert "no other lamps" in location, "a cena precisa declarar que não há outras lâmpadas"
    assert "only two pieces of furniture" in location, (
        "a cena precisa dizer que a mesa e o pedestal são as únicas peças de mobília, "
        "para que nenhum plano introduza uma terceira")


def test_negative_forbids_an_extra_lamp_without_forbidding_the_pedestal_bulb():
    """O prompt negativo proíbe a lâmpada extra e não a lâmpada do pedestal."""
    for kind in ("image", "video"):
        terms = [term.strip().lower() for term in VISUAL["negative"][kind].split(",")]
        for term in EXTRA_LAMP_TERMS:
            assert term in terms, f"o prompt negativo de {kind} não proíbe '{term}'"
        # Uma proibição genérica de lâmpada apagaria a lâmpada legítima do
        # pedestal, que acende em S09, S11 e S12.
        assert "lamp" not in terms, (
            f"o prompt negativo de {kind} proíbe a lâmpada inteira; a lâmpada do "
            "pedestal é legítima em S09, S11 e S12")
        assert "light bulb" not in terms, (
            f"o prompt negativo de {kind} proíbe a lâmpada do pedestal inteira")
        assert "bulb" not in terms, (
            f"o prompt negativo de {kind} proíbe a lâmpada do pedestal inteira")
        assert "extra table" in terms, f"o prompt negativo de {kind} não proíbe uma mesa extra"
        assert "extra pedestal" in terms, (
            f"o prompt negativo de {kind} não proíbe um pedestal extra")


def test_wide_shots_show_the_table_and_the_pedestal():
    """Os planos abertos precisam declarar a mesa e o pedestal no quadro."""
    for shot_id in sorted(WIDE_SHOTS):
        prompt = _shot(shot_id)
        assert "table" in prompt, f"{shot_id} não declara a mesa no quadro"
        assert "pedestal" in prompt, f"{shot_id} não declara o pedestal no quadro"
        assert "socket" in prompt, f"{shot_id} não declara o encaixe do pedestal"
        assert "bulb" in prompt, f"{shot_id} não declara a lâmpada do pedestal"


def test_close_shots_forbid_any_lamp():
    """Os planos fechados não podem ter lâmpada, lanterna nem objeto aceso."""
    for shot_id in sorted(CLOSE_SHOTS):
        prompt = _shot(shot_id)
        assert "no lamp" in prompt, f"{shot_id} não proíbe a lâmpada no quadro"
        assert "no lantern" in prompt, f"{shot_id} não proíbe a lanterna no quadro"
        assert "glowing" in prompt or "lit object" in prompt, (
            f"{shot_id} não proíbe um objeto aceso no quadro")


def test_s08_shows_only_the_hand_the_cube_and_the_socket():
    """S08 é o detalhe do encaixe: a lâmpada é o defeito do v7."""
    prompt = _shot("s08")
    assert "only the robot's right hand" in prompt, (
        "S08 não restringe o quadro à mão, ao cubo e ao pedestal")
    assert "square socket" in prompt, "S08 não declara o encaixe quadrado"
    assert "outside the frame" in prompt, "S08 não diz que a lâmpada está fora do quadro"
    assert "no lamp" in prompt, "S08 não proíbe a lâmpada no quadro"
    assert "no light bulb" in prompt, "S08 não proíbe a lâmpada no quadro"


def test_s09_keeps_the_single_bulb_that_lights_up():
    """S09 é o plano em que a lâmpada acende: ela tem de estar no quadro."""
    prompt = _shot("s09")
    assert "single amber bulb" in prompt, "S09 não declara a lâmpada única no quadro"
    assert "no second bulb" in prompt, "S09 não proíbe uma segunda lâmpada"
    assert "begins off" in prompt, "S09 não declara que a lâmpada começa apagada"


def test_every_shot_has_a_prompt():
    """Nenhum plano pode ficar sem prompt de imagem."""
    for shot_id in SHOT_IDS:
        assert VISUAL["shots"][shot_id]["image"].strip(), f"{shot_id} está sem prompt de imagem"
        assert VISUAL["shots"][shot_id]["motion"].strip(), f"{shot_id} está sem prompt de movimento"


# O cubo aparece em cada plano, sobre a mesa ou no encaixe do pedestal.
# Um prompt que declara o mesmo objeto como vazio e ao mesmo tempo
# ocupado é uma contradição que o modelo resolve por conta própria, e a
# medição do cubo passa a medir o que o modelo decidiu desenhar.
ON_THE_TABLE = {"S01", "S02", "S03", "S04"}
IN_THE_SOCKET = {"S09", "S11", "S12"}


def test_no_prompt_contradicts_itself_about_the_cube():
    """Nenhum plano declara vazio o que está ocupado pelo cubo."""
    for shot_id in sorted(ON_THE_TABLE):
        prompt = _shot(shot_id)
        assert "completely empty top" not in prompt, (
            f"{shot_id} declara a mesa vazia enquanto o cubo está em cima dela")
        assert "empty tabletop" not in prompt, (
            f"{shot_id} declara a mesa vazia enquanto o cubo está em cima dela")
    for shot_id in sorted(IN_THE_SOCKET):
        prompt = _shot(shot_id)
        assert "empty square cube-sized socket" not in prompt, (
            f"{shot_id} declara o encaixe vazio enquanto o cubo está sentado nele")


def test_s04_keeps_the_robot_and_the_cube_inside_the_frame():
    """S04 é o plano do cubo na mão: a câmera não recua nem o robô sai."""
    prompt = _shot("s04")
    assert "does not pull back" in prompt, (
        "S04 precisa dizer que a câmera mantém a distância média e não recua")
    assert "background" in prompt, (
        "S04 precisa mandar o pedestal para o fundo, e não para o meio do quadro")
    motion = VISUAL["shots"]["S04"]["motion"].lower()
    assert "never leaves the frame" in motion, (
        "S04 precisa proibir que o robô saia do quadro com o cubo")
    assert "fully visible" in motion, (
        "S04 precisa exigir que o cubo na mão fique visível em todo quadro")


def test_s11_sees_the_seated_cube_from_the_side():
    """S11 é o plano do cubo no encaixe: ele tem de ler como cubo."""
    prompt = _shot("s11")
    assert "level with the pedestal socket" in prompt, (
        "S11 precisa pedir uma câmera nivelada com o encaixe, para o cubo "
        "assentado não sair achatado pelo ângulo alto")
    assert "flat shape" in prompt, (
        "S11 precisa avisar que o cubo assentado não pode virar uma mancha achatada")
    motion = VISUAL["shots"]["S11"]["motion"].lower()
    assert "stays seated in the pedestal socket" in motion, (
        "S11 precisa manter o cubo assentado no encaixe durante todo o plano")
    assert "fully visible in the frame" in motion, (
        "S11 precisa exigir que o cubo assentado fique visível em todo quadro")
