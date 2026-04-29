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
    const playPauseBtn = document.getElementById("play-pause-button");
    const nextTrackBtn = document.getElementById("next-button");
    const playerCurrentTime = document.getElementById("player-current-time");
    const playerDuration = document.getElementById("player-duration");
    const playerSeek = document.getElementById("player-seek");
    const volumeButton = document.getElementById("volume-button");
    const playerVolume = document.getElementById("player-volume");
    const trackList = document.getElementById("track-list");
    const metadataPanel = document.getElementById("track-metadata-panel");
    const metadataToggleButton = document.getElementById("metadata-toggle-button");
    const metadataDetails = document.getElementById("metadata-details");
    const refreshMetadataButton = document.getElementById("refresh-metadata-button");
    const metadataStatus = document.getElementById("metadata-status");
    const metadataDuration = document.getElementById("metadata-duration");
    const metadataCreated = document.getElementById("metadata-created");
    const metadataRefreshed = document.getElementById("metadata-refreshed");
    const metadataBitrate = document.getElementById("metadata-bitrate");
    const metadataFiles = document.getElementById("metadata-files");
    const metadataDescriptionShell = document.getElementById("metadata-description-shell");
    const metadataDescription = document.getElementById("metadata-description");
    const metadataDescriptionToggle = document.getElementById("metadata-description-toggle");
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    shuffleBtn.addEventListener("click", toggleShuffle);
    previousTrackBtn.addEventListener("click", playPreviousTrack);
    playPauseBtn.addEventListener("click", playPauseTrack);
    nextTrackBtn.addEventListener("click", playNextTrack);
    playerSeek.addEventListener("input", seekToSelectedTime);
    playerVolume.addEventListener("input", updateVolume);
    volumeButton.addEventListener("click", toggleMute);
    metadataDescriptionToggle.addEventListener("click", toggleDescription);
    metadataToggleButton.addEventListener("click", toggleMetadataDetails);
    refreshMetadataButton.addEventListener("click", refreshCurrentTrackMetadata);
    setMetadataExpanded(false);
    syncVolumeControl();
    syncSeekControl();

    audioPlayer.addEventListener("play", () => {
        syncPlayPauseButton();

        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
        }
    });

    audioPlayer.addEventListener("pause", () => {
        syncPlayPauseButton();

        if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "paused";
        }
    });

    audioPlayer.addEventListener("loadedmetadata", syncSeekControl);
    audioPlayer.addEventListener("durationchange", syncSeekControl);
    audioPlayer.addEventListener("timeupdate", syncSeekControl);
    audioPlayer.addEventListener("volumechange", syncVolumeControl);

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

    function formatPlaybackTime(seconds) {
        if (!Number.isFinite(seconds) || seconds < 0) {
            return "0:00";
        }

        return durationToReadable(seconds);
    }

    function setRangeProgress(input, value, max) {
        const safeMax = Number(max) > 0 ? Number(max) : 1;
        const percent = Math.min(100, Math.max(0, (Number(value) / safeMax) * 100));

        input.style.setProperty("--range-progress", `${percent}%`);
    }

    function syncPlayPauseButton() {
        const isPlaying = !audioPlayer.paused && !audioPlayer.ended;

        playPauseBtn.textContent = isPlaying ? "pause" : "play_arrow";
        playPauseBtn.setAttribute("aria-label", isPlaying ? "Pause" : "Play");
        playPauseBtn.title = isPlaying ? "Pause" : "Play";
    }

    function syncSeekControl() {
        const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;
        const currentTime = Number.isFinite(audioPlayer.currentTime) ? audioPlayer.currentTime : 0;

        playerSeek.max = duration > 0 ? String(duration) : "100";
        playerSeek.value = String(duration > 0 ? Math.min(currentTime, duration) : 0);
        playerCurrentTime.textContent = formatPlaybackTime(currentTime);
        playerDuration.textContent = formatPlaybackTime(duration);
        setRangeProgress(playerSeek, duration > 0 ? currentTime : 0, duration > 0 ? duration : 100);
    }

    function seekToSelectedTime() {
        const duration = Number.isFinite(audioPlayer.duration) ? audioPlayer.duration : 0;

        if (duration <= 0) {
            playerSeek.value = "0";
            setRangeProgress(playerSeek, 0, 100);
            return;
        }

        audioPlayer.currentTime = Number(playerSeek.value);
        syncSeekControl();
    }

    function syncVolumeControl() {
        const volume = audioPlayer.muted ? 0 : audioPlayer.volume;
        const icon = audioPlayer.muted || audioPlayer.volume === 0
            ? "volume_off"
            : "volume_up";

        playerVolume.value = String(volume);
        volumeButton.textContent = icon;
        volumeButton.setAttribute("aria-label", icon === "volume_off" ? "Unmute" : "Mute");
        volumeButton.title = icon === "volume_off" ? "Unmute" : "Mute";
        setRangeProgress(playerVolume, volume, 1);
    }

    function updateVolume() {
        const volume = Number(playerVolume.value);

        audioPlayer.volume = Math.min(1, Math.max(0, volume));
        audioPlayer.muted = audioPlayer.volume === 0;
        syncVolumeControl();
    }

    function toggleMute() {
        audioPlayer.muted = !audioPlayer.muted;
        syncVolumeControl();
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

        return new Intl.DateTimeFormat("en-US", {
            year: "2-digit",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        }).format(date);
    }

    function getQualityText(track) {
        const requestedQuality = track.requested_audio_quality
            ? `${track.requested_audio_quality} kbps requested`
            : "Request unknown";
        const actualQuality = track.audio_quality
            ? `${track.audio_quality} kbps current`
            : "Current unknown";

        return `${requestedQuality} / ${actualQuality}`;
    }

    function getFileStatusText(track) {
        const audioStatus = track.audio_file_exists ? "audio ok" : "audio missing";
        const thumbnailStatus = track.thumbnail_file_exists ? "thumbnail ok" : "thumbnail missing";

        if (audioStatus && thumbnailStatus) {
            return "all files ok"
        }
        else {
            return `${audioStatus}, ${thumbnailStatus}`;
        }
    }

    function setMetadataStatus(message, status) {
        setStatus(metadataStatus, message, status);
    }

    function setMetadataExpanded(isExpanded) {
        metadataDetails.hidden = !isExpanded;
        metadataPanel.classList.toggle("is-collapsed", !isExpanded);
        metadataPanel.classList.toggle("is-expanded", isExpanded);
        metadataToggleButton.setAttribute("aria-expanded", String(isExpanded));
        metadataToggleButton.textContent = isExpanded ? "Hide Metadata" : "Show Metadata";
    }

    function toggleMetadataDetails() {
        setMetadataExpanded(metadataDetails.hidden);
    }

    function setDescriptionExpanded(isExpanded) {
        metadataDescriptionShell.classList.toggle("is-description-collapsed", !isExpanded);
        metadataDescription.classList.toggle("is-description-collapsed", !isExpanded);
        metadataDescriptionToggle.setAttribute("aria-expanded", String(isExpanded));
        metadataDescriptionToggle.textContent = isExpanded ? "show less" : "show more";

        if (!isExpanded) {
            metadataDescription.scrollTop = 0;
        }
    }

    function syncDescriptionToggle() {
        const isExpanded = !metadataDescription.classList.contains("is-description-collapsed");
        const descriptionHasOverflow = metadataDescription.scrollHeight > metadataDescription.clientHeight + 1;

        metadataDescriptionToggle.hidden = !isExpanded && !descriptionHasOverflow;
    }

    function toggleDescription() {
        const isCollapsed = metadataDescription.classList.contains("is-description-collapsed");

        setDescriptionExpanded(isCollapsed);
        syncDescriptionToggle();
    }

    function renderTrackMetadata(track) {
        if (!track) {
            refreshMetadataButton.disabled = true;
            setMetadataStatus("Choose a track to view details.");
            metadataDuration.textContent = "-";
            metadataCreated.textContent = "-";
            metadataRefreshed.textContent = "-";
            metadataBitrate.textContent = "-";
            metadataFiles.textContent = "-";
            metadataDescription.textContent = "";
            setDescriptionExpanded(false);
            metadataDescriptionToggle.hidden = true;
            return;
        }

        refreshMetadataButton.disabled = false;
        setMetadataStatus(`Showing details for ${track.title || "selected track"}.`);
        metadataDuration.textContent = durationToReadable(track.duration) || "Unknown";
        metadataCreated.textContent = formatDateTime(track.created_at);
        metadataRefreshed.textContent = formatDateTime(track.metadata_refreshed_at);
        metadataBitrate.textContent = getQualityText(track);
        metadataFiles.textContent = capitalize(getFileStatusText(track));
        metadataDescription.textContent = track.description || "No description saved.";
        setDescriptionExpanded(false);
        requestAnimationFrame(syncDescriptionToggle);
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
        syncSeekControl();
        audioPlayer.play().catch(error => {
            console.warn("Failed to start playback", error);
            syncPlayPauseButton();
        });
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
        shuffleBtn.classList.toggle("active", isShuffled);
        shuffleBtn.setAttribute("aria-pressed", String(isShuffled));
        shuffleBtn.title = isShuffled ? "Shuffle on" : "Shuffle";

        if (isShuffled) {
            shuffledTrackIds = [];
        }

        renderTracks();
    }

    function playPauseTrack() {
        if (!audioPlayer.src) {
            playNextTrack();
            return;
        }

        if (!audioPlayer.paused) {
            audioPlayer.pause();
            return;
        }

        audioPlayer.play().catch(error => {
            console.warn("Failed to resume playback", error);
            playNextTrack();
        });
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
