import yt_dlp
from pathlib import Path
from threading import Lock, Thread
import subprocess
import database
import logging
from datetime import datetime
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Literal, Optional
from dataclasses import dataclass, asdict, field
import json
import uuid
import config
from config import *
import sharedhelpers
import settings as settings_helper
import re
from urllib.parse import urlparse
from urllib.request import Request, urlopen

download_status = {}
download_status_lock = Lock()

download_batches = {}
download_batches_lock = Lock()

queued_downloads = {}
active_download_ids = set()
download_queue_lock = Lock()
batch_worker_running = False
current_batch_id = None
cookie_init_lock = Lock()

ANSI_ESCAPE_RE = re.compile(r'\x1b\[[0-9;]*m')
AUDIO_QUALITY_CHOICES = [128, 192, 256, 320]
BUSY_DOWNLOAD_STATUSES = {"queued", "starting", "downloading", "finished", "processing", "retrying"}
logger = logging.getLogger(__name__)

# CLASSES --------------------------------------------

@dataclass
class DownloadBatchStatus:
    id: str
    title: str = "Imported Playlist"
    status: str = "running"

    total_items: int = 0
    completed_items: int = 0
    failed_items: int = 0

    downloaded_bytes: int = 0
    output_bytes: int = 0

    started_at: str = field(default_factory=lambda: datetime.now().isoformat(timespec="seconds"))
    finished_at: str | None = None

    wall_start: float = field(default_factory=time.perf_counter)
    cpu_start: float = field(default_factory=time.process_time)

    wall_seconds: float = 0
    cpu_seconds: float = 0

    def __str__(self) -> str:
        return (
            f"{self.title} - {self.total_items} items, "
            f"{self.completed_items} completed, {self.failed_items} failed, "
            f"status: {self.status}\n"
            f"Elapsed: {self.wall_seconds}s wall, {self.cpu_seconds}s CPU\n"
            f"Downloaded: {sharedhelpers.readable_bytes(self.downloaded_bytes)}, "
            f"Output: {sharedhelpers.readable_bytes(self.output_bytes)}"
        )

@dataclass
class DownloadStatus:
    id: str
    title: str = "Unknown"
    uploader: str = "Unknown"
    status: str = "queued"
    percent: float = 0
    downloaded_bytes: int = 0
    total_bytes: int = 0
    speed: float | None = None
    eta: int | None = None
    filename: str | None = None
    error: str | None = None
    retry_count: int = 0

    def __str__(self) -> str:
        return f"{self.title} by {self.uploader} - {self.status} ({self.percent}%, retries: {self.retry_count})"


@dataclass
class TrackRecord:
    youtube_id: str
    title: str = "Unknown"
    uploader: str = "Unknown"
    duration: float | int = 0
    audio_path: str = ""
    thumbnail_path: str = ""
    description: str = ""
    audio_quality: str = ""
    requested_audio_quality: str = ""
    audio_bitrate: int | None = None
    metadata_refreshed_at: str = ""

    @classmethod
    def from_info_dict(cls, info, requested_audio_quality=None):
        track_id = info.get("id")

        if not track_id:
            raise ValueError("Could not determine video ID")

        return cls(
            youtube_id=track_id,
            title=info.get("title") or "Unknown",
            uploader=(
                info.get("uploader")
                or info.get("channel")
                or info.get("creator")
                or "Unknown"
            ),
            duration=info.get("duration") or get_duration(AUDIO_DIR / f"{track_id}.mp3"),
            description=info.get("description") or "",
            requested_audio_quality=str(requested_audio_quality or ""),
        )

    @classmethod
    def from_db_row(cls, row):
        return cls(
            youtube_id=row.get("youtube_id") or "",
            title=row.get("title") or "Unknown",
            uploader=row.get("uploader") or "Unknown",
            duration=row.get("duration") or 0,
            audio_path=row.get("audio_path") or "",
            thumbnail_path=row.get("thumbnail_path") or "",
            description=row.get("description") or "",
            audio_quality=str(row.get("audio_quality") or ""),
            requested_audio_quality=str(row.get("requested_audio_quality") or ""),
            audio_bitrate=row.get("audio_bitrate"),
            metadata_refreshed_at=str(row.get("metadata_refreshed_at") or ""),
        )

    def set_files(
        self,
        *,
        audio_path,
        thumbnail_path,
        audio_quality,
        requested_audio_quality,
        audio_bitrate,
    ):
        self.audio_path = str(audio_path or "")
        self.thumbnail_path = str(thumbnail_path or "")
        self.audio_quality = str(audio_quality or "")
        self.requested_audio_quality = str(requested_audio_quality or "")
        self.audio_bitrate = audio_bitrate

    def to_db_dict(self):
        return asdict(self)


