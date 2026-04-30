(() => {
    let settings = null;
    let tracks = [];
    const libraryState = createTrackLibraryState();
    const selectedTrackIds = new Set();
    const fakeProcessingProgress = {};
    const completedDownloadIds = new Set();
    let downloadStatusTimer = null;

    const importBtn = document.getElementById("import-button");
    const importInput = document.getElementById("import-input");
    const trackList = document.getElementById("track-list");
    const bulkSelectionSummary = document.getElementById("bulk-selection-summary");
    const bulkSelectVisibleButton = document.getElementById("bulk-select-visible-button");
    const bulkDeleteButton = document.getElementById("bulk-delete-button");
    const bulkRefreshMetadataButton = document.getElementById("bulk-refresh-metadata-button");
    const bulkRedownloadButton = document.getElementById("bulk-redownload-button");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    importBtn.addEventListener("click", importURL);
    bulkSelectVisibleButton.addEventListener("click", toggleSelectVisibleTracks);
    bulkDeleteButton.addEventListener("click", deleteSelectedTracks);
    bulkRefreshMetadataButton.addEventListener("click", refreshSelectedTrackMetadata);
    bulkRedownloadButton.addEventListener("click", redownloadSelectedTracks);

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

    function showErrorToast(message) {
        uiShowToast(message, {
            status: "error",
            timeoutMs: 7000
        });
    }

    function showBulkUndoToast(deletedTracks) {
        const toast = document.createElement("div");
        toast.className = "undo-toast";

        const message = document.createElement("p");
        message.className = "undo-toast-message";
        message.textContent = `Deleted ${deletedTracks.length} tracks.`;

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
                for (const track of deletedTracks) {
                    const response = await requestRestoreTrack(track);

                    if (!response.ok) {
                        const result = await response.json().catch(() => ({}));
                        throw new Error(result.error || `Failed to restore ${track.title || "track"}`);
                    }
                }

                await loadTracks();
                uiRemoveToast(toast);
            } catch (error) {
                console.error("Failed to restore tracks:", error);
                message.textContent = error.message || "Failed to restore tracks.";
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
            pruneSelectedTracks();
            renderTracks();
        } catch (error) {
            console.error("Error loading tracks:", error);
        }
    }

    function pruneSelectedTracks() {
        const trackIds = new Set(tracks.map(track => track.youtube_id));

        for (const selectedId of [...selectedTrackIds]) {
            if (!trackIds.has(selectedId)) {
                selectedTrackIds.delete(selectedId);
            }
        }
    }

    function updateBulkSummary() {
        const selectedCount = selectedTrackIds.size;
        const visibleTracks = getVisibleTracks(tracks, libraryState);
        const allVisibleSelected = visibleTracks.length > 0 &&
            visibleTracks.every(track => selectedTrackIds.has(track.youtube_id));

        bulkSelectionSummary.textContent = selectedCount === 1
            ? "1 track selected"
            : `${selectedCount} tracks selected`;

        bulkDeleteButton.disabled = selectedCount === 0;
        bulkRefreshMetadataButton.disabled = selectedCount === 0;
        bulkRedownloadButton.disabled = selectedCount === 0;
        bulkSelectVisibleButton.textContent = allVisibleSelected || (selectedCount > 0 && visibleTracks.length === 0)
            ? "Clear Selection"
            : "Select Visible";
    }

    function setBulkActionsBusy(isBusy) {
        bulkSelectVisibleButton.disabled = isBusy;
        bulkDeleteButton.disabled = isBusy || selectedTrackIds.size === 0;
        bulkRefreshMetadataButton.disabled = isBusy || selectedTrackIds.size === 0;
        bulkRedownloadButton.disabled = isBusy || selectedTrackIds.size === 0;
    }

    function getSelectedTrackIds() {
        return [...selectedTrackIds];
    }

    function toggleSelectVisibleTracks() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);

        if (visibleTracks.length === 0 && selectedTrackIds.size > 0) {
            selectedTrackIds.clear();
            renderTracks();
            return;
        }

        const allVisibleSelected = visibleTracks.length > 0 &&
            visibleTracks.every(track => selectedTrackIds.has(track.youtube_id));

        if (allVisibleSelected) {
            for (const track of visibleTracks) {
                selectedTrackIds.delete(track.youtube_id);
            }
        } else {
            for (const track of visibleTracks) {
                selectedTrackIds.add(track.youtube_id);
            }
        }

        renderTracks();
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
            updateBulkSummary(0);
            return;
        }

        if (visibleTracks.length === 0) {
            trackList.innerHTML = "<p>No tracks match your search or filters.</p>";
            updateBulkSummary(0);
            return;
        }

        for (const track of visibleTracks) {
            const card = createTrackCard(track, {
                editor: true,
                selectable: true,
                selected: selectedTrackIds.has(track.youtube_id)
            });
            const checkbox = card.querySelector(".track-select-checkbox");
            const deleteButton = card.querySelector(".delete-btn");

            checkbox.addEventListener("click", (event) => {
                event.stopPropagation();
            });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedTrackIds.add(track.youtube_id);
                } else {
                    selectedTrackIds.delete(track.youtube_id);
                }

                updateBulkSummary();
            });

            deleteButton.addEventListener("click", (event) => {
                event.stopPropagation();
                deleteTrack(track.youtube_id);
            });

            trackList.appendChild(card);
        }

        updateBulkSummary();
    }

    async function importURL() {
        const url = importInput.value.trim();

        if (!url) {
            showErrorToast("Please enter a URL.");
            importInput.focus();
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
            showErrorToast(error.message || "Import failed.");
        } finally {
            importBtn.disabled = false;
            importBtn.innerHTML = originalButtonHTML;
        }
    }

    async function deleteTrack(youtube_id) {
        const response = await requestDeleteTrack(youtube_id);

        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            showErrorToast(
                result.error ||
                `Failed to delete track. ${response.status}: ${response.statusText || "Unknown error"}`
            );
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

    async function deleteSelectedTracks() {
        const selectedIds = getSelectedTrackIds();

        if (!selectedIds.length) {
            showErrorToast("Select tracks first.");
            return;
        }

        setBulkActionsBusy(true);

        try {
            const result = await requestBulkDeleteTracks(selectedIds);
            const deletedTracks = result.tracks || [];

            selectedTrackIds.clear();
            tracks = tracks.filter(track => !result.deleted.includes(track.youtube_id));
            renderTracks();

            if (deletedTracks.length) {
                showBulkUndoToast(deletedTracks);
            } else {
                uiShowToast("No selected tracks were deleted.", {
                    status: "success",
                    timeoutMs: 5000
                });
            }
        } catch (error) {
            console.error("Failed to delete selected tracks:", error);
            showErrorToast(error.message || "Failed to delete selected tracks.");
        } finally {
            setBulkActionsBusy(false);
            updateBulkSummary();
        }
    }

    async function refreshSelectedTrackMetadata() {
        const selectedIds = getSelectedTrackIds();

        if (!selectedIds.length) {
            showErrorToast("Select tracks first.");
            return;
        }

        setBulkActionsBusy(true);

        try {
            const result = await requestBulkRefreshTrackMetadata(selectedIds);
            const refreshedCount = (result.refreshed || []).length;
            const failedCount = (result.failed || []).length;
            const missingCount = (result.missing || []).length;

            selectedTrackIds.clear();
            await loadTracks();

            if (failedCount > 0) {
                showErrorToast(
                    `Refreshed ${refreshedCount} track${refreshedCount === 1 ? "" : "s"}; ${failedCount} failed.`
                );
            } else {
                uiShowToast(
                    `Refreshed ${refreshedCount} track${refreshedCount === 1 ? "" : "s"}${missingCount ? `; ${missingCount} missing.` : "."}`,
                    {
                        status: "success",
                        timeoutMs: 5000
                    }
                );
            }
        } catch (error) {
            console.error("Failed to refresh selected metadata:", error);
            showErrorToast(error.message || "Failed to refresh selected metadata.");
        } finally {
            setBulkActionsBusy(false);
            updateBulkSummary();
        }
    }

    async function redownloadSelectedTracks() {
        const selectedIds = getSelectedTrackIds();

        if (!selectedIds.length) {
            showErrorToast("Select tracks first.");
            return;
        }

        setBulkActionsBusy(true);

        try {
            const result = await requestBulkRedownloadTracks(selectedIds);
            const queuedCount = result.queued_count || 0;
            const skippedCount = (result.skipped || []).length;
            const missingCount = (result.missing || []).length;

            selectedTrackIds.clear();
            renderTracks();
            startDownloadStatusPolling();
            await loadDownloadStatus();

            uiShowToast(
                `Queued ${queuedCount} track${queuedCount === 1 ? "" : "s"} for re-download${skippedCount || missingCount ? `; ${skippedCount} skipped, ${missingCount} missing.` : "."}`,
                {
                    status: "success",
                    timeoutMs: 5000
                }
            );
        } catch (error) {
            console.error("Failed to re-download selected tracks:", error);
            showErrorToast(error.message || "Failed to re-download selected tracks.");
        } finally {
            setBulkActionsBusy(false);
            updateBulkSummary();
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
