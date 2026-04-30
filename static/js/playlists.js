(() => {
    let tracks = [];
    let playlists = [];
    let activePlaylistId = "";
    let activePlaylistTracks = [];
    const selectedTrackIds = new Set();
    const selectedPlaylistTrackIds = new Set();
    const libraryState = createTrackLibraryState();

    const playlistNameInput = document.getElementById("playlist-name-input");
    const createPlaylistButton = document.getElementById("create-playlist-button");
    const playlistStatus = document.getElementById("playlist-status");
    const playlistList = document.getElementById("playlist-list");
    const activePlaylistHeading = document.getElementById("active-playlist-heading");
    const playlistTrackList = document.getElementById("playlist-track-list");
    const playlistSelectionSummary = document.getElementById("playlist-selection-summary");
    const playlistSelectVisibleButton = document.getElementById("playlist-select-visible-button");
    const playlistAddSelectedButton = document.getElementById("playlist-add-selected-button");
    const playlistRemoveSelectedButton = document.getElementById("playlist-remove-selected-button");
    const deletePlaylistButton = document.getElementById("delete-playlist-button");
    const trackList = document.getElementById("track-list");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderLibraryTracks);

    createPlaylistButton.addEventListener("click", createPlaylistFromInput);
    playlistSelectVisibleButton.addEventListener("click", toggleSelectVisibleTracks);
    playlistAddSelectedButton.addEventListener("click", addSelectedTracks);
    playlistRemoveSelectedButton.addEventListener("click", removeSelectedPlaylistTracks);
    deletePlaylistButton.addEventListener("click", deleteActivePlaylist);

    function showToast(message, status = "success") {
        uiShowToast(message, {
            status,
            timeoutMs: status === "error" ? 7000 : 5000
        });
    }

    function showPlaylistDeleteUndoToast(deletedPlaylist) {
        const playlist = deletedPlaylist.playlist || {};
        const playlistName = playlist.name || "playlist";
        const youtubeIds = deletedPlaylist.youtube_ids || [];

        const toast = document.createElement("div");
        toast.className = "undo-toast";

        const message = document.createElement("p");
        message.className = "undo-toast-message";
        message.textContent = `Deleted ${playlistName}.`;

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
                const restoredPlaylist = await createPlaylist(playlistName);

                if (youtubeIds.length) {
                    await addTracksToPlaylist(restoredPlaylist.id, youtubeIds);
                }

                activePlaylistId = String(restoredPlaylist.id);
                await Promise.all([loadPlaylists(), loadActivePlaylist()]);
                uiRemoveToast(toast);
            } catch (error) {
                console.error("Failed to restore playlist:", error);
                message.textContent = error.message || "Failed to restore playlist.";
                undoButton.disabled = false;
                undoButton.textContent = "Retry";
            }
        });
    }

    function setPlaylistStatus(message, status) {
        setStatus(playlistStatus, message, status);
    }

    async function loadTracks() {
        tracks = await fetchTracks();
        pruneSelectedTracks();
        renderLibraryTracks();
    }

    async function loadPlaylists() {
        playlists = await fetchPlaylists();
        renderPlaylistList();
    }

    async function loadActivePlaylist() {
        if (!activePlaylistId) {
            activePlaylistTracks = [];
            renderPlaylistTracks();
            return;
        }

        const result = await fetchPlaylist(activePlaylistId);
        activePlaylistTracks = result.tracks || [];
        pruneSelectedPlaylistTracks();
        activePlaylistHeading.textContent = result.playlist.name;
        deletePlaylistButton.disabled = false;
        renderPlaylistTracks();
    }

    function renderPlaylistList() {
        playlistList.innerHTML = "";

        if (playlists.length === 0) {
            playlistList.textContent = "No playlists yet.";
            activePlaylistId = "";
            activePlaylistHeading.textContent = "Choose a Playlist";
            selectedPlaylistTrackIds.clear();
            deletePlaylistButton.disabled = true;
            renderPlaylistTracks();
            return;
        }

        if (!playlists.some(playlist => String(playlist.id) === activePlaylistId)) {
            activePlaylistId = String(playlists[0].id);
        }

        for (const playlist of playlists) {
            const button = document.createElement("button");
            button.className = "btn playlist-list-button";
            button.type = "button";
            button.textContent = `${playlist.name} (${playlist.track_count || 0})`;
            button.classList.toggle("active", String(playlist.id) === activePlaylistId);
            button.addEventListener("click", async () => {
                activePlaylistId = String(playlist.id);
                renderPlaylistList();
                await loadActivePlaylist();
            });
            playlistList.appendChild(button);
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

    function pruneSelectedPlaylistTracks() {
        const trackIds = new Set(activePlaylistTracks.map(track => track.youtube_id));

        for (const selectedId of [...selectedPlaylistTrackIds]) {
            if (!trackIds.has(selectedId)) {
                selectedPlaylistTrackIds.delete(selectedId);
            }
        }
    }

    function updateSelectionSummary() {
        const selectedCount = selectedTrackIds.size;
        const selectedPlaylistCount = selectedPlaylistTrackIds.size;
        const visibleTracks = getVisibleTracks(tracks, libraryState);
        const allVisibleSelected = visibleTracks.length > 0 &&
            visibleTracks.every(track => selectedTrackIds.has(track.youtube_id));

        playlistSelectionSummary.textContent = [
            selectedCount === 1
                ? "1 library track selected"
                : `${selectedCount} library tracks selected`,
            selectedPlaylistCount === 1
                ? "1 playlist track selected"
                : `${selectedPlaylistCount} playlist tracks selected`
        ].join(" / ");
        playlistAddSelectedButton.disabled = selectedCount === 0 || !activePlaylistId;
        playlistRemoveSelectedButton.disabled = selectedPlaylistCount === 0 || !activePlaylistId;
        playlistSelectVisibleButton.textContent = allVisibleSelected || (selectedCount > 0 && visibleTracks.length === 0)
            ? "Clear Selection"
            : "Select Visible";
    }

    function toggleSelectVisibleTracks() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);

        if (visibleTracks.length === 0 && selectedTrackIds.size > 0) {
            selectedTrackIds.clear();
            renderLibraryTracks();
            return;
        }

        const allVisibleSelected = visibleTracks.length > 0 &&
            visibleTracks.every(track => selectedTrackIds.has(track.youtube_id));

        for (const track of visibleTracks) {
            if (allVisibleSelected) {
                selectedTrackIds.delete(track.youtube_id);
            } else {
                selectedTrackIds.add(track.youtube_id);
            }
        }

        renderLibraryTracks();
    }

    function renderLibraryTracks() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);
        trackList.innerHTML = "";
        updateTrackResultsSummary(resultsSummary, visibleTracks.length, tracks.length);

        if (tracks.length === 0) {
            trackList.textContent = "No tracks imported yet.";
            updateSelectionSummary();
            return;
        }

        if (visibleTracks.length === 0) {
            trackList.textContent = "No tracks match your search or filters.";
            updateSelectionSummary();
            return;
        }

        for (const track of visibleTracks) {
            const card = createTrackCard(track, {
                selectable: true,
                selected: selectedTrackIds.has(track.youtube_id),
                idPrefix: "playlist-library-"
            });
            const checkbox = card.querySelector(".track-select-checkbox");

            checkbox.addEventListener("click", (event) => {
                event.stopPropagation();
            });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedTrackIds.add(track.youtube_id);
                } else {
                    selectedTrackIds.delete(track.youtube_id);
                }

                updateSelectionSummary();
            });

            trackList.appendChild(card);
        }

        updateSelectionSummary();
    }

    function renderPlaylistTracks() {
        playlistTrackList.innerHTML = "";

        if (!activePlaylistId) {
            playlistTrackList.textContent = "Choose a playlist to manage its tracks.";
            selectedPlaylistTrackIds.clear();
            updateSelectionSummary();
            return;
        }

        if (activePlaylistTracks.length === 0) {
            playlistTrackList.textContent = "This playlist has no tracks yet.";
            selectedPlaylistTrackIds.clear();
            updateSelectionSummary();
            return;
        }

        for (const track of activePlaylistTracks) {
            const card = createTrackCard(track, {
                editor: true,
                selectable: true,
                selected: selectedPlaylistTrackIds.has(track.youtube_id),
                idPrefix: "playlist-track-"
            });
            const checkbox = card.querySelector(".track-select-checkbox");
            const removeButton = card.querySelector(".delete-btn");

            checkbox.addEventListener("click", (event) => {
                event.stopPropagation();
            });

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedPlaylistTrackIds.add(track.youtube_id);
                } else {
                    selectedPlaylistTrackIds.delete(track.youtube_id);
                }

                updateSelectionSummary();
            });

            removeButton.textContent = "Remove";
            removeButton.addEventListener("click", () => removePlaylistTrack(track.youtube_id));
            playlistTrackList.appendChild(card);
        }

        updateSelectionSummary();
    }

    async function createPlaylistFromInput() {
        const name = playlistNameInput.value.trim();

        if (!name) {
            setPlaylistStatus("Enter a playlist name.", "error");
            playlistNameInput.focus();
            return;
        }

        createPlaylistButton.disabled = true;
        setPlaylistStatus("Creating playlist...");

        try {
            const playlist = await createPlaylist(name);
            playlistNameInput.value = "";
            activePlaylistId = String(playlist.id);
            await loadPlaylists();
            await loadActivePlaylist();
            setPlaylistStatus(`Created ${playlist.name}.`, "success");
        } catch (error) {
            console.error("Failed to create playlist:", error);
            setPlaylistStatus(error.message || "Failed to create playlist.", "error");
        } finally {
            createPlaylistButton.disabled = false;
        }
    }

    async function addSelectedTracks() {
        if (!activePlaylistId) {
            showToast("Choose a playlist first.", "error");
            return;
        }

        const selectedIds = [...selectedTrackIds];

        if (!selectedIds.length) {
            showToast("Select tracks first.", "error");
            return;
        }

        playlistAddSelectedButton.disabled = true;

        try {
            const result = await addTracksToPlaylist(activePlaylistId, selectedIds);
            selectedTrackIds.clear();
            selectedPlaylistTrackIds.clear();
            await Promise.all([loadPlaylists(), loadActivePlaylist()]);
            renderLibraryTracks();
            showToast(`Added ${result.added} tracks to playlist.`);
        } catch (error) {
            console.error("Failed to add tracks:", error);
            showToast(error.message || "Failed to add tracks.", "error");
        } finally {
            playlistAddSelectedButton.disabled = false;
            updateSelectionSummary();
        }
    }

    async function removePlaylistTrack(youtubeId) {
        if (!activePlaylistId) return;

        try {
            await removeTrackFromPlaylist(activePlaylistId, youtubeId);
            selectedPlaylistTrackIds.delete(youtubeId);
            await Promise.all([loadPlaylists(), loadActivePlaylist()]);
            showToast("Track removed from playlist.");
        } catch (error) {
            console.error("Failed to remove track:", error);
            showToast(error.message || "Failed to remove track.", "error");
        }
    }

    async function removeSelectedPlaylistTracks() {
        if (!activePlaylistId) return;

        const selectedIds = [...selectedPlaylistTrackIds];

        if (!selectedIds.length) {
            showToast("Select playlist tracks first.", "error");
            return;
        }

        playlistRemoveSelectedButton.disabled = true;

        try {
            for (const youtubeId of selectedIds) {
                await removeTrackFromPlaylist(activePlaylistId, youtubeId);
            }

            selectedPlaylistTrackIds.clear();
            await Promise.all([loadPlaylists(), loadActivePlaylist()]);
            showToast(`Removed ${selectedIds.length} track${selectedIds.length === 1 ? "" : "s"} from playlist.`);
        } catch (error) {
            console.error("Failed to remove selected tracks:", error);
            showToast(error.message || "Failed to remove selected tracks.", "error");
        } finally {
            playlistRemoveSelectedButton.disabled = false;
            updateSelectionSummary();
        }
    }

    async function deleteActivePlaylist() {
        if (!activePlaylistId) return;

        deletePlaylistButton.disabled = true;

        try {
            const deletedPlaylist = await deletePlaylist(activePlaylistId);
            activePlaylistId = "";
            activePlaylistTracks = [];
            selectedPlaylistTrackIds.clear();
            await loadPlaylists();
            await loadActivePlaylist();
            showPlaylistDeleteUndoToast(deletedPlaylist);
        } catch (error) {
            console.error("Failed to delete playlist:", error);
            showToast(error.message || "Failed to delete playlist.", "error");
        } finally {
            deletePlaylistButton.disabled = !activePlaylistId;
        }
    }

    async function startPage() {
        try {
            await Promise.all([loadTracks(), loadPlaylists()]);
            await loadActivePlaylist();
        } catch (error) {
            console.error("Failed to start playlists page:", error);
            setPlaylistStatus("Failed to load playlists.", "error");
        }
    }

    startPage();
})();