@dataclass
class TrackFileState:
    db_exists: bool
    audio_file: Path | None = None
    thumbnail_file: Path | None = None

    @property
    def audio_exists(self) -> bool:
        return self.audio_file is not None

    @property
    def thumbnail_exists(self) -> bool:
        return self.thumbnail_file is not None

    @property
    def complete(self) -> bool:
        return self.db_exists and self.audio_exists and self.thumbnail_exists

    @property
    def needs_download(self) -> bool:
        return not self.complete

    @property
    def save_to_db(self) -> bool:
        return not self.db_exists


@dataclass
class MissingTrackFiles:
    track: TrackRecord
    audio_missing: bool = False
    thumbnail_missing: bool = False


@dataclass
class DownloadJob:
    track_id: str
    track_url: str
    title: str = "Unknown"
    uploader: str = "Unknown"
    force_redownload: bool = False

    @classmethod
    def from_info_dict(cls, info, track_url, force_redownload=False):
        track_id = info.get("id")

        if not track_id:
            raise ValueError("Could not determine video ID")

        return cls(
            track_id=track_id,
            track_url=track_url,
            title=info.get("title") or "Unknown",
            uploader=info.get("uploader") or "Unknown",
            force_redownload=force_redownload,
        )

    @classmethod
    def from_db_row(cls, row, force_redownload=False):
        track_id = row.get("youtube_id")

        if not track_id:
            raise ValueError("Database row is missing youtube_id")

        return cls(
            track_id=track_id,
            track_url=youtube_watch_url(track_id),
            title=row.get("title") or "Unknown",
            uploader=row.get("uploader") or "Unknown",
            force_redownload=force_redownload,
        )

    @classmethod
    def from_mapping(cls, item, force_redownload=False):
        return cls(
            track_id=item["track_id"],
            track_url=item["track_url"],
            title=item.get("title", "Unknown"),
            uploader=item.get("uploader", "Unknown"),
            force_redownload=item.get("force_redownload", force_redownload),
        )


@dataclass
class DownloadResult:
    ok: bool
    track_id: str
    downloaded_bytes: int = 0
    output_bytes: int = 0
    skipped: bool = False  # type: ignore
    error: str | None = None
    retry_count: int = 0

    @classmethod
    def success(cls, track_id, downloaded_bytes=0, output_bytes=0):
        return cls(
            ok=True,
            track_id=track_id,
            downloaded_bytes=downloaded_bytes or 0,
            output_bytes=output_bytes or 0,
        )

    @classmethod
    def skipped(cls, track_id):
        return cls(ok=True, track_id=track_id, skipped=True)

    @classmethod
    def failure(cls, track_id, error, retry_count=0):
        return cls(
            ok=False,
            track_id=track_id,
            error=error,
            retry_count=retry_count,
        )

    def get(self, key, default=None):
        return getattr(self, key, default)

    def to_dict(self):
        return asdict(self)


@dataclass
class ImportResult:
    queued_count: int = 0
    title: str = "Imported Track"
    uploader: str = ""

    def to_dict(self):
        return asdict(self)


# HELPERS --------------------------------------------

def youtube_watch_url(track_id) -> str:
    return f"https://www.youtube.com/watch?v={track_id}"


def get_configured_max_workers() -> int:
    try:
        max_workers = int(settings_helper.get_setting_value("max_workers", MAX_WORKERS))
    except (TypeError, ValueError):
        return MAX_WORKERS

    return max(1, max_workers)


def is_uploaded_cookie_file() -> bool:
    if not COOKIE_PATH.exists():
        return False

    try:
        text = COOKIE_PATH.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False

    return ".youtube.com" in text

