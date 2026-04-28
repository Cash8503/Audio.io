(() => {
    let settings = null;
    let tracks = [];
    const libraryState = createTrackLibraryState();
    const fakeProcessingProgress = {};
    const completedDownloadIds = new Set();
    let downloadStatusTimer = null;

    const importBtn = document.getElementById("import-button");
    const importInput = document.getElementById("import-input");
    const trackList = document.getElementById("track-list");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    importBtn.addEventListener("click", importURL);

    function getDisplayPercent(item) {
        const id = item.id;
        const status = item.status;

        if (["queued", "starting", "downloading"].includes(status)) {
            delete fakeProcessingProgress[id];
            completedDownloadIds.delete(id);
            return item.percent || 0;
        }

        if (status === "finished" || status === "processing") {
            if (fakeProcessingProgress[id] === undefined) {
                fakeProcessingProgress[id] = 75;
            }

            if (fakeProcessingProgress[id] < 99) {
                fakeProcessingProgress[id] += 0.5 + Math.random() * 1.5;
            }

            fakeProcessingProgress[id] = Math.min(99, Math.round(fakeProcessingProgress[id]));
            return fakeProcessingProgress[id];
        }

        if (status === "complete") {
            fakeProcessingProgress[id] = 100;
            return 100;
        }

        return item.percent || 0;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function showUndoToast(track) {
        const toast = document.createElement("div");
        toast.className = "undo-toast";

        const message = document.createElement("p");
        message.className = "undo-toast-message";
        message.textContent = `Deleted ${track.title || "track"}.`;

        const undoButton = document.createElement("button");
        undoButton.className = "btn undo-toast-button";
        undoButton.type = "button";
        undoButton.textContent = "Undo";

        const closeButton = document.createElement("button");
        closeButton.className = "undo-toast-close";
        closeButton.type = "button";
        closeButton.textContent = "x";
        closeButton.setAttribute("aria-label", "Dismiss undo message");

        toast.append(message, undoButton, closeButton);
        uiAddToast(toast, { maxToasts: 3 });

        const timeoutId = setTimeout(() => uiRemoveToast(toast), 8000);

        closeButton.addEventListener("click", () => {
            clearTimeout(timeoutId);
            uiRemoveToast(toast);
        });

        undoButton.addEventListener("click", async () => {
            clearTimeout(timeoutId);
            undoButton.disabled = true;
            undoButton.textContent = "Restoring...";

            try {
                const response = await requestRestoreTrack(track);

                if (!response.ok) {
                    const result = await response.json().catch(() => ({}));
                    throw new Error(result.error || `Failed to restore track: ${response.status}`);
                }

                await loadTracks();
                uiRemoveToast(toast);
            } catch (error) {
                console.error("Failed to restore track:", error);
                message.textContent = error.message || "Failed to restore track.";
                undoButton.disabled = false;
                undoButton.textContent = "Retry";
            }
        });
    }

    function startDownloadStatusPolling() {
        if (downloadStatusTimer !== null) return;

        loadDownloadStatus();
        downloadStatusTimer = setInterval(loadDownloadStatus, 1500);
    }

    async function loadDownloadStatus() {
        try {
            const downloads = await fetchDownloadStatus();
            renderDownloads(downloads);
        } catch (error) {
            console.error("Failed to load download status:", error);
        }
    }

    async function loadTracks() {
        try {
            tracks = await fetchTracks();
            renderTracks();
        } catch (error) {
            console.error("Error loading tracks:", error);
        }
    }

    function renderDownloads(downloads) {
        let shouldReloadTracks = false;

        for (const item of downloads) {
            if (item.status === "complete" && !completedDownloadIds.has(item.id)) {
                completedDownloadIds.add(item.id);
                shouldReloadTracks = true;
            }
        }

        if (shouldReloadTracks) {
            loadTracks();
        }

        uiRenderDownloads(downloads, {
            getDisplayPercent,
            onDismiss: dismissDownload
        });
    }

    async function waitForNewDownloadStatus(existingDownloadIds) {
        const timeoutMs = 30000;
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const downloads = await fetchDownloadStatus();
            renderDownloads(downloads);

            const hasNewDownload = downloads.some(item => !existingDownloadIds.has(item.id));

            if (hasNewDownload) {
                return;
            }

            await delay(500);
        }
    }

    function renderTracks() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);
        trackList.innerHTML = "";
        updateTrackResultsSummary(resultsSummary, visibleTracks.length, tracks.length);

        if (tracks.length === 0) {
            trackList.innerHTML = "<p>No tracks imported yet.</p>";
            return;
        }

        if (visibleTracks.length === 0) {
            trackList.innerHTML = "<p>No tracks match your search or filters.</p>";
            return;
        }

        for (const track of visibleTracks) {
            const card = createTrackCard(track, { editor: true });
            const deleteButton = card.querySelector(".delete-btn");

            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                deleteTrack(track.youtube_id);
            });

            trackList.appendChild(card);
        }
    }

    async function importURL() {
        const url = importInput.value.trim();

        if (!url) {
            alert("Please enter a URL.");
            return;
        }

        importInput.value = "";

        const originalButtonHTML = importBtn.innerHTML;

        importBtn.disabled = true;
        importBtn.innerHTML = `<span class="spinner"></span>Importing...`;

        try {
            const existingDownloads = await fetchDownloadStatus();
            const existingDownloadIds = new Set(existingDownloads.map(item => item.id));

            await importTrack(url);
            await waitForNewDownloadStatus(existingDownloadIds);
        } catch (error) {
            console.error("Import failed:", error);
            alert(error.message || "Import failed.");
        } finally {
            importBtn.disabled = false;
            importBtn.innerHTML = originalButtonHTML;
        }
    }

    async function deleteTrack(youtube_id) {
        const response = await requestDeleteTrack(youtube_id);

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            alert(result.error || "Failed to delete track. " + response.status + ": " + (response.statusText || "Unknown error"));
            return;
        }

        const result = await response.json();
        const deletedTrack = result.track || tracks.find(track => track.youtube_id === youtube_id);

        tracks = tracks.filter(track => track.youtube_id !== youtube_id);
        delete fakeProcessingProgress[youtube_id];
        completedDownloadIds.delete(youtube_id);
        renderTracks();

        if (deletedTrack) {
            showUndoToast(deletedTrack);
        }
    }

    async function dismissDownload(downloadId) {
        const response = await requestDismissDownload(downloadId);

        if (response.status === 404) {
            loadDownloadStatus();
            return;
        }

        if (!response.ok) {
            console.error("Failed to dismiss download:", response.status);
            return;
        }

        loadDownloadStatus();
    }

    async function startPage() {
        try {
            settings = await fetchSettings();
            await loadTracks();
            startDownloadStatusPolling();
        } catch (error) {
            console.error("Failed to start downloads page:", error);
        }
    }

    startPage();
})();
