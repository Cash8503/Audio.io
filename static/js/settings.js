const settingsGroups = document.getElementById("settings-groups");
const saveResult = document.getElementById("settings-save-result");
const settingsToolsSection = document.getElementById("settings-tools-section");
const settingsTools = document.getElementById("settings-tools");

let currentSettings = null;

function parseColorValue(value) {
    const trimmed = String(value || "").trim();

    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
        return trimmed.toLowerCase();
    }

    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
        const r = trimmed[1];
        const g = trimmed[2];
        const b = trimmed[3];
        return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }

    return null;
}

function getInitialColorValue(value) {
    return parseColorValue(value) || "#8c4eff";
}

function setStatus(element, message, status) {
    if (!element) return;

    element.textContent = message;
    element.classList.remove("error", "success");

    if (status) {
        element.classList.add(status);
    }
}

function formatChoiceLabel(choice) {
    return String(choice).replaceAll("_", " ");
}

function getChoiceValue(choice) {
    return typeof choice === "object" && choice !== null
        ? String(choice.value)
        : String(choice);
}

function getChoiceLabel(choice) {
    return typeof choice === "object" && choice !== null && choice.label
        ? choice.label
        : formatChoiceLabel(getChoiceValue(choice));
}

function getChoiceTooltip(setting, choice) {
    const value = getChoiceValue(choice);

    if (typeof choice === "object" && choice !== null && choice.tooltip) {
        return choice.tooltip;
    }

    return setting.option_tooltips?.[value] || "";
}

function resolveTheme(themeSetting) {
    if (themeSetting === "auto") {
        return window.matchMedia("(prefers-color-scheme: dark)").matches
            ? "dark"
            : "light";
    }

    return themeSetting;
}

function applySettingPreview(key, value) {
    if (key === "theme") {
        document.documentElement.setAttribute("data-theme", resolveTheme(value));
    }

    if (key === "accent_color") {
        const color = parseColorValue(value);

        if (color) {
            document.documentElement.style.setProperty("--accent", color);
        }
    }
}

async function saveSettings(updates) {
    const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
    });

    if (!response.ok) {
        throw new Error(`Failed to save settings: ${response.status}`);
    }

    return await response.json();
}

async function resetSettingToDefault(key) {
    const response = await fetch(`/api/settings/${encodeURIComponent(key)}/default`, {
        method: "POST"
    });
    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || `Failed to restore default: ${response.status}`);
    }

    return result;
}

function getSettingValueFromControl(control, setting) {
    if (setting.type === "boolean") {
        return control.checked;
    }

    if (setting.type === "number") {
        return Number(control.value);
    }

    if (setting.type === "color") {
        return parseColorValue(control.value);
    }

    return control.value;
}

async function saveSetting(key, setting, control) {
    const value = getSettingValueFromControl(control, setting);

    if (setting.type === "number" && !Number.isFinite(value)) {
        setStatus(saveResult, "Enter a valid number.", "error");
        return;
    }

    if (setting.type === "color" && !value) {
        setStatus(saveResult, "Enter a valid hex color like #8c4eff.", "error");
        return;
    }

    control.disabled = true;
    setStatus(saveResult, "Saving...", null);

    try {
        await saveSettings({ [key]: value });
        applySettingPreview(key, value);
        currentSettings = await fetchSettings();
        setStatus(saveResult, "Setting saved.", "success");
    } catch (error) {
        console.error(error);
        setStatus(saveResult, error.message || "Failed to save setting.", "error");
    } finally {
        control.disabled = false;
    }
}

async function restoreDefaultSetting(key, control, button) {
    button.disabled = true;
    control.disabled = true;
    setStatus(saveResult, "Restoring default...", null);

    try {
        const result = await resetSettingToDefault(key);
        applySettingPreview(key, result.setting.value);
        currentSettings = await fetchSettings();
        renderSettings(currentSettings);
        setStatus(saveResult, "Default restored.", "success");
    } catch (error) {
        console.error(error);
        setStatus(saveResult, error.message || "Failed to restore default.", "error");
    } finally {
        button.disabled = false;
        control.disabled = false;
    }
}

