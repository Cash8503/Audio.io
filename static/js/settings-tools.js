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
