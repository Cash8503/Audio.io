function durationToReadable(duration) {
    duration = Math.floor(duration || 0);

    const hours = Math.floor(duration / 3600);
    const minutes = Math.floor((duration % 3600) / 60);
    const seconds = duration % 60;

    const paddedMinutes = String(minutes).padStart(2, "0");
    const paddedSeconds = String(seconds).padStart(2, "0");

    if (hours > 0) {
        return hours + ":" + paddedMinutes + ":" + paddedSeconds;
    }

    return minutes + ":" + paddedSeconds;
}

function capitalize(text) {
    if (!text) return "";
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function thumbnailUrl(trackOrId) {
    const id = typeof trackOrId === "string" ? trackOrId : trackOrId.youtube_id;
    return `/thumbnail/${id}.jpg`;
}

function audioUrl(trackOrId) {
    const id = typeof trackOrId === "string" ? trackOrId : trackOrId.youtube_id;
    return `/audio/${id}.mp3`;
}

function createTrackLibraryState() {
    return {
        search: "",
        sortBy: "title-asc",
        durationFilter: "all"
    };
}

function bindTrackLibraryControls(state, onChange) {
    const searchInput = document.getElementById("track-search-input");
    const sortSelect = document.getElementById("track-sort-select");
    const filterSelect = document.getElementById("track-filter-select");
    const resultsSummary = document.getElementById("track-results-summary");

    if (!searchInput || !sortSelect || !filterSelect) {
        return {
            searchInput,
            sortSelect,
            filterSelect,
            resultsSummary
        };
    }

    searchInput.value = state.search;
    sortSelect.value = state.sortBy;
    filterSelect.value = state.durationFilter;

    searchInput.addEventListener("input", (event) => {
        state.search = event.target.value;
        onChange();
    });

    sortSelect.addEventListener("change", (event) => {
        state.sortBy = event.target.value;
        onChange();
    });

    filterSelect.addEventListener("change", (event) => {
        state.durationFilter = event.target.value;
        onChange();
    });

    return {
        searchInput,
        sortSelect,
        filterSelect,
        resultsSummary
    };
}

function getVisibleTracks(tracks, state) {
    const filteredTracks = tracks.filter(track =>
        trackMatchesSearch(track, state.search) &&
        trackMatchesDurationFilter(track, state.durationFilter)
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

function trackMatchesDurationFilter(track, durationFilter) {
    const duration = Number(track.duration) || 0;

    if (durationFilter === "short") {
        return duration > 0 && duration < 300;
    }

    if (durationFilter === "medium") {
        return duration >= 300 && duration <= 1200;
    }

    if (durationFilter === "long") {
        return duration > 1200;
    }

    return true;
}

function sortTracks(tracks, sortBy) {
    const sortedTracks = [...tracks];

    sortedTracks.sort((a, b) => {
        if (sortBy === "uploader-asc" || sortBy === "uploader-desc") {
            return compareText(a.uploader, b.uploader);
        }

        if (sortBy === "duration-asc" || sortBy === "duration-desc") {
            return (Number(a.duration) || 0) - (Number(b.duration) || 0);
        }

        return compareText(a.title, b.title);
    });

    if (sortBy.endsWith("-desc")) {
        sortedTracks.reverse();
    }

    return sortedTracks;
}

function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
        sensitivity: "base"
    });
}
