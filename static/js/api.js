async function parseJsonResponse(response) {
    return await response.json().catch(() => ({}));
}

async function fetchSettings() {
    const response = await fetch("/api/settings");

    if (!response.ok) {
        throw new Error(`Failed to load settings: ${response.status}`);
    }

    return await response.json();
}

async function fetchTracks() {
    const response = await fetch("/api/audios");

    if (!response.ok) {
        throw new Error(`Failed to load tracks: ${response.status}`);
    }

    return await response.json();
}

async function fetchDownloadStatus() {
    const response = await fetch("/api/downloads");

    if (!response.ok) {
        throw new Error(`Failed to load download status: ${response.status}`);
    }

    return await response.json();
}

async function importTrack(url) {
    const response = await fetch("/api/import", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ url })
    });

    const result = await response.json();

    if (!response.ok) {
        throw new Error(result.error || `Failed to import track: ${response.status}`);
    }

    return result;
}

async function saveSettings(updates) {
    const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(updates)
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to save settings: ${response.status}`);
    }

    return result;
}

async function resetSettingToDefault(key) {
    const response = await fetch(`/api/settings/${encodeURIComponent(key)}/default`, {
        method: "POST"
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to restore default: ${response.status}`);
    }

    return result;
}

async function requestDeleteTrack(youtube_id) {
    const response = await fetch(`/api/audios/${encodeURIComponent(youtube_id)}`, {
        method: "DELETE"
    });

    return response;
}

async function requestRestoreTrack(track) {
    const response = await fetch(`/api/audios/${encodeURIComponent(track.youtube_id)}/restore`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ track })
    });

    return response;
}

async function requestRefreshTrackMetadata(youtubeId) {
    const response = await fetch(`/api/audios/${encodeURIComponent(youtubeId)}/refresh-metadata`, {
        method: "POST"
    });

    return response;
}

async function requestDismissDownload(downloadId) {
    const response = await fetch(`/api/downloads/${encodeURIComponent(downloadId)}`, {
        method: "DELETE"
    });

    return response;
}
