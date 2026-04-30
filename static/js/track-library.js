function createTrackLibraryState() {
    return {
        search: "",
        sortBy: "title-asc"
    };
}

function bindTrackLibraryControls(state, onChange) {
    const searchInput = document.getElementById("track-search-input");
    const sortSelect = document.getElementById("track-sort-select");
    const resultsSummary = document.getElementById("track-results-summary");

    if (!searchInput || !sortSelect) {
        return {
            searchInput,
            sortSelect,
            resultsSummary
        };
    }

    searchInput.value = state.search;
    sortSelect.value = state.sortBy;

    searchInput.addEventListener("input", (event) => {
        state.search = event.target.value;
        onChange();
    });

    sortSelect.addEventListener("change", (event) => {
        state.sortBy = event.target.value;
        onChange();
    });

    return {
        searchInput,
        sortSelect,
        resultsSummary
    };
}

function getVisibleTracks(tracks, state) {
    const filteredTracks = tracks.filter(track =>
        trackMatchesSearch(track, state.search)
    );

    return sortTracks(filteredTracks, state.sortBy);
}

function updateTrackResultsSummary(element, visibleCount, totalCount) {
    if (!element) return;

    if (totalCount === 0) {
        element.textContent = "";
        return;
    }

    if (visibleCount === totalCount) {
        element.textContent = `Showing all ${totalCount} track${totalCount === 1 ? "" : "s"}`;
        return;
    }

    element.textContent = `Showing ${visibleCount} of ${totalCount} track${totalCount === 1 ? "" : "s"}`;
}

function trackMatchesSearch(track, search) {
    const query = String(search || "").trim().toLowerCase();

    if (!query) {
        return true;
    }

    const title = String(track.title || "").toLowerCase();
    const uploader = String(track.uploader || "").toLowerCase();

    return title.includes(query) || uploader.includes(query);
}

function sortTracks(tracks, sortBy) {
    if (sortBy === "custom") {
        return [...tracks];
    }

    const sortedTracks = [...tracks];

    sortedTracks.sort((a, b) => {
        if (sortBy === "uploader-asc" || sortBy === "uploader-desc") {
            return compareText(a.uploader, b.uploader);
        }

        if (sortBy === "duration-asc" || sortBy === "duration-desc") {
            return parseDurationSeconds(a.duration) - parseDurationSeconds(b.duration);
        }

        if (sortBy === "quality-asc" || sortBy === "quality-desc") {
            return getTrackQuality(a) - getTrackQuality(b);
        }

        if (sortBy === "imported-asc" || sortBy === "imported-desc") {
            return getTrackImportedTime(a) - getTrackImportedTime(b);
        }

        return compareText(a.title, b.title);
    });

    if (sortBy.endsWith("-desc")) {
        sortedTracks.reverse();
    }

    return sortedTracks;
}

function getTrackQuality(track) {
    return Number(track.audio_bitrate || track.audio_quality || track.requested_audio_quality) || 0;
}

function getTrackImportedTime(track) {
    const value = track.created_at;

    if (!value) {
        return 0;
    }

    const normalizedValue = String(value).includes("T")
        ? String(value)
        : String(value).replace(" ", "T");
    const time = new Date(normalizedValue).getTime();

    return Number.isNaN(time) ? 0 : time;
}

function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
        sensitivity: "base"
    });
}