function createBooleanControl(key, setting) {
    const toggle = document.createElement("label");
    toggle.className = "toggle";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(setting.value);
    input.dataset.settingKey = key;

    const slider = document.createElement("span");
    slider.className = "toggle-slider";

    input.addEventListener("change", () => saveSetting(key, setting, input));

    toggle.append(input, slider);
    return { wrapper: toggle, control: input };
}

function createSelectControl(key, setting) {
    const select = document.createElement("select");
    select.className = "setting-input";
    select.dataset.settingKey = key;

    for (const choice of setting.choices || []) {
        const option = document.createElement("option");
        const value = getChoiceValue(choice);
        const tooltip = getChoiceTooltip(setting, choice);

        option.value = value;
        option.textContent = getChoiceLabel(choice);
        option.title = tooltip;
        select.appendChild(option);
    }

    select.value = String(setting.value);
    select.title = setting.option_tooltips?.[select.value] || "";
    select.addEventListener("change", () => {
        select.title = setting.option_tooltips?.[select.value] || "";
        applySettingPreview(key, select.value);
        saveSetting(key, setting, select);
    });

    return { wrapper: select, control: select };
}

function createColorControl(key, setting) {
    const color = getInitialColorValue(setting.value);
    const wrapper = document.createElement("div");
    wrapper.className = "setting-color-control";

    const picker = document.createElement("input");
    picker.className = "setting-color-picker";
    picker.type = "color";
    picker.value = color;
    picker.dataset.settingKey = key;

    const input = document.createElement("input");
    input.className = "setting-input setting-color-value";
    input.type = "text";
    input.value = color;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.dataset.settingKey = key;

    picker.addEventListener("input", () => {
        input.value = picker.value;
        applySettingPreview(key, picker.value);
    });

    picker.addEventListener("change", () => saveSetting(key, setting, picker));

    input.addEventListener("change", () => {
        const parsedColor = parseColorValue(input.value);

        if (!parsedColor) {
            input.value = picker.value;
            setStatus(saveResult, "Enter a valid hex color like #8c4eff.", "error");
            return;
        }

        input.value = parsedColor;
        picker.value = parsedColor;
        applySettingPreview(key, parsedColor);
        saveSetting(key, setting, input);
    });

    wrapper.append(picker, input);
    return { wrapper, control: input };
}

function createInputControl(key, setting) {
    const input = document.createElement("input");
    input.className = "setting-input";
    input.type = setting.type === "number" ? "number" : "text";
    input.value = setting.value;
    input.dataset.settingKey = key;

    if (setting.min !== undefined) {
        input.min = setting.min;
    }

    if (setting.max !== undefined) {
        input.max = setting.max;
    }

    if (setting.step !== undefined) {
        input.step = setting.step;
    }

    input.addEventListener("change", () => saveSetting(key, setting, input));

    return { wrapper: input, control: input };
}

function createSettingControl(key, setting) {
    if (setting.type === "boolean") {
        return createBooleanControl(key, setting);
    }

    if (setting.type === "select") {
        return createSelectControl(key, setting);
    }

    if (setting.type === "color") {
        return createColorControl(key, setting);
    }

    return createInputControl(key, setting);
}

function createSettingRow(key, setting) {
    const row = document.createElement("div");
    row.className = "setting-row";

    const labelBlock = document.createElement("div");
    labelBlock.className = "setting-label-block";

    const label = document.createElement("label");
    label.className = "setting-label";
    label.textContent = setting.label || formatChoiceLabel(key);

    const description = document.createElement("p");
    description.className = "setting-description";
    description.textContent = setting.description || "";

    labelBlock.append(label, description);

    const { wrapper, control } = createSettingControl(key, setting);
    const controlId = `setting-${key}`;
    control.id = controlId;
    label.htmlFor = controlId;

    const controlGroup = document.createElement("div");
    controlGroup.className = "setting-control-group";

    const defaultButton = document.createElement("button");
    defaultButton.className = "btn setting-default-button";
    defaultButton.type = "button";
    defaultButton.textContent = "Default";
    defaultButton.title = "Return to the value in settings.example.json";
    defaultButton.addEventListener("click", () => restoreDefaultSetting(key, control, defaultButton));

    controlGroup.append(wrapper, defaultButton);
    row.append(labelBlock, controlGroup);
    return row;
}

