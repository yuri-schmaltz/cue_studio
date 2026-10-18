"""A25 — integração do Shot IR: adapter do H3 ledger + endpoints REST."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.shot_ir import build_shot_ir_router
from app.services.director.shot_ir_adapter import to_shot_ir
from app.services.director.shot_ir_store import ShotIRStore, shots_dir_for
from app.services.director.shot_ir_schema import shotir_to_dict
from shot_ir_helpers import make_shot


@pytest.fixture()
def project_root(tmp_path):
    return tmp_path


@pytest.fixture()
def client(project_root):
    app = FastAPI()
    app.include_router(build_shot_ir_router(projects_root=lambda: str(project_root)))
    return TestClient(app)


PROD = "prod-1"


def _shots_dir(project_root, production_id=PROD):
    return shots_dir_for(project_root, production_id)


# ------------------------------------------------------------------
# Adapter: h3_story_ledger → Shot IR
# ------------------------------------------------------------------

def _sample_ledger(**overrides):
    ledger = {
        "subject_continuity": (
            "Ana and João retain their exact requested identities"
        ),
        "setting_continuity": (
            "Keep the requested kitchen, geography, time of day coherent"
        ),
        "visual_continuity": "Natural window light from the left",
        "required_final_outcome": "Ana hands the cup to João",
        "blocking_contract": "Ana stands screen-left holding the cup",
        "source_intent": {"cast_names": ["char_ana", "char_joao"]},
    }
    ledger.update(overrides)
    return ledger


def test_to_shot_ir_derives_characters_from_ledger():
    shot = to_shot_ir(_sample_ledger(), shot_id="shot_001")
    assert [c.id for c in shot.characters] == ["char_ana", "char_joao"]
    assert shot.shot_id == "shot_001"


def test_to_shot_ir_carries_blocking_contract():
    shot = to_shot_ir(_sample_ledger(), shot_id="shot_001")
    assert "Ana stands screen-left" in shot.blocking_contract


def test_to_shot_ir_slugs_location_from_setting():
    shot = to_shot_ir(_sample_ledger(), shot_id="shot_001")
    assert "kitchen" in shot.environment.location_id


def test_to_shot_ir_links_previous_shot():
    shot = to_shot_ir(
        _sample_ledger(), shot_id="shot_002", previous_shot_id="shot_001"
    )
    assert shot.continuity_hints.previous_shot_id == "shot_001"
    assert shot.continuity_hints.state_inherited_from == "shot_001"


def test_to_shot_ir_handles_ledger_without_cast_names():
    ledger = _sample_ledger()
    ledger["source_intent"] = {}
    shot = to_shot_ir(ledger, shot_id="shot_001")
    assert shot.characters == []
    shot.validate()


def test_to_shot_ir_output_is_valid_and_serializable():
    shot = to_shot_ir(_sample_ledger(), shot_id="shot_001")
    shot.validate()
    assert isinstance(shotir_to_dict(shot), dict)


def test_to_shot_ir_legacy_partial_is_storable(tmp_path):
    """IR derivado de ledger legado pode ser persistido (backward compat)."""
    store = ShotIRStore(tmp_path)
    shot = to_shot_ir(_sample_ledger(), shot_id="shot_001")
    store.save(shot)
    assert store.load("shot_001").shot_id == "shot_001"


# ------------------------------------------------------------------
# Endpoints REST
# ------------------------------------------------------------------

def test_get_shot_ir_404_when_absent(client):
    resp = client.get(f"/api/v1/director/productions/{PROD}/shots/shot_001/shot_ir")
    assert resp.status_code == 404


def test_put_then_get_shot_ir_round_trip(client, project_root):
    payload = shotir_to_dict(make_shot("shot_001"))
    resp = client.put(
        f"/api/v1/director/productions/{PROD}/shots/shot_001/shot_ir",
        json=payload,
    )
    assert resp.status_code == 200
    assert resp.json()["saved"] is True

    got = client.get(
        f"/api/v1/director/productions/{PROD}/shots/shot_001/shot_ir"
    )
    assert got.status_code == 200
    body = got.json()
    assert body["shot_id"] == "shot_001"
    assert body["shot_ir"]["environment"]["location_id"] == "loc_kitchen"
    assert _shots_dir(project_root, PROD).is_dir()


def test_put_shot_ir_validates_and_rejects_422(client):
    payload = shotir_to_dict(make_shot("shot_001"))
    payload["camera"]["shot_size"] = "enormous"
    resp = client.put(
        f"/api/v1/director/productions/{PROD}/shots/shot_001/shot_ir",
        json=payload,
    )
    assert resp.status_code == 422


def test_put_shot_ir_uses_path_shot_id_when_body_omits_it(client):
    payload = shotir_to_dict(make_shot("ignored"))
    payload.pop("shot_id")
    resp = client.put(
        f"/api/v1/director/productions/{PROD}/shots/shot_055/shot_ir",
        json=payload,
    )
    assert resp.status_code == 200
    got = client.get(
        f"/api/v1/director/productions/{PROD}/shots/shot_055/shot_ir"
    )
    assert got.json()["shot_id"] == "shot_055"


def test_continuity_endpoints_report_inconsistencies(client, project_root):
    store = ShotIRStore(_shots_dir(project_root))
    store.save(make_shot("shot_001"))
    altered = make_shot("shot_002")
    altered.characters[0].gaze.direction = "screen_left"
    store.save(altered)

    get_resp = client.get(f"/api/v1/director/productions/{PROD}/continuity")
    post_resp = client.post(
        f"/api/v1/director/productions/{PROD}/continuity/check"
    )
    for resp in (get_resp, post_resp):
        assert resp.status_code == 200
        data = resp.json()
        assert data["shot_count"] == 2
        assert data["severity_counts"]["warning"] >= 1
        assert any(item["kind"] == "gaze_flip" for item in data["inconsistencies"])


def test_invalid_production_id_rejected(client):
    # Um production id contendo barra invertida é rejeitado pelo handler.
    resp = client.get(
        "/api/v1/director/productions/bad%5Cid/continuity"
    )
    assert resp.status_code == 400
