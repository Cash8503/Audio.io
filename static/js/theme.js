function getResolvedTheme(themeSetting) {
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
    const resolvedTheme = getResolvedTheme(themeSetting);
    document.documentElement.setAttribute("data-theme", resolvedTheme);

    if (accentColor) {
        document.documentElement.style.setProperty("--accent", accentColor);
    }
}

fetchSettings()
    .then(applyThemeSettings)
    .catch(error => {
        console.error("Failed to apply theme settings:", error);
    });
