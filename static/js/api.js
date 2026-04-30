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

async function fetchPlaylists() {
    const response = await fetch("/api/playlists");

    if (!response.ok) {
        throw new Error(`Failed to load playlists: ${response.status}`);
    }

    return await response.json();
}

async function fetchPlaylist(playlistId) {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`);
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to load playlist: ${response.status}`);
    }

    return result;
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

async function requestBulkDeleteTracks(youtubeIds) {
    const response = await fetch("/api/audios/bulk-delete", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ youtube_ids: youtubeIds })
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to delete tracks: ${response.status}`);
    }

    return result;
}

async function requestBulkRefreshTrackMetadata(youtubeIds) {
    const response = await fetch("/api/audios/bulk-refresh-metadata", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ youtube_ids: youtubeIds })
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to refresh metadata: ${response.status}`);
    }

    return result;
}

async function requestBulkRedownloadTracks(youtubeIds) {
    const response = await fetch("/api/audios/bulk-redownload", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ youtube_ids: youtubeIds })
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to re-download tracks: ${response.status}`);
    }

    return result;
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

async function createPlaylist(name) {
    const response = await fetch("/api/playlists", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ name })
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to create playlist: ${response.status}`);
    }

    return result.playlist;
}

async function deletePlaylist(playlistId) {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}`, {
        method: "DELETE"
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to delete playlist: ${response.status}`);
    }

    return result;
}

async function addTracksToPlaylist(playlistId, youtubeIds) {
    const response = await fetch(`/api/playlists/${encodeURIComponent(playlistId)}/tracks`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ youtube_ids: youtubeIds })
    });
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to add tracks: ${response.status}`);
    }

    return result;
}

async function removeTrackFromPlaylist(playlistId, youtubeId) {
    const response = await fetch(
        `/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(youtubeId)}`,
        { method: "DELETE" }
    );
    const result = await parseJsonResponse(response);

    if (!response.ok) {
        throw new Error(result.error || `Failed to remove track: ${response.status}`);
    }

    return result;
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
