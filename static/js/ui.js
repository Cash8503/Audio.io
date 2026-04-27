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

function createDownloadCard(item, options = {}) {
    let displayStatus = item.status || "unknown";
    let displayPercent = options.getDisplayPercent ? options.getDisplayPercent(item) : (item.percent || 0);
    const canDismiss = ["error", "complete"].includes(item.status);


    if (item.status === "finished") {
        displayStatus = "processing";
    }

    const card = document.createElement("div");
    card.className = "download-card";

    card.innerHTML = `
        <div class="download-row">
            <p class="download-title"></p>
            <p class="download-status"></p>
            <progress class="download-progress" max="100"></progress>
            <button class="download-dismiss-btn btn" type="button">x</button>
        </div>
    `;

    card.querySelector(".download-title").textContent =
        `${item.title || item.id || "Unknown"} - ${item.uploader || "Unknown"}`;

    card.querySelector(".download-status").textContent =
        `${capitalize(displayStatus)} - ${displayPercent}%`;

    const progress = card.querySelector(".download-progress");
    progress.value = displayPercent;

    const dismissButton = card.querySelector(".download-dismiss-btn");
    dismissButton.dataset.id = item.id;
    dismissButton.setAttribute("aria-label", `Dismiss ${item.title || item.id || "download"}`);

    dismissButton.hidden = !canDismiss;

    if (canDismiss && options.onDismiss) {
        dismissButton.addEventListener("click", () => {
            options.onDismiss(item.id);
        });
    }

    if (item.status === "error") {
        const error = document.createElement("p");
        error.className = "download-error";
        error.textContent = item.error || "Unknown error";
        card.appendChild(error);
    }

    return card;
}

function uiRenderDownloads(downloads, options = {}) {
    const downloadList = document.getElementById("download-list");
    const downloadHeader = document.getElementById("download-header");

    if (!downloadList) return;
    if (!downloadHeader) return;

    const statusOrder = {
        starting: 1,
        downloading: 2,
        finished: 3,
        queued: 4,
        error: 5,
        complete: 6
    };

    const sortedDownloads = [...downloads].sort((a, b) => {
        const aOrder = statusOrder[a.status] ?? 99;
        const bOrder = statusOrder[b.status] ?? 99;

        return aOrder - bOrder;
    });

    const activeDownloads = downloads.filter(item =>
        !["complete", "error", "queued"].includes(item.status)
    );

    const failedDownloads = downloads.filter(item => item.status === "error");

    const pendingDownloads = downloads.filter(item => item.status === "queued");

    downloadList.innerHTML = "";

    if (downloads.length === 0) {
        downloadHeader.textContent = "No Recent Downloads";
    } else if (activeDownloads.length === 0 && failedDownloads.length === 0 && pendingDownloads.length === 0) {
        downloadHeader.textContent = `${downloads.length} download${downloads.length === 1 ? "" : "s"} completed successfully`;
    } else {
        const maxWorkers = Number(options.maxWorkers);
        let headerText = Number.isFinite(maxWorkers) && maxWorkers > 0
            ? `Downloads - ${activeDownloads.length}/${maxWorkers} active`
            : `Downloads - ${activeDownloads.length} active`;

        if (failedDownloads.length > 0) {
            headerText += ` - ${failedDownloads.length} failed`;
        }

        downloadHeader.textContent = headerText;
    }

    for (const item of sortedDownloads) {
        const card = createDownloadCard(item, options);
        downloadList.appendChild(card);
    }
}
