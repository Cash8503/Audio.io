(() => {
    const ARCHIVE_REQUEST_PREFIX = "archive-request-";
    let settings = null;
    let tracks = [];
    const libraryState = createTrackLibraryState();
    const fakeProcessingProgress = {};
    const completedDownloadIds = new Set();
    let downloadStatusTimer = null;

    const archiveBtn = document.getElementById("archive-button");
    const archiveInput = document.getElementById("archive-input");
    const trackList = document.getElementById("track-list");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    archiveBtn.addEventListener("click", archiveURL);

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

    function isArchiveRequest(itemOrId) {
        const id = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
        return typeof id === "string" && id.startsWith(ARCHIVE_REQUEST_PREFIX);
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function dismissArchiveRequest(requestId) {
        const response = await requestDismissDownload(requestId);

        if (!response.ok && response.status !== 404) {
            console.error("Failed to dismiss archive request:", response.status);
        }
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
        const visibleDownloads = downloads.filter(item => !isArchiveRequest(item));
        let shouldReloadTracks = false;

        for (const item of visibleDownloads) {
            if (item.status === "complete" && !completedDownloadIds.has(item.id)) {
                completedDownloadIds.add(item.id);
                shouldReloadTracks = true;
            }
        }

        if (shouldReloadTracks) {
            loadTracks();
        }

        uiRenderDownloads(visibleDownloads, {
            getDisplayPercent,
            onDismiss: dismissDownload
        });
    }

    async function waitForArchiveStatus(requestId, existingDownloadIds) {
        const timeoutMs = 15000;
        const startedAt = Date.now();

        while (Date.now() - startedAt < timeoutMs) {
            const downloads = await fetchDownloadStatus();
            const requestStatus = downloads.find(item => item.id === requestId);
            const hasNewDownload = downloads.some(item =>
                !isArchiveRequest(item) && !existingDownloadIds.has(item.id)
            );

            renderDownloads(downloads);

            if (requestStatus?.status === "error") {
                await dismissArchiveRequest(requestId);
                throw new Error(requestStatus.error || "Archive failed.");
            }

            if (hasNewDownload || requestStatus?.status === "complete") {
                await dismissArchiveRequest(requestId);
                return;
            }

            await delay(400);
        }

        await dismissArchiveRequest(requestId);
        throw new Error("Import started, but no download status appeared yet.");
    }

    function renderTracks() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);
        trackList.innerHTML = "";
        updateTrackResultsSummary(resultsSummary, visibleTracks.length, tracks.length);

        if (tracks.length === 0) {
            trackList.innerHTML = "<p>No tracks archived yet.</p>";
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

    async function archiveURL() {
        const url = archiveInput.value.trim();

        if (!url) {
            alert("Please enter a URL.");
            return;
        }

        archiveInput.value = "";

        const originalButtonHTML = archiveBtn.innerHTML;

        archiveBtn.disabled = true;
        archiveBtn.innerHTML = `<span class="spinner"></span>Importing...`;

        try {
            const existingDownloads = await fetchDownloadStatus();
            const existingDownloadIds = new Set(
                existingDownloads
                    .filter(item => !isArchiveRequest(item))
                    .map(item => item.id)
            );
            const result = await archiveTrack(url);

            await waitForArchiveStatus(result.request_id, existingDownloadIds);
        } catch (error) {
            console.error("Archive failed:", error);
            alert(error.message || "Archive failed.");
        } finally {
            archiveBtn.disabled = false;
            archiveBtn.innerHTML = originalButtonHTML;
        }
    }

    async function deleteTrack(youtube_id) {
        const confirmation = confirm("Are you sure you want to delete this track? This action cannot be undone.");

        if (!confirmation) {
            return;
        }

        const response = await requestDeleteTrack(youtube_id);

        if (!response.ok) {
            alert("Failed to delete track. " + response.status + ": " + (response.statusText || "Unknown error"));
            return;
        }

        tracks = tracks.filter(track => track.youtube_id !== youtube_id);
        delete fakeProcessingProgress[youtube_id];
        completedDownloadIds.delete(youtube_id);
        renderTracks();
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