def ensure_cookie_file() -> bool:
    with cookie_init_lock:
        AUTH_DIR.mkdir(parents=True, exist_ok=True)

        if is_uploaded_cookie_file():
            return True

        try:
            with yt_dlp.YoutubeDL({
                **FLAT_ARGS,
                "cookiefile": COOKIE_PATH,
                "js_runtimes": {"node": {}},
                'outtmpl': str(INCOMPLETE_DIR / "%(id)s.%(ext)s")
            }) as ydl: # type: ignore
                ydl.extract_info("https://www.youtube.com/watch?v=jNQXAC9IVRw", download=True)
        except Exception:
            logger.debug("Could not bootstrap YouTube cookies", exc_info=True)

        if COOKIE_PATH.exists():
            return True

        return False

def get_target_audio_quality() -> int:
    try:
        return int(settings_helper.get_setting_value("audio_quality", "192"))
    except (TypeError, ValueError):
        return 192

def closest_audio_quality(bitrate_kbps: int | float | None, fallback: int | None = None) -> int:
    if not bitrate_kbps:
        return fallback or get_target_audio_quality()

    return min(
        AUDIO_QUALITY_CHOICES,
        key=lambda quality: (abs(quality - float(bitrate_kbps)), -quality)
    )

def get_format_bitrate(format_info) -> float | None:
    for key in ("abr", "tbr"):
        value = format_info.get(key)

        if isinstance(value, (int, float)) and value > 0:
            return float(value)

    return None

def choose_closest_audio_format(track_info, target_quality: int):
    formats = track_info.get("formats") or []
    candidates = []

    for format_info in formats:
        format_id = format_info.get("format_id")
        acodec = format_info.get("acodec")
        vcodec = format_info.get("vcodec")
        bitrate = get_format_bitrate(format_info)

        if not format_id or not bitrate:
            continue

        if acodec == "none":
            continue

        audio_only = vcodec in (None, "none")
        candidates.append({
            "format_id": format_id,
            "bitrate": bitrate,
            "audio_only": audio_only,
        })

    if not candidates:
        return None, None

    candidates.sort(key=lambda item: (
        0 if item["audio_only"] else 1,
        abs(item["bitrate"] - target_quality),
        -item["bitrate"],
    ))

    selected = candidates[0]
    return selected["format_id"], selected["bitrate"]

def get_audio_bitrate(file_path) -> int | None:
    try:
        r = subprocess.run(
            [config.FFPROBE, '-v', 'quiet', '-print_format', 'json', '-show_format', str(file_path)],
            capture_output=True, text=True, timeout=15
        )
        bit_rate = json.loads(r.stdout).get("format", {}).get("bit_rate")

        if not bit_rate:
            return None

        return round(int(bit_rate) / 1000)
    except Exception:
        logger.debug("Could not read audio bitrate for %s", file_path, exc_info=True)
        return None

def get_ytdl_args(preferred_quality=None, format_id=None):# -> dict[str, Any]:
    quality = preferred_quality or get_target_audio_quality()
    args = {
        **config.YTDL_ARGS,
        "js_runtimes": {"node": {}},
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(quality)
            }
        ],
        "progress_hooks": [ytdlp_progress_hook],
    }

    if format_id:
        args["format"] = str(format_id)

    if ensure_cookie_file():
        args["cookiefile"] = str(COOKIE_PATH)

    return args


def get_flat_ytdl_args() -> dict[str, bool | str]:
    args = {
        **FLAT_ARGS,
        "js_runtimes": {"node": {}},
    }

    if ensure_cookie_file():
        args["cookiefile"] = str(COOKIE_PATH)

    return args

def get_metadata_ytdl_args() -> dict:
    args = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "js_runtimes": {"node": {}},
    }

    if ensure_cookie_file():
        args["cookiefile"] = str(COOKIE_PATH)

    return args

def check_dirs():
    for directory in get_config_dirs():
        directory.mkdir(parents=True, exist_ok=True)

    for item in INCOMPLETE_DIR.iterdir():
        if not item.is_file():
            continue

        try:
            item.unlink()
        except OSError:
            logger.warning("Could not remove incomplete file: %s", item, exc_info=True)