function getGroupedSettings(settings) {
    const groups = new Map();

    for (const [key, setting] of Object.entries(settings || {})) {
        if (key === "tools") continue;
        if (!setting || setting.type === "hidden") continue;

        const groupName = setting.group || "General";

        if (!groups.has(groupName)) {
            groups.set(groupName, []);
        }

        groups.get(groupName).push([key, setting]);
    }

    return groups;
}

function normalizeInputConfig(config, defaults) {
    if (!config) {
        return null;
    }

    if (config === true) {
        return defaults;
    }

    return { ...defaults, ...config };
}

function createToolInput(toolId, inputType, inputConfig) {
    const inputId = `tool-${toolId}-${inputType}`;
    const wrapper = document.createElement("label");
    wrapper.className = "settings-tool-input";
    wrapper.htmlFor = inputId;

    const label = document.createElement("span");
    label.textContent = inputConfig.label || formatChoiceLabel(inputConfig.name || inputType);

    const input = document.createElement("input");
    input.id = inputId;
    input.dataset.toolInputName = inputConfig.name;

    if (inputType === "text") {
        input.className = "setting-input";
        input.type = "text";
        input.placeholder = inputConfig.placeholder || "";
        input.value = inputConfig.value || "";
    }

    if (inputType === "color") {
        input.className = "setting-color-picker";
        input.type = "color";
        input.value = getInitialColorValue(inputConfig.value);
    }

    if (inputType === "bool") {
        input.type = "checkbox";
        input.checked = Boolean(inputConfig.value);
    }

    if (inputType === "file") {
        input.className = "settings-file-input";
        input.type = "file";
        input.accept = inputConfig.accept || "";
    }

    wrapper.append(label, input);
    return { wrapper, input, config: inputConfig, type: inputType };
}

function getToolInputDefinitions(toolId, tool) {
    const definitions = [];
    const textConfig = normalizeInputConfig(tool.textInput, {
        name: "text",
        label: "Text"
    });
    const colorConfig = normalizeInputConfig(tool.colorInput, {
        name: "color",
        label: "Color",
        value: "#8c4eff"
    });
    const boolConfig = normalizeInputConfig(tool.boolInput, {
        name: "enabled",
        label: "Enabled"
    });
    const fileConfig = normalizeInputConfig(tool.fileInput, {
        name: "file",
        label: "File"
    });

    for (const [type, config] of [
        ["text", textConfig],
        ["color", colorConfig],
        ["bool", boolConfig],
        ["file", fileConfig]
    ]) {
        if (config) {
            definitions.push(createToolInput(toolId, type, config));
        }
    }

    return definitions;
}

function parseToolAction(button) {
    let action = String(button.action || "").trim();
    let method = String(button.method || "").trim().toUpperCase();

    if (action.toLowerCase().startsWith("fetch ")) {
        action = action.slice(6).trim();
        method = method || "POST";
    }

    return {
        action,
        method: method || "POST"
    };
}

function formatToolResponse(result) {
    if (result && typeof result === "object") {
        return result.message || result.error || JSON.stringify(result);
    }

    return String(result || "Done.");
}

function collectToolInputBody(inputs) {
    const fileInput = inputs.find((entry) => entry.type === "file");

    if (fileInput) {
        const formData = new FormData();

        for (const entry of inputs) {
            if (entry.type === "file") {
                const file = entry.input.files?.[0];

                if (!file && entry.config.required !== false) {
                    throw new Error(`Choose ${entry.config.label || "a file"} first.`);
                }

                if (!file) continue;

                if (entry.config.filename && file.name !== entry.config.filename) {
                    throw new Error(`File must be named ${entry.config.filename}.`);
                }

                formData.append(entry.config.name, file);
                continue;
            }

            formData.append(entry.config.name, getToolInputValue(entry));
        }

        return { body: formData, headers: null };
    }

    const payload = {};

    for (const entry of inputs) {
        payload[entry.config.name] = getToolInputValue(entry);
    }

    return {
        body: inputs.length ? JSON.stringify(payload) : null,
        headers: inputs.length ? { "Content-Type": "application/json" } : null
    };
}

