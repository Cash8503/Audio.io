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

async function requestDismissDownload(downloadId) {
    const response = await fetch(`/api/downloads/${encodeURIComponent(downloadId)}`, {
        method: "DELETE"
    });

    return response;
}