def get_duration(file_path) -> float | Literal[0]:
    try:
        r = subprocess.run(
            [config.FFPROBE, '-v', 'quiet', '-print_format', 'json', '-show_format', str(file_path)],
            capture_output=True, text=True, timeout=15
        )
        return float(json.loads(r.stdout)['format'].get('duration', 0))
    except Exception:
        return 0

def find_thumbnail_file(track_id) -> Path | None:
    for ext in ['.jpg', '.jpeg', '.png', '.webp']:
        p = INCOMPLETE_DIR / f"{track_id}{ext}"
        if p.exists():
            return p
    return None


def save_thumbnail(track_id, src_path) -> str:
    dest = THUMBS_DIR / f"{track_id}.jpg"
    try:
        subprocess.run([config.FFMPEG, '-y', '-i', str(src_path), str(dest)],
        capture_output=True, timeout=15)
        Path(src_path).unlink(missing_ok=True)
        if dest.exists():
            return str(dest)
    except Exception:
        logger.debug("Could not save thumbnail for %s", track_id, exc_info=True)
    return ''

def refresh_thumbnail_from_url(track_id, thumbnail_url) -> str:
    if not thumbnail_url:
        return ''

    parsed_url = urlparse(str(thumbnail_url))
    suffix = Path(parsed_url.path).suffix.lower()

    if suffix not in {".jpg", ".jpeg", ".png", ".webp"}:
        suffix = ".jpg"

    temp_path = INCOMPLETE_DIR / f"{track_id}.metadata-refresh{suffix}"

    try:
        request = Request(
            str(thumbnail_url),
            headers={"User-Agent": "Mozilla/5.0"}
        )

        with urlopen(request, timeout=20) as response:
            temp_path.write_bytes(response.read())

        return save_thumbnail(track_id, temp_path)
    except Exception:
        temp_path.unlink(missing_ok=True)
        logger.debug("Could not refresh thumbnail for %s", track_id, exc_info=True)
        return ''

def find_existing_audio_file(track_id) -> Path | None:
    for ext in AUDIO_EXTENSIONS:
        path = AUDIO_DIR / f"{track_id}{ext}"
        if path.exists():
            return path
    return None

def find_existing_thumbnail_file(track_id) -> Path | None:
    for ext in THUMB_EXTENSIONS:
        path = THUMBS_DIR / f"{track_id}{ext}"
        if path.exists():
            return path
    return None

def find_and_cull_orphan_files() -> int:
    audio_orphans = []
    thumbnail_orphans = []
    #Find Audios
    for file in AUDIO_DIR.glob("*"):
        if not file.is_file():
            continue

        if file.suffix.lower() not in AUDIO_EXTENSIONS:
            continue

        track_id = file.stem

        if not database.audio_exists(track_id):
            audio_orphans.append(file)
    #Find Thumbanails
    for file in THUMBS_DIR.glob("*"):
        if not file.is_file():
            continue

        if file.suffix.lower() not in THUMB_EXTENSIONS:
            continue

        track_id = file.stem

        if not database.audio_exists(track_id):
            thumbnail_orphans.append(file)

    total = len(audio_orphans) + len(thumbnail_orphans)
    if total == 0:
        return 0

    for file in audio_orphans:
        file.unlink()

    for file in thumbnail_orphans:
        file.unlink()

    return (total)

def find_db_rows_with_missing_files():
    missing = []

    for row in database.get_all_audio():
        track = TrackRecord.from_db_row(row)
        track_id = track.youtube_id

        audio_missing = find_existing_audio_file(track_id) is None
        thumbnail_missing = find_existing_thumbnail_file(track_id) is None

        if audio_missing or thumbnail_missing:
            missing.append(MissingTrackFiles(
                track=track,
                audio_missing=audio_missing,
                thumbnail_missing=thumbnail_missing,
            ))

    return missing

def redownload_missing_files() -> None:
    missing = find_db_rows_with_missing_files()

    if not missing:
        return

    for item in missing:
        download_single(youtube_watch_url(item.track.youtube_id), save_to_db=False)

def get_track_state(track_id) -> TrackFileState:
    db_exists = database.audio_exists(track_id)
    audio_file = find_existing_audio_file(track_id)
    thumbnail_file = find_existing_thumbnail_file(track_id)

    return TrackFileState(
        db_exists=db_exists,
        audio_file=audio_file,
        thumbnail_file=thumbnail_file,
    )

