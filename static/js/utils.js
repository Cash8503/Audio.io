function parseDurationSeconds(value) {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : 0;
    }

    const text = String(value || "").trim();

    if (!text) {
        return 0;
    }

    if (/^\d+(\.\d+)?$/.test(text)) {
        return Number(text);
    }

    const parts = text.split(":").map(part => Number(part.trim()));

    if (
        parts.length < 2 ||
        parts.length > 3 ||
        parts.some(part => !Number.isFinite(part) || part < 0)
    ) {
        return 0;
    }

    if (parts.length === 2) {
        const [minutes, seconds] = parts;
        return (minutes * 60) + seconds;
    }

    const [hours, minutes, seconds] = parts;
    return (hours * 3600) + (minutes * 60) + seconds;
}

function durationToReadable(duration) {
    duration = Math.floor(parseDurationSeconds(duration));

    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;

    const paddedMinutes = String(minutes).padStart(2, "0");
    const paddedSeconds = String(seconds).padStart(2, "0");

    if (hours > 0) {
        return hours + ":" + paddedMinutes + ":" + paddedSeconds;
    }

    return minutes + ":" + paddedSeconds;
}

function capitalize(text) {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function thumbnailUrl(trackOrId) {
    const id = typeof trackOrId === "string" ? trackOrId : trackOrId.youtube_id;
    const cacheKey = typeof trackOrId === "object" && trackOrId !== null
        ? trackOrId.metadata_refreshed_at
        : "";
    const cacheSuffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";

    return `/thumbnail/${id}.jpg${cacheSuffix}`;
}

function audioUrl(trackOrId) {
    const id = typeof trackOrId === "string" ? trackOrId : trackOrId.youtube_id;
    return `/audio/${id}.mp3`;
}

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

function applyThemeSettings(settings) {
    const accentColor = settings?.accent_color?.value;
    const themeSetting = settings?.theme?.value || "auto";
    document.documentElement.setAttribute("data-theme", resolveTheme(themeSetting));

    if (accentColor) {
        const parsedColor = parseColorValue(accentColor);

        if (parsedColor) {
            document.documentElement.style.setProperty("--accent", parsedColor);
        }
    }
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

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
