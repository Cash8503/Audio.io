import json
from threading import RLock
from copy import deepcopy
from config import SETTINGS_PATH, BASE_DIR

SETTINGS_EXAMPLE_PATH = BASE_DIR / "settings.example.json"

settings_lock = RLock()
RESERVED_CONFIG_KEYS = {"tools"}

def _read_json(path):
    if not path.exists():
        return {}

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = path.with_suffix(".tmp")

    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

    temp_path.replace(path)


def _is_setting_definition(value):
    return isinstance(value, dict) and "value" in value


def sync_settings():
    with settings_lock:
        example = _read_json(SETTINGS_EXAMPLE_PATH)
        current = _read_json(SETTINGS_PATH)

        merged = deepcopy(example)

        for key, example_setting in example.items():
            if key in RESERVED_CONFIG_KEYS or not _is_setting_definition(example_setting):
                continue

            merged[key]["default_value"] = deepcopy(example_setting.get("value"))

            current_setting = current.get(key)

            if isinstance(current_setting, dict) and "value" in current_setting:
                merged[key]["value"] = current_setting["value"]
            elif current_setting is not None:
                merged[key]["value"] = current_setting

        _write_json(SETTINGS_PATH, merged)
        return merged


def load_settings():
    with settings_lock:
        return _read_json(SETTINGS_PATH)



def save_settings(updates):
    with settings_lock:
        settings = _read_json(SETTINGS_PATH)

        for key, value in updates.items():
            if key in RESERVED_CONFIG_KEYS:
                continue

            if key in settings and isinstance(settings[key], dict):
                settings[key]["value"] = value
            else:
                settings[key] = {
                    "label": key,
                    "description": "",
                    "group": "Other",
                    "type": type(value).__name__,
                    "value": value,
                    "default_value": value,
                }

        _write_json(SETTINGS_PATH, settings)
        return settings


def reset_setting_to_default(key):
    with settings_lock:
        example = _read_json(SETTINGS_EXAMPLE_PATH)
        example_setting = example.get(key)

        if key in RESERVED_CONFIG_KEYS or not _is_setting_definition(example_setting):
            return None

        settings = sync_settings()
        settings[key] = deepcopy(example_setting)
        _write_json(SETTINGS_PATH, settings)
        return settings[key]


def get_setting_value(key, default=None):
    with settings_lock:
        settings = _read_json(SETTINGS_PATH)
        setting = settings.get(key)

        if isinstance(setting, dict):
            return setting.get("value", default)

        return setting if setting is not None else default
