function createTrackCard(track, options = {}) {
    const card = document.createElement("article");
    card.className = options.editor ? "audio-card-editor" : "audio-card";
    card.id = `${options.idPrefix || ""}${track.youtube_id}`;

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

    if (options.selectable) {
        card.classList.add("is-selectable");
        const selector = document.createElement("label");
        selector.className = "track-select-control";
        selector.title = "Select track";

        const checkbox = document.createElement("input");
        checkbox.className = "track-select-checkbox";
        checkbox.type = "checkbox";
        checkbox.dataset.id = track.youtube_id;
        checkbox.checked = Boolean(options.selected);

        const label = document.createElement("span");
        label.textContent = "Select";

        selector.append(checkbox, label);
        card.prepend(selector);
    }

    if (options.draggable) {
        card.draggable = true;
        card.classList.add("is-draggable");

        const handle = document.createElement("span");
        handle.className = "material-symbols-rounded queue-drag-handle";
        handle.textContent = "drag_indicator";
        handle.title = "Drag to reorder";
        handle.setAttribute("aria-hidden", "true");

        card.prepend(handle);
    }

    if (options.editor) {
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn delete-btn";
        deleteButton.dataset.id = track.youtube_id;
        deleteButton.textContent = "Delete";
        card.appendChild(deleteButton);
    }

    return card;
}