def clean_download_error(error) -> str:
    message = str(error)

    # Remove terminal color codes like "\x1b[0;31m"
    message = ANSI_ESCAPE_RE.sub("", message)

    # Remove common yt-dlp prefix
    message = message.replace("ERROR:", "").strip()

    lower_message = message.lower()

    if (
        "not a bot" in lower_message
        or "sign in to confirm" in lower_message
    ):
        return "YouTube asked for sign-in or bot verification. Update yt-dlp, then retry with a signed-in browser session/cookies if needed."

    if "requested format is not available" in lower_message:
        return "yt-dlp could not find a downloadable audio format. Update yt-dlp, then retry."

    if "http error 403" in lower_message or "403: forbidden" in lower_message:
        return (
            "YouTube blocked the audio stream with HTTP 403 Forbidden. "
            "Update yt-dlp, retry later, or retry with a signed-in browser session/cookies if this video requires it."
        )

    # Optional: trim very long errors
    max_length = 300
    if len(message) > max_length:
        message = message[:max_length].rstrip() + "..."

    return message

def error_mentions_cookies(error) -> bool:
    return re.search(r"\bcookies?\b", str(error), re.IGNORECASE) is not None

def ytdlp_progress_hook(d) -> None:
    status = d.get("status")
    info = d.get("info_dict") or {}
    track_id = info.get("id")

    if not track_id:
        return

    downloaded = d.get("downloaded_bytes") or 0
    total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0

    percent = 0
    if total:
        percent = round((downloaded / total) * 100, 2)


    update_download_status(
        track_id,
        title=info.get("title"),
        uploader=info.get("uploader", "Unknown"),
        status=status,
        percent=percent,
        downloaded_bytes=downloaded,
        total_bytes=total,
        speed=d.get("speed"),
        eta=d.get("eta"),
        filename=d.get("filename"),
    )

def update_download_status(
    download_id: str,
    *,
    title: Optional[str] = None,
    uploader: Optional[str] = None,
    status: Optional[str] = None,
    percent: Optional[float] = None,
    downloaded_bytes: Optional[int] = None,
    total_bytes: Optional[int] = None,
    speed: Optional[float] = None,
    eta: Optional[int] = None,
    filename: Optional[str] = None,
    error: Optional[str] = None,
) -> None:

    if percent is not None:
        percent = round(percent)

    updates = {
        "title": title,
        "uploader": uploader,
        "status": status,
        "percent": percent,
        "downloaded_bytes": downloaded_bytes,
        "total_bytes": total_bytes,
        "speed": speed,
        "eta": eta,
        "filename": filename,
        "error": error,
    }

    with download_status_lock:
        existing = download_status.get(download_id, {"id": download_id})
        status_obj = DownloadStatus(**existing)

        for key, value in updates.items():
            if value is None:
                continue

            if key in {"title", "uploader"} and value == "Unknown":
                existing_value = getattr(status_obj, key, None)
                if existing_value and existing_value != "Unknown":
                    continue

            setattr(status_obj, key, value)

        download_status[download_id] = asdict(status_obj)

def increment_download_retry(download_id: str) -> int:
    with download_status_lock:
        existing = download_status.get(download_id, {"id": download_id})
        status_obj = DownloadStatus(**existing)
        status_obj.retry_count += 1
        download_status[download_id] = asdict(status_obj)

        return status_obj.retry_count

def clear_download_status(download_id: str) -> None:
    with download_status_lock:
        download_status.pop(download_id, None)

def create_download_batch(batch_id, title, total_items) -> uuid.UUID:
    batch = DownloadBatchStatus(
        id=batch_id,
        title=title,
        total_items=total_items,
    )

    with download_batches_lock:
        download_batches[batch_id] = asdict(batch)

    return batch_id


