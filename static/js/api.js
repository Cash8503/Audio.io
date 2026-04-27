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

async function archiveTrack(url) {
    const response = await fetch(`/archive/${encodeURIComponent(url)}`, {
        method: "POST"
    });

    if (!response.ok) {
        return Promise.reject(new Error(`Failed to archive track: ${response.status}`));
    }

    return await response.json();
}

async function requestDeleteTrack(youtube_id) {
    const response = await fetch(`/api/audios/${youtube_id}`, {
        method: "DELETE"
    });

    return response;
}

async function requestDismissDownload(downloadId) {
    const response = await fetch(`/api/downloads/${encodeURIComponent(downloadId)}`, {
        method: "DELETE"
    });

    return response;
}