function getToolInputValue(entry) {
    if (entry.type === "bool") {
        return entry.input.checked;
    }

    if (entry.type === "color") {
        return parseColorValue(entry.input.value);
    }

    return entry.input.value;
}

async function runTool(tool, inputs, button, resultElement) {
    const buttonConfig = typeof tool.button === "object" && tool.button !== null
        ? tool.button
        : { label: tool.button || tool.label, action: tool.action, method: tool.method };
    const { action, method } = parseToolAction(buttonConfig);

    if (!action) {
        setStatus(resultElement, "Tool action is missing.", "error");
        return;
    }

    button.disabled = true;
    setStatus(resultElement, "Running...", null);

    try {
        const { body, headers } = collectToolInputBody(inputs);
        const requestOptions = { method };

        if (headers) {
            requestOptions.headers = headers;
        }

        if (body && method !== "GET") {
            requestOptions.body = body;
        }

        const response = await fetch(action, requestOptions);
        const contentType = response.headers.get("content-type") || "";
        const result = contentType.includes("application/json")
            ? await response.json()
            : await response.text();

        if (!response.ok) {
            const message = result?.error || result || `Tool failed: ${response.status}`;
            throw new Error(message);
        }

        if (tool.return || buttonConfig.return) {
            setStatus(resultElement, formatToolResponse(result), "success");
        } else {
            setStatus(resultElement, tool.successMessage || "Done.", "success");
        }

        for (const entry of inputs) {
            if (entry.type === "file") {
                entry.input.value = "";
            }
        }
    } catch (error) {
        console.error(error);
        setStatus(resultElement, error.message || "Tool failed.", "error");
    } finally {
        button.disabled = false;
    }
}

function getToolEntries(settings) {
    const tools = settings?.tools;

    if (!tools) {
        return [];
    }

    if (Array.isArray(tools)) {
        return tools.map((tool, index) => [tool.id || `tool-${index}`, tool]);
    }

    return Object.entries(tools);
}

function createToolPanel(toolId, tool) {
    const panel = document.createElement("div");
    panel.className = "settings-tool-panel";

    const heading = document.createElement("h4");
    heading.textContent = tool.label || formatChoiceLabel(toolId);

    const description = document.createElement("p");
    description.className = "settings-disclaimer";
    description.textContent = tool.description || "";

    const actionRow = document.createElement("div");
    actionRow.className = "settings-action-row";

    const inputs = getToolInputDefinitions(toolId, tool);
    for (const entry of inputs) {
        actionRow.appendChild(entry.wrapper);
    }

    const buttonConfig = typeof tool.button === "object" && tool.button !== null
        ? tool.button
        : { label: tool.button || tool.label };
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.textContent = buttonConfig.label || "Run";

    const result = document.createElement("p");
    result.className = "settings-action-result";
    result.role = "status";

    button.addEventListener("click", () => runTool(tool, inputs, button, result));

    actionRow.append(button, result);
    panel.append(heading);

    if (description.textContent) {
        panel.append(description);
    }

    panel.append(actionRow);
    return panel;
}

function renderTools(settings) {
    if (!settingsTools || !settingsToolsSection) return;

    settingsTools.innerHTML = "";
    const entries = getToolEntries(settings);
    settingsToolsSection.hidden = entries.length === 0;

    for (const [toolId, tool] of entries) {
        settingsTools.appendChild(createToolPanel(toolId, tool));
    }
}

function renderSettings(settings) {
    settingsGroups.innerHTML = "";

    for (const [groupName, entries] of getGroupedSettings(settings)) {
        const section = document.createElement("section");
        section.className = "settings-group";

        const heading = document.createElement("h3");
        heading.textContent = groupName;
        section.appendChild(heading);

        for (const [key, setting] of entries) {
            section.appendChild(createSettingRow(key, setting));
            applySettingPreview(key, setting.value);
        }

        settingsGroups.appendChild(section);
    }

    renderTools(settings);
}

async function loadSettingsPage() {
    try {
        currentSettings = await fetchSettings();
        renderSettings(currentSettings);
    } catch (error) {
        console.error(error);
        setStatus(saveResult, "Failed to load settings.", "error");
    }
}

loadSettingsPage();
