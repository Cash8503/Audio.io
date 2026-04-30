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

function settingsMatchDefault(setting) {
    if (!setting || !Object.prototype.hasOwnProperty.call(setting, "default_value")) {
        return true;
    }

    return JSON.stringify(setting.value) === JSON.stringify(setting.default_value);
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
        renderSettings(currentSettings);
        updateFaviconFromCSSVar()
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
        updateFaviconFromCSSVar()
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

    controlGroup.append(wrapper);

    if (!settingsMatchDefault(setting)) {
        const defaultButton = document.createElement("button");
        defaultButton.className = "btn setting-default-button material-symbols-rounded";
        defaultButton.type = "button";
        defaultButton.textContent = "replay";
        defaultButton.title = "Return to the default value.";
        defaultButton.addEventListener("click", () => restoreDefaultSetting(key, control, defaultButton));
        controlGroup.appendChild(defaultButton);
    }

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
