var settingsGroups = document.getElementById("settings-groups");
var saveResult = document.getElementById("settings-save-result");
var settingsToolsSection = document.getElementById("settings-tools-section");
var settingsTools = document.getElementById("settings-tools");

var currentSettings = null;

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
