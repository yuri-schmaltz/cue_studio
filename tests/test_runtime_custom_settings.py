from app.services.runtime_custom_settings import (
    collect_custom_settings_from_inputs, get_model_custom_settings,
)


def test_custom_schema_is_normalized_without_mutating_model_definition():
    model = {"custom_settings": [
        {"name": "Frame Count", "type": " INT "},
        {"name": "Frame Count", "type": "unsupported"},
    ]}
    settings = get_model_custom_settings(model)
    assert [(s["id"], s["type"]) for s in settings] == [
        ("frame_count", "int"), ("custom_setting_2", "text"),
    ]
    assert model["custom_settings"][0] == {"name": "Frame Count", "type": " INT "}


def test_strict_requests_reject_fractional_integer_and_boolean_coercion():
    model = {"custom_settings": [{"id": "count", "type": "int", "label": "Frames"}]}
    for value in (2.5, True, "no"):
        values, error = collect_custom_settings_from_inputs(model, {"custom_setting_1": value}, strict=True)
        assert values is None
        assert error == "Frames Expected an integer value."
    assert collect_custom_settings_from_inputs(model, {"custom_setting_1": "12.0"}, strict=True) == ({"count": 12}, None)


def test_hidden_runtime_settings_preserve_only_explicit_model_allowlist():
    model = {"custom_settings": [{"id": "strength", "type": "float"}],
             "runtime_custom_settings": ["prepared_mask"]}
    inputs = {"custom_settings": {"strength": "0.5", "prepared_mask": "/mask.png", "unknown": 42}}
    assert collect_custom_settings_from_inputs(model, inputs, strict=True) == (
        {"strength": 0.5, "prepared_mask": "/mask.png"}, None,
    )