def update_download_batch(
    batch_id,
    *,
    completed_delta=0,
    failed_delta=0,
    downloaded_bytes_delta=0,
    output_bytes_delta=0,
    status=None
):
    with download_batches_lock:
        existing = download_batches.get(batch_id)

        if not existing:
            return

        batch = DownloadBatchStatus(**existing)

        batch.completed_items += completed_delta
        batch.failed_items += failed_delta
        batch.downloaded_bytes += downloaded_bytes_delta
        batch.output_bytes += output_bytes_delta

        if status is not None:
            batch.status = status

        batch.wall_seconds = round(time.perf_counter() - batch.wall_start, 2)
        batch.cpu_seconds = round(time.process_time() - batch.cpu_start, 2)

        if batch.completed_items + batch.failed_items >= batch.total_items:
            batch.status = "complete"
            batch.finished_at = datetime.now().isoformat(timespec="seconds")

        download_batches[batch_id] = asdict(batch)

def get_active_batch_id(title, added_count):
    global current_batch_id

    with download_batches_lock:
        if current_batch_id:
            existing = download_batches.get(current_batch_id)

            if existing and existing.get("status") != "complete":
                batch = DownloadBatchStatus(**existing)
                batch.total_items += added_count
                batch.status = "running"
                batch.finished_at = None
                download_batches[current_batch_id] = asdict(batch)
                return current_batch_id

        current_batch_id = str(uuid.uuid4())
        batch = DownloadBatchStatus(
            id=current_batch_id,
            title=title,
            total_items=added_count,
        )
        download_batches[current_batch_id] = asdict(batch)

        return current_batch_id

def get_download_status_snapshot(download_id):
    with download_status_lock:
        status = download_status.get(download_id)

    return dict(status) if status else None

def is_download_busy(track_id):
    with download_queue_lock:
        if track_id in queued_downloads or track_id in active_download_ids:
            return True

    status = get_download_status_snapshot(track_id)

    return status is not None and status.get("status") in BUSY_DOWNLOAD_STATUSES

def pop_next_queued_download() -> DownloadJob | None:
    with download_queue_lock:
        if not queued_downloads:
            return None

        track_id = next(iter(queued_downloads))
        job = queued_downloads.pop(track_id)
        active_download_ids.add(track_id)

        return job

def finish_active_download(track_id):
    with download_queue_lock:
        active_download_ids.discard(track_id)

def enqueue_downloads(download_items: dict, batch_title: str, force_redownload=False):
    global batch_worker_running

    added_jobs = []

    with download_queue_lock:
        for track_id, item in download_items.items():
            if track_id in queued_downloads or track_id in active_download_ids:
                continue

            status = get_download_status_snapshot(track_id)
            if status and status.get("status") in BUSY_DOWNLOAD_STATUSES:
                continue

            job = item if isinstance(item, DownloadJob) else DownloadJob.from_mapping(item, force_redownload)
            job.force_redownload = job.force_redownload or force_redownload
            queued_downloads[track_id] = job
            added_jobs.append(job)

    if not added_jobs:
        return 0

    get_active_batch_id(batch_title, len(added_jobs))

    for job in added_jobs:
        update_download_status(
            job.track_id,
            title=job.title,
            uploader=job.uploader,
            status="queued",
            percent=0
        )

    with download_queue_lock:
        if not batch_worker_running:
            batch_worker_running = True
            Thread(target=run_batch_worker, name="single-download-batch-worker", daemon=True).start()

    return len(added_jobs)

def run_batch_worker():
    global batch_worker_running

    try:
        max_workers = get_configured_max_workers()

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_job = {}

            while True:
                while len(future_to_job) < max_workers:
                    job = pop_next_queued_download()

                    if not job:
                        break

                    future = executor.submit(
                        download_single,
                        job.track_url,
                        True,
                        job.track_id,
                        job.force_redownload
                    )
                    future_to_job[future] = job

                if not future_to_job:
                    with download_queue_lock:
                        if not queued_downloads:
                            break

                    continue

                done, _ = wait(future_to_job, return_when=FIRST_COMPLETED)

                for future in done:
                    job = future_to_job.pop(future)
                    result = None

                    try:
                        result = future.result()
                    except Exception as error:
                        clean_error = clean_download_error(error)
                        update_download_status(
                            job.track_id,
                            status="error",
                            percent=0,
                            error=clean_error
                        )
                        retry_count = increment_download_retry(job.track_id)
                        result = DownloadResult.failure(job.track_id, clean_error, retry_count)

                    finish_active_download(job.track_id)

                    if not result or not result.ok:
                        update_download_batch(current_batch_id, failed_delta=1)
                        continue

                    update_download_batch(
                        current_batch_id,
                        completed_delta=1,
                        downloaded_bytes_delta=result.downloaded_bytes,
                        output_bytes_delta=result.output_bytes,
                    )

    finally:
        with download_queue_lock:
            if queued_downloads:
                Thread(target=run_batch_worker, name="single-download-batch-worker", daemon=True).start()
            else:
                batch_worker_running = False

