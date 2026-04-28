# Settings Reference

Use `settings.example.json` as the source of truth. On startup and when `/api/settings` is loaded, Audio.io syncs this file into `data/settings.json` while preserving saved `value` fields.

## Setting Definition

Each normal top-level key is rendered as a setting when it has a `value`.

```json
"setting_key": {
  "label": "Display Label",
  "description": "Short helper text.",
  "group": "Appearance",
  "type": "select",
  "value": "auto"
}
```

Fields:

| Field | Required | Function |
| --- | --- | --- |
| `label` | No | Display name in the settings page. Falls back to the key. |
| `description` | No | Helper text under the label. |
| `group` | No | Settings section heading. Defaults to `General`. |
| `type` | Yes | Control renderer. See built-in types below. |
| `value` | Yes | Default value used by the `Default` button and initial sync. |
| `min` | No | Minimum for `number` controls. |
| `max` | No | Maximum for `number` controls. |
| `step` | No | Step size for `number` controls. |
| `choices` | Select only | Options for `select`. Strings or objects are allowed. |
| `option_tooltips` | Select only | Map of option value to tooltip text. |

## Built-In Setting Types

| Type | UI | Saved Value |
| --- | --- | --- |
| `boolean` | Toggle switch | `true` or `false` |
| `select` | Dropdown | Selected option string |
| `color` | Color picker plus hex input | Normalized hex like `#8c4eff` |
| `number` | Number input | Number |
| `text` or other | Text input | String |
| `hidden` | Not rendered | Preserved in JSON |

`select` choices can be simple:

```json
"choices": ["dark", "light", "auto"]
```

Or labeled:

```json
"choices": [
  { "value": "auto", "label": "System", "tooltip": "Follow OS theme." }
]
```

## Default Button

Every visible setting gets a `Default` button. It calls:

```text
POST /api/settings/<setting_key>/default
```

The server restores the full setting object from `settings.example.json`, including its default `value`.

Reserved metadata keys, currently `tools`, are not resettable and are not saved as user settings.

## Tools Definition

Add dynamic settings-page tools under the reserved top-level `tools` key.

```json
"tools": {
  "tool_key": {
    "label": "Tool Name",
    "description": "Optional helper text.",
    "button": {
      "label": "Run Tool",
      "action": "fetch /api/whatever",
      "method": "POST"
    },
    "textInput": true,
    "colorInput": true,
    "boolInput": true,
    "return": true
  }
}
```

Tool fields:

| Field | Required | Function |
| --- | --- | --- |
| `label` | No | Tool panel heading. Falls back to the tool key. |
| `description` | No | Helper text shown above the action row. |
| `button` | Yes | Button config. Can be an object or simple label string. |
| `textInput` | No | Adds a text input. `true` uses defaults, object customizes it. |
| `colorInput` | No | Adds a color input. `true` uses defaults, object customizes it. |
| `boolInput` | No | Adds a checkbox input. `true` uses defaults, object customizes it. |
| `fileInput` | No | Adds a file input. `true` uses defaults, object customizes it. |
| `return` | No | When true, display JSON/text response from the server. |
| `successMessage` | No | Message shown when `return` is false. |

Button fields:

| Field | Required | Function |
| --- | --- | --- |
| `label` | No | Button text. Defaults to `Run`. |
| `action` | Yes | Endpoint. Prefix with `fetch ` for readability, e.g. `fetch /api/import`. |
| `method` | No | HTTP method. Defaults to `POST`. |
| `return` | No | Button-level response display override. |

Input config fields:

| Field | Applies To | Function |
| --- | --- | --- |
| `name` | All inputs | Request field name. |
| `label` | All inputs | Label beside/above the input. |
| `value` | Text, color, bool | Initial input value. |
| `placeholder` | Text | Placeholder text. |
| `accept` | File | File picker accept string, e.g. `.txt`. |
| `filename` | File | Required exact filename before upload. |
| `required` | File | Set `false` to allow no file. Defaults to required. |

If a tool has a `fileInput`, the request body is `FormData`. Otherwise, inputs are sent as JSON. Tools with no inputs send no body.

## Current Example

```json
"tools": {
  "youtube_cookies": {
    "label": "YouTube Cookies",
    "description": "Upload cookies.txt when YouTube blocks downloads. Audio.io will use it automatically for future imports.",
    "button": {
      "label": "Upload cookies.txt",
      "action": "fetch /api/auth/cookies",
      "method": "POST"
    },
    "fileInput": {
      "name": "cookies",
      "label": "cookies.txt",
      "accept": ".txt",
      "filename": "cookies.txt"
    },
    "return": true
  }
}
```
