"""Model custom-setting schema and request parsing, without the GPU runtime."""
import re

CUSTOM_SETTINGS_MAX = 6
CUSTOM_SETTING_TYPES = {"int", "float", "text"}

def get_custom_setting_key(index):
    return f"custom_setting_{index + 1}"

def _normalize_custom_setting_type(setting_type):
    parsed_type = str(setting_type or "text").strip().lower()
    return parsed_type if parsed_type in CUSTOM_SETTING_TYPES else "text"

def _normalize_custom_setting_name(name):
    normalized = re.sub(r"[^a-z0-9_]+", "_", str(name or "").strip().lower()).strip("_")
    return normalized

def get_custom_setting_id(setting_def, setting_index):
    explicit_id = setting_def.get("id", None)
    if explicit_id is not None and len(str(explicit_id).strip()) > 0:
        normalized_id = _normalize_custom_setting_name(explicit_id)
        if len(normalized_id) > 0:
            return normalized_id
    for field_name in ("name", "param"):
        normalized_name = _normalize_custom_setting_name(setting_def.get(field_name, ""))
        if len(normalized_name) > 0:
            return normalized_name
    return get_custom_setting_key(setting_index)

def get_model_custom_settings(model_def):
    if not isinstance(model_def, dict):
        return []
    custom_settings = model_def.get("custom_settings", [])
    if not isinstance(custom_settings, list):
        return []
    normalized = []
    used_ids = set()
    for idx, setting in enumerate(custom_settings[:CUSTOM_SETTINGS_MAX]):
        if not isinstance(setting, dict):
            continue
        one = setting.copy()
        one["label"] = str(one.get("label", f"Custom Setting {idx + 1}"))
        one["name"] = str(one.get("name", f"Custom Setting {idx + 1}"))
        one["type"] = _normalize_custom_setting_type(one.get("type", "text"))
        setting_id = get_custom_setting_id(one, idx)
        if setting_id in used_ids:
            setting_id = get_custom_setting_key(idx)
        used_ids.add(setting_id)
        one["id"] = setting_id
        normalized.append(one)
    return normalized

def parse_custom_setting_typed_value(raw_value, setting_type):
    if raw_value is None:
        return None, None
    if isinstance(raw_value, str):
        raw_value = raw_value.strip()
        if len(raw_value) == 0:
            return None, None
    setting_type = _normalize_custom_setting_type(setting_type)
    if setting_type == "int":
        if isinstance(raw_value, bool):
            return None, "Expected an integer value."
        if isinstance(raw_value, int):
            return raw_value, None
        if isinstance(raw_value, float):
            if raw_value.is_integer():
                return int(raw_value), None
            return None, "Expected an integer value."
        try:
            return int(str(raw_value).strip()), None
        except Exception:
            try:
                float_value = float(str(raw_value).strip())
                if float_value.is_integer():
                    return int(float_value), None
            except Exception:
                pass
            return None, "Expected an integer value."
    if setting_type == "float":
        if isinstance(raw_value, bool):
            return None, "Expected a float value."
        try:
            return float(raw_value), None
        except Exception:
            return None, "Expected a float value."
    return str(raw_value).strip(), None

def get_custom_setting_value_from_dict(custom_settings_values, setting_def, setting_index):
    setting_id = setting_def.get("id", get_custom_setting_id(setting_def, setting_index))
    if isinstance(custom_settings_values, dict) and setting_id in custom_settings_values:
        return custom_settings_values.get(setting_id, None)
    return setting_def.get("default", "")

def collect_custom_settings_from_inputs(model_def, inputs, strict=False):
    custom_settings_dict = {}
    existing_custom_settings = inputs.get("custom_settings", None)
    if not isinstance(existing_custom_settings, dict):
        existing_custom_settings = {}
    custom_settings = get_model_custom_settings(model_def)
    for idx, setting_def in enumerate(custom_settings):
        slot_key = get_custom_setting_key(idx)
        setting_id = setting_def["id"]
        raw_value = inputs.get(slot_key, None)
        if raw_value is None and setting_id in existing_custom_settings:
            raw_value = existing_custom_settings.get(setting_id, None)
        parsed_value, parse_error = parse_custom_setting_typed_value(raw_value, setting_def.get("type", "text"))
        if parse_error is not None:
            if strict:
                return None, f"{setting_def.get('label', slot_key)} {parse_error}"
            if raw_value is not None:
                raw_text = str(raw_value).strip() if isinstance(raw_value, str) else raw_value
                if not (isinstance(raw_text, str) and len(raw_text) == 0):
                    custom_settings_dict[setting_id] = raw_text
            continue
        if parsed_value is not None:
            custom_settings_dict[setting_id] = parsed_value
    # Endpoint-owned settings (for example Recast's prepared reference masks)
    # do not have public UI slots.  Preserve only the model handler's explicit
    # allowlist; unknown request keys remain discarded.
    runtime_custom_settings = model_def.get("runtime_custom_settings", [])
    if isinstance(runtime_custom_settings, (list, tuple, set)):
        for setting_id in runtime_custom_settings:
            if (
                isinstance(setting_id, str)
                and setting_id in existing_custom_settings
                and existing_custom_settings[setting_id] is not None
            ):
                custom_settings_dict[setting_id] = existing_custom_settings[setting_id]
    return custom_settings_dict if len(custom_settings_dict) > 0 else None, None

def clear_custom_setting_slots(inputs):
    for idx in range(CUSTOM_SETTINGS_MAX):
        inputs.pop(get_custom_setting_key(idx), None)
