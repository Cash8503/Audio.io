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
    const { resultsSummary } = bindTrackLibraryControls(libraryState, renderTracks);

    shuffleBtn.addEventListener("click", toggleShuffle);
    previousTrackBtn.addEventListener("click", playPreviousTrack);
    nextTrackBtn.addEventListener("click", playNextTrack);

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
            return;
        }

        if (queue.length === 0) {
            trackList.innerHTML = "<p>No tracks match your search or filters.</p>";
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

    loadTracks();
})();