def get_file_size(path):
    try:
        path = Path(path)
        if path.exists():
            return path.stat().st_size
    except Exception:
        logger.debug("Could not read file size for %s", path, exc_info=True)

    return 0


def get_download_status(download_id):
    with download_status_lock:
        status = download_status.get(download_id)

    if not status:
        return None

    return DownloadStatus(**status)

# FUNCTIONS ------------------------------------------

def download_single(
    track_url,
    save_to_db=True,
    expected_track_id=None,
    force_redownload=False,
    allow_cookie_retry=True
):
    track_id = expected_track_id
    try:
        target_quality = get_target_audio_quality()

        with yt_dlp.YoutubeDL(get_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
            track_info = ydl.extract_info(track_url, download=False)

        track = TrackRecord.from_info_dict(track_info, requested_audio_quality=target_quality)
        track_id = track.youtube_id
        selected_format_id, selected_source_bitrate = choose_closest_audio_format(track_info, target_quality)
        output_quality = closest_audio_quality(selected_source_bitrate, fallback=target_quality)

        track_state = get_track_state(track_id)

        if track_state.complete and not force_redownload:
            return DownloadResult.skipped(track_id)

        if track_state.db_exists and not force_redownload:
            save_to_db = False

        elif track_state.audio_exists and track_state.thumbnail_exists and not force_redownload:
            audio_bitrate = get_audio_bitrate(track_state.audio_file)
            actual_quality = closest_audio_quality(audio_bitrate, fallback=output_quality)

            track.set_files(
                audio_path=track_state.audio_file,
                thumbnail_path=track_state.thumbnail_file,
                audio_quality=actual_quality,
                requested_audio_quality=target_quality,
                audio_bitrate=audio_bitrate,
            )
            database.add_audio(track.to_db_dict())
            update_download_status(track_id, title=track.title, uploader=track.uploader, percent=100, status="complete")
            return DownloadResult.skipped(track_id)

        update_download_status(
            track_id,
            title=track.title,
            uploader=track.uploader,
            status="starting",
            percent=0
        )

        with yt_dlp.YoutubeDL(get_ytdl_args(preferred_quality=output_quality, format_id=selected_format_id)) as ydl: # pyright: ignore[reportArgumentType]
            track_info = ydl.extract_info(track_url, download=True)

        mp3 = INCOMPLETE_DIR / f"{track_id}.mp3"

        if not mp3.exists():
            backup_mp3 = AUDIO_DIR / f"{track_id}.mp3"
            if backup_mp3.exists():
                mp3 = backup_mp3

        if not mp3.exists():
            raise FileNotFoundError("Output file not found after download")

        final_mp3 = AUDIO_DIR / f"{track_id}.mp3"
        mp3.replace(final_mp3)
        mp3 = final_mp3
        thumb = ''
        thumb_src = find_thumbnail_file(track_id)

        if thumb_src:
            thumb = save_thumbnail(track_id, thumb_src)

        audio_bitrate = get_audio_bitrate(mp3)
        actual_quality = closest_audio_quality(audio_bitrate, fallback=output_quality)
        track.set_files(
            audio_path=mp3,
            thumbnail_path=thumb,
            audio_quality=actual_quality,
            requested_audio_quality=target_quality,
            audio_bitrate=audio_bitrate,
        )

        if save_to_db:
            database.add_audio(track.to_db_dict())

        output_bytes = get_file_size(mp3)

        update_download_status(track_id, status="complete", percent=100)

        status_obj = get_download_status(track_id)
        downloaded_bytes = status_obj.downloaded_bytes if status_obj else 0

        return DownloadResult.success(
            track_id,
            downloaded_bytes=downloaded_bytes,
            output_bytes=output_bytes,
        )
    except Exception as e:
        error_id = track_id or track_url
        clean_error = clean_download_error(e)

        if allow_cookie_retry and (
            error_mentions_cookies(e) or error_mentions_cookies(clean_error)
        ):
            update_download_status(
                error_id,
                status="retrying",
                percent=0,
                error=clean_error
            )
            increment_download_retry(error_id)
            # should already have been done by now... ensure_cookie_file()
            return download_single(
                track_url,
                save_to_db=save_to_db,
                expected_track_id=expected_track_id,
                force_redownload=force_redownload,
                allow_cookie_retry=False
            )

        update_download_status(
            error_id,
            status="error",
            percent=0,
            error=clean_error
        )
        retry_count = increment_download_retry(error_id)

        return DownloadResult.failure(error_id, clean_error, retry_count)

def batch_download(download_queue: dict, playlist_title: str, force_redownload=False):
    return enqueue_downloads(download_queue, playlist_title, force_redownload=force_redownload)

def extract_playlist(track_url):
    download_queue = {}
    with yt_dlp.YoutubeDL(get_flat_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
        playlist_info = ydl.extract_info(track_url, download=False)

    entries = playlist_info.get('entries') or []
    if not entries:
        track_id = playlist_info.get("id")

        if not track_id:
            return ImportResult(
                queued_count=0,
                title=playlist_info.get("title") or "Imported Track",
                uploader=playlist_info.get("uploader", ""), # type: ignore
            )

        track_state = get_track_state(track_id)

        if track_state.complete or is_download_busy(track_id):
            queued_count = 0
        else:
            job = DownloadJob.from_info_dict(playlist_info, track_url)
            queued_count = batch_download({track_id: job}, playlist_info.get("title") or "Imported Track")

        return ImportResult(
            queued_count=queued_count,
            title=playlist_info.get("title") or "Imported Track",
            uploader=playlist_info.get("uploader", ""), # type: ignore
        )

    for entry in entries:
        track_id = entry.get("id")

        if not track_id:
            continue

        track_url = youtube_watch_url(track_id)
        track_state = get_track_state(track_id)

        if track_state.complete or is_download_busy(track_id):
            continue

        download_queue[track_id] = DownloadJob.from_info_dict(entry, track_url)

    queued_count = batch_download(download_queue, playlist_info.get("title") or "Imported Playlist")

    return ImportResult(
        queued_count=queued_count,
        title=playlist_info.get("title") or "Imported Playlist",
        uploader="",
    )

def refresh_track_metadata(youtube_id):
    existing = database.get_audio_record(youtube_id)

    if not existing:
        return None

    track_url = youtube_watch_url(youtube_id)

    with yt_dlp.YoutubeDL(get_metadata_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
        track_info = ydl.extract_info(track_url, download=False)

    thumbnails = track_info.get("thumbnails") or []
    thumbnail_url = track_info.get("thumbnail")

    if not thumbnail_url and thumbnails:
        thumbnail_url = thumbnails[-1].get("url")

    thumbnail_path = refresh_thumbnail_from_url(youtube_id, thumbnail_url)

    updates = {
        "title": track_info.get("title") or existing.get("title") or "Unknown",
        "uploader": (
            track_info.get("uploader")
            or track_info.get("channel")
            or track_info.get("creator")
            or existing.get("uploader")
            or "Unknown"
        ),
        "duration": track_info.get("duration") or existing.get("duration") or 0,
        "description": track_info.get("description") or existing.get("description") or "",
        "metadata_refreshed_at": datetime.now().isoformat(timespec="seconds"),
    }

    if thumbnail_path:
        updates["thumbnail_path"] = thumbnail_path

    return database.update_audio_metadata(youtube_id, updates)

def redownload_all_for_quality() -> None:
    target_quality = settings_helper.get_setting_value("audio_quality", "192")
    tracks = database.get_all_audio()

    download_queue = {}

    for row in tracks:
        track = TrackRecord.from_db_row(row)
        current_quality = track.requested_audio_quality or track.audio_quality

        if str(current_quality) == str(target_quality):
            continue

        download_queue[track.youtube_id] = DownloadJob.from_db_row(
            track.to_db_dict(),
            force_redownload=True,
        )

    batch_download(download_queue, "Playlist Redownload for Quality Change", force_redownload=True)
