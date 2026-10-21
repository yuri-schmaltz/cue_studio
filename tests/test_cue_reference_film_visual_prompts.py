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
