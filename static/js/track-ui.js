function createTrackCard(track, options = {}) {
    const card = document.createElement("article");
    card.className = options.editor ? "audio-card-editor" : "audio-card";
    card.id = track.youtube_id;

    card.innerHTML = `
        <img
            class="track-thumbnail"
            alt="Thumbnail"
            onerror="this.src='/static/img/placeholder.png'"
        >

        <div class="audio-info">
            <h2 class="track-title"></h2>
            <p class="track-uploader"></p>
            <p class="track-duration"></p>
        </div>
    `;

    const thumbnail = card.querySelector(".track-thumbnail");
    thumbnail.dataset.id = track.youtube_id;
    thumbnail.src = thumbnailUrl(track);

    card.querySelector(".track-title").textContent =
        track.title || "Unknown title";

    card.querySelector(".track-uploader").textContent =
        track.uploader || "Unknown uploader";

    card.querySelector(".track-duration").textContent =
        durationToReadable(track.duration) || "Unknown duration";

    if (options.editor) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn delete-btn";
        deleteButton.dataset.id = track.youtube_id;
        deleteButton.textContent = "Delete";
        card.appendChild(deleteButton);
    }

    return card;
}
