(() => {
    const tracks = [];
    const libraryState = createTrackLibraryState();
    let queue = [];
    let shuffledTrackIds = [];
    let currentIndex = 0;
    let currentlyPlayingId = null;
    let isShuffled = false;

    const audioPlayer = document.getElementById("audio-player");
    const nowPlayingTitle = document.getElementById("now-playing-title");
    const nowPlayingUploader = document.getElementById("now-playing-uploader");
    const nowPlayingThumbnail = document.getElementById("now-playing-thumbnail");
    const shuffleBtn = document.getElementById("shuffle-button");
    const previousTrackBtn = document.getElementById("prev-button");
    const nextTrackBtn = document.getElementById("next-button");
    const trackList = document.getElementById("track-list");
    const refreshMetadataButton = document.getElementById("refresh-metadata-button");
    const metadataStatus = document.getElementById("metadata-status");
    const metadataDuration = document.getElementById("metadata-duration");
    const metadataCreated = document.getElementById("metadata-created");
    const metadataRefreshed = document.getElementById("metadata-refreshed");
    const metadataQuality = document.getElementById("metadata-quality");
    const metadataBitrate = document.getElementById("metadata-bitrate");
    const metadataFiles = document.getElementById("metadata-files");
    const metadataDescription = document.getElementById("metadata-description");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    shuffleBtn.addEventListener("click", toggleShuffle);
    previousTrackBtn.addEventListener("click", playPreviousTrack);
    nextTrackBtn.addEventListener("click", playNextTrack);
    refreshMetadataButton.addEventListener("click", refreshCurrentTrackMetadata);

    audioPlayer.addEventListener("play", () => {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
        }
    });

    audioPlayer.addEventListener("pause", () => {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }
    });

    audioPlayer.addEventListener("ended", () => {
        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "none";
        }

        playNextTrack();
    });

    function updateActiveCard() {
        document.querySelectorAll(".audio-card").forEach(card => {
            card.classList.remove("active");
        });

        if (!currentlyPlayingId) return;

        const currentTrackCard = document.getElementById(currentlyPlayingId);

        if (currentTrackCard) {
            currentTrackCard.classList.add("active");
        }
    }

    function shuffleArray(items) {
        const shuffled = [...items];

        for (let i = shuffled.length - 1; i > 0; i--) {
            const randomIndex = Math.floor(Math.random() * (i + 1));
            const temp = shuffled[i];
            shuffled[i] = shuffled[randomIndex];
            shuffled[randomIndex] = temp;
        }

        return shuffled;
    }

    function getCurrentTrack() {
        if (!currentlyPlayingId) {
            return null;
        }

        return tracks.find(track => track.youtube_id === currentlyPlayingId) || null;
    }

    function formatDateTime(value) {
        if (!value) {
            return "Not recorded";
        }

        const normalizedValue = String(value).includes("T")
            ? String(value)
            : String(value).replace(" ", "T");
        const date = new Date(normalizedValue);

        if (Number.isNaN(date.getTime())) {
            return String(value);
        }

        return date.toLocaleString();
    }

    function getQualityText(track) {
        const requestedQuality = track.requested_audio_quality
            ? `${track.requested_audio_quality} kbps requested`
            : "Request unknown";
        const actualQuality = track.audio_quality
            ? `${track.audio_quality} kbps actual`
            : "Actual unknown";

        return `${requestedQuality} / ${actualQuality}`;
    }

    function getFileStatusText(track) {
        const audioStatus = track.audio_file_exists ? "audio ok" : "audio missing";
        const thumbnailStatus = track.thumbnail_file_exists ? "thumbnail ok" : "thumbnail missing";

        return `${audioStatus}, ${thumbnailStatus}`;
    }

    function setMetadataStatus(message, status) {
        setStatus(metadataStatus, message, status);
    }

    function renderTrackMetadata(track) {
        if (!track) {
            refreshMetadataButton.disabled = true;
            setMetadataStatus("Choose a track to view details.");
            metadataDuration.textContent = "-";
            metadataCreated.textContent = "-";
            metadataRefreshed.textContent = "-";
            metadataQuality.textContent = "-";
            metadataBitrate.textContent = "-";
            metadataFiles.textContent = "-";
            metadataDescription.textContent = "";
            return;
        }

        refreshMetadataButton.disabled = false;
        setMetadataStatus(`Showing details for ${track.title || "selected track"}.`);
        metadataDuration.textContent = durationToReadable(track.duration) || "Unknown";
        metadataCreated.textContent = formatDateTime(track.created_at);
        metadataRefreshed.textContent = formatDateTime(track.metadata_refreshed_at);
        metadataQuality.textContent = getQualityText(track);
        metadataBitrate.textContent = track.audio_bitrate
            ? `${track.audio_bitrate} kbps`
            : "Unknown";
        metadataFiles.textContent = getFileStatusText(track);
        metadataDescription.textContent = track.description || "No description saved.";
    }

    function rebuildQueue() {
        const visibleTracks = getVisibleTracks(tracks, libraryState);

        if (!isShuffled) {
            queue = visibleTracks;
            shuffledTrackIds = [];
            syncCurrentIndexToQueue();
            return;
        }

        const trackMap = new Map(visibleTracks.map(track => [track.youtube_id, track]));
        const remainingIds = visibleTracks.map(track => track.youtube_id);
        const preservedIds = shuffledTrackIds.filter(id => trackMap.has(id));
        const missingIds = remainingIds.filter(id => !preservedIds.includes(id));

        shuffledTrackIds = [...preservedIds, ...shuffleArray(missingIds)];

        if (currentlyPlayingId && trackMap.has(currentlyPlayingId)) {
            shuffledTrackIds = [
                currentlyPlayingId,
                ...shuffledTrackIds.filter(id => id !== currentlyPlayingId)
            ];
        }

        queue = shuffledTrackIds
            .map(id => trackMap.get(id))
            .filter(Boolean);

        syncCurrentIndexToQueue();
    }

    function syncCurrentIndexToQueue() {
        if (queue.length === 0) {
            currentIndex = 0;
            return;
        }

        const currentTrackIndex = queue.findIndex(track => track.youtube_id === currentlyPlayingId);

        if (currentTrackIndex !== -1) {
            currentIndex = currentTrackIndex;
            return;
        }

        if (currentIndex >= queue.length) {
            currentIndex = 0;
        }
    }

    async function loadTracks() {
        try {
            const fetchedTracks = await fetchTracks();
            tracks.length = 0;
            tracks.push(...fetchedTracks);
            renderTracks();
        } catch (error) {
            console.error("Error loading tracks:", error);
        }
    }

    function renderTracks() {
        rebuildQueue();
        trackList.innerHTML = "";
        updateTrackResultsSummary(resultsSummary, queue.length, tracks.length);

        if (tracks.length === 0) {
            trackList.innerHTML = "<p>No tracks archived yet.</p>";
            renderTrackMetadata(null);
            return;
        }

        if (queue.length === 0) {
            trackList.innerHTML = "<p>No tracks match your search or filters.</p>";
            renderTrackMetadata(getCurrentTrack());
            return;
        }

        for (const track of queue) {
            const card = createTrackCard(track);

            card.addEventListener("click", () => {
                playTrack(track);
            });

            trackList.appendChild(card);
        }

        updateActiveCard();
        renderTrackMetadata(getCurrentTrack());
    }

    function playTrack(track) {
        const queueIndex = queue.findIndex(item => item.youtube_id === track.youtube_id);

        if (queueIndex !== -1) {
            currentIndex = queueIndex;
        }

        currentlyPlayingId = track.youtube_id;

        audioPlayer.src = audioUrl(track);
        nowPlayingThumbnail.src = thumbnailUrl(track);
        nowPlayingThumbnail.style.display = "block";
        nowPlayingTitle.textContent = track.title || "Unknown title";
        nowPlayingUploader.textContent = track.uploader || "Unknown uploader";
        renderTrackMetadata(track);
        updateMediaSession(track);
        updateActiveCard();
        audioPlayer.play();
    }

    function playNextTrack() {
        if (queue.length === 0) return;

        const currentTrack = queue[currentIndex] || queue[0];

        if (!currentTrack) {
            return;
        }

        const expectedSrc = audioUrl(currentTrack);

        if (!audioPlayer.src || !audioPlayer.src.includes(expectedSrc)) {
            playTrack(currentTrack);
            return;
        }

        if (currentIndex < queue.length - 1) {
            currentIndex++;
        } else {
            currentIndex = 0;
        }

        playTrack(queue[currentIndex]);
    }

    function playPreviousTrack() {
        if (queue.length === 0) return;

        if (currentIndex > 0) {
            currentIndex--;
        } else {
            currentIndex = queue.length - 1;
        }

        playTrack(queue[currentIndex]);
    }

    function toggleShuffle() {
        isShuffled = !isShuffled;
        shuffleBtn.textContent = isShuffled ? "Unshuffle" : "Shuffle";

        if (isShuffled) {
            shuffledTrackIds = [];
        }

        renderTracks();
    }

    function updateMediaSession(track) {
        if (!("mediaSession" in navigator)) return;

        navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title || "Unknown title",
            artist: track.uploader || "Unknown uploader",
            album: "Audio.io",
            artwork: [
                {
                    src: track.thumbnail_data || thumbnailUrl(track),
                    sizes: "512x512",
                    type: "image/jpeg"
                }
            ]
        });

        navigator.mediaSession.setActionHandler("play", () => {
            audioPlayer.play();
        });

        navigator.mediaSession.setActionHandler("pause", () => {
            audioPlayer.pause();
        });

        navigator.mediaSession.setActionHandler("nexttrack", () => {
            playNextTrack();
        });

        navigator.mediaSession.setActionHandler("previoustrack", () => {
            playPreviousTrack();
        });
    }

    async function refreshCurrentTrackMetadata() {
        const track = getCurrentTrack();

        if (!track) {
            return;
        }

        refreshMetadataButton.disabled = true;
        setMetadataStatus("Refreshing metadata...");

        try {
            const response = await requestRefreshTrackMetadata(track.youtube_id);
            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(result.error || `Failed to refresh metadata: ${response.status}`);
            }

            const refreshedTrack = result.track;
            const trackIndex = tracks.findIndex(item => item.youtube_id === refreshedTrack.youtube_id);

            if (trackIndex !== -1) {
                tracks[trackIndex] = refreshedTrack;
            }

            if (currentlyPlayingId === refreshedTrack.youtube_id) {
                nowPlayingTitle.textContent = refreshedTrack.title || "Unknown title";
                nowPlayingUploader.textContent = refreshedTrack.uploader || "Unknown uploader";
                nowPlayingThumbnail.src = thumbnailUrl(refreshedTrack);
                updateMediaSession(refreshedTrack);
            }

            renderTracks();
            setMetadataStatus("Metadata refreshed.", "success");
        } catch (error) {
            console.error("Failed to refresh metadata:", error);
            setMetadataStatus(error.message || "Failed to refresh metadata.", "error");
        } finally {
            refreshMetadataButton.disabled = getCurrentTrack() === null;
        }
    }

    loadTracks();
})();
