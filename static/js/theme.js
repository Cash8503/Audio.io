fetchSettings()
    .then(applyThemeSettings)
    .catch(error => {
        console.error("Failed to apply theme settings:", error);
    });
