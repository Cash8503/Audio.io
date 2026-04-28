import yt_dlp
from pathlib import Path
from threading import Lock, Thread
import subprocess
import database
from datetime import datetime
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Literal, Optional
from dataclasses import dataclass, asdict, field
import json
import uuid
from config import *
import sharedhelpers
import settings as settings_helper
import re

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


# HELPERS --------------------------------------------

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
        except Exception as error:
            pass

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
            [FFPROBE, '-v', 'quiet', '-print_format', 'json', '-show_format', str(file_path)],
            capture_output=True, text=True, timeout=15
        )
        bit_rate = json.loads(r.stdout).get("format", {}).get("bit_rate")

        if not bit_rate:
            return None

        return round(int(bit_rate) / 1000)
    except Exception:
        return None

def get_ytdl_args(preferred_quality=None, format_id=None):# -> dict[str, Any]:
    quality = preferred_quality or get_target_audio_quality()
    args = {
        **YTDL_ARGS,
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

def check_dirs():
    DATA_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)
    THUMBS_DIR.mkdir(exist_ok=True)
    INCOMPLETE_DIR.mkdir(exist_ok=True)
    AUTH_DIR.mkdir(exist_ok=True)

    for item in INCOMPLETE_DIR.iterdir():
        item.unlink()

def get_duration(file_path) -> float | Literal[0]:
    try:
        r = subprocess.run(
            [FFPROBE, '-v', 'quiet', '-print_format', 'json', '-show_format', str(file_path)],
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
        subprocess.run([FFMPEG, '-y', '-i', str(src_path), str(dest)],
        capture_output=True, timeout=15)
        Path(src_path).unlink(missing_ok=True)
        if dest.exists():
            return str(dest)
    except Exception:
        pass
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

    for track in database.get_all_audio():
        track_id = track["youtube_id"]

        audio_missing = find_existing_audio_file(track_id) is None
        thumbnail_missing = find_existing_thumbnail_file(track_id) is None

        if audio_missing or thumbnail_missing:
            missing.append({
                "track": track,
                "audio_missing": audio_missing,
                "thumbnail_missing": thumbnail_missing,
            })

    return missing

def redownload_missing_files() -> None:
    missing = find_db_rows_with_missing_files()

    if not missing:
        return

    for item in missing:
        track = item["track"]
        track_id = track["youtube_id"]
        track_url = f"https://www.youtube.com/watch?v={track_id}"

        if item["audio_missing"] and item["thumbnail_missing"]:
            reason = "audio and thumbnail missing"
        elif item["audio_missing"]:
            reason = "audio missing"
        else:
            reason = "thumbnail missing"

        download_single(track_url, save_to_db=False)

def get_track_state(track_id):# -> dict[str, Any]:
    db_exists = database.audio_exists(track_id)
    audio_file = find_existing_audio_file(track_id)
    thumbnail_file = find_existing_thumbnail_file(track_id)

    audio_exists = audio_file is not None
    thumbnail_exists = thumbnail_file is not None

    return {
        "db_exists": db_exists,
        "audio_exists": audio_exists,
        "thumbnail_exists": thumbnail_exists,
        "complete": db_exists and audio_exists and thumbnail_exists,
        "needs_download": not (db_exists and audio_exists and thumbnail_exists),
        "save_to_db": not db_exists,
        "audio_file": audio_file,
        "thumbnail_file": thumbnail_file,
    }

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
    busy_statuses = {"queued", "starting", "downloading", "finished", "processing"}

    with download_queue_lock:
        if track_id in queued_downloads or track_id in active_download_ids:
            return True

    status = get_download_status_snapshot(track_id)

    return status is not None and status.get("status") in busy_statuses

def pop_next_queued_download():
    with download_queue_lock:
        if not queued_downloads:
            return None

        track_id = next(iter(queued_downloads))
        item = queued_downloads.pop(track_id)
        active_download_ids.add(track_id)

        return item

def finish_active_download(track_id):
    with download_queue_lock:
        active_download_ids.discard(track_id)

def enqueue_downloads(download_items: dict, batch_title: str, force_redownload=False):
    global batch_worker_running

    added_items = []

    with download_queue_lock:
        for track_id, item in download_items.items():
            if track_id in queued_downloads or track_id in active_download_ids:
                continue

            status = get_download_status_snapshot(track_id)
            if status and status.get("status") in {"queued", "starting", "downloading", "finished", "processing"}:
                continue

            queued_item = {
                **item,
                "force_redownload": force_redownload,
            }
            queued_downloads[track_id] = queued_item
            added_items.append(queued_item)

    if not added_items:
        return 0

    batch_id = get_active_batch_id(batch_title, len(added_items))

    for item in added_items:
        update_download_status(
            item["track_id"],
            title=item.get("title", "Unknown"),
            uploader=item.get("uploader", "Unknown"),
            status="queued",
            percent=0
        )

    with download_queue_lock:
        if not batch_worker_running:
            batch_worker_running = True
            Thread(target=run_batch_worker, name="single-download-batch-worker", daemon=True).start()

    return len(added_items)

def run_batch_worker():
    global batch_worker_running

    try:
        max_workers = settings_helper.get_setting_value("max_workers", MAX_WORKERS)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_item = {}

            while True:
                while len(future_to_item) < max_workers:
                    item = pop_next_queued_download()

                    if not item:
                        break

                    future = executor.submit(
                        download_single,
                        item["track_url"],
                        True,
                        item["track_id"],
                        item.get("force_redownload", False)
                    )
                    future_to_item[future] = item

                if not future_to_item:
                    with download_queue_lock:
                        if not queued_downloads:
                            break

                    continue

                done, _ = wait(future_to_item, return_when=FIRST_COMPLETED)

                for future in done:
                    item = future_to_item.pop(future)
                    result = None

                    try:
                        result = future.result()
                    except Exception as error:
                        clean_error = clean_download_error(error)
                        update_download_status(
                            item["track_id"],
                            status="error",
                            percent=0,
                            error=clean_error
                        )
                        increment_download_retry(item["track_id"])
                        result = {"ok": False, "error": clean_error}

                    finish_active_download(item["track_id"])

                    if not result or result.get("ok") is False:
                        update_download_batch(current_batch_id, failed_delta=1)
                        continue

                    update_download_batch(
                        current_batch_id,
                        completed_delta=1,
                        downloaded_bytes_delta=result.get("downloaded_bytes", 0),
                        output_bytes_delta=result.get("output_bytes", 0),
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
        pass

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

        track_id = track_info.get("id")
        title = track_info.get('title', 'Unknown')
        description = track_info.get('description', 'Unknown')
        artist = track_info.get('uploader') or track_info.get('channel') or track_info.get('creator') or ''
        duration = track_info.get('duration') or get_duration(AUDIO_DIR / f"{track_id}.mp3")
        selected_format_id, selected_source_bitrate = choose_closest_audio_format(track_info, target_quality)
        output_quality = closest_audio_quality(selected_source_bitrate, fallback=target_quality)

        if not track_id:
            raise ValueError("Could not determine video ID")

        track_state = get_track_state(track_id)

        if track_state["complete"] and not force_redownload:
            return {
                "ok": True,
                "track_id": track_id,
                "skipped": True,
                "downloaded_bytes": 0,
                "output_bytes": 0,
            }

        if track_state["db_exists"] and not force_redownload:
            save_to_db = False

        elif track_state["audio_exists"] and track_state["thumbnail_exists"] and not force_redownload:
            audio_bitrate = get_audio_bitrate(track_state["audio_exists"])
            actual_quality = closest_audio_quality(audio_bitrate, fallback=output_quality)
            database.add_audio({
                "youtube_id": track_id,
                "title": title,
                "uploader": artist,
                "duration": duration,
                "audio_path": str(track_state["audio_exists"]),
                "thumbnail_path": track_state["thumbnail_exists"],
                "audio_quality": str(actual_quality),
                "requested_audio_quality": str(target_quality),
                "audio_bitrate": audio_bitrate,
                "description": description
                }
            )
            update_download_status(track_id, title=title, uploader=artist, percent=100, status="complete")
            return {
                "ok": True,
                "track_id": track_id,
                "skipped": True,
                "downloaded_bytes": 0,
                "output_bytes": 0,
            }

        update_download_status(
            track_id,
            title= title,
            uploader= artist,
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

        if save_to_db:
            audio_bitrate = get_audio_bitrate(mp3)
            actual_quality = closest_audio_quality(audio_bitrate, fallback=output_quality)
            database.add_audio({
                "youtube_id": track_id,
                "title": title,
                "uploader": artist,
                "duration": duration,
                "audio_path": str(mp3),
                "thumbnail_path": thumb,
                "audio_quality": str(actual_quality),
                "requested_audio_quality": str(target_quality),
                "audio_bitrate": audio_bitrate,
                "description": description
            }
        )
        output_bytes = get_file_size(mp3)

        update_download_status(track_id, status="complete", percent=100)

        status_obj = get_download_status(track_id)
        downloaded_bytes = status_obj.downloaded_bytes if status_obj else 0

        return {
            "ok": True,
            "track_id": track_id,
            "downloaded_bytes": downloaded_bytes,
            "output_bytes": output_bytes,
        }
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

        return {
            "ok": False,
            "track_id": error_id,
            "error": clean_error,
            "retry_count": retry_count,
            "downloaded_bytes": 0,
            "output_bytes": 0,
        }

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
            return {
                "queued_count": 0,
                "title": playlist_info.get("title") or "Imported Track",
                "uploader": playlist_info.get("uploader", ""),
            }

        track_state = get_track_state(track_id)

        if track_state["complete"] or is_download_busy(track_id):
            queued_count = 0
        else:
            queued_count = batch_download({
                track_id: {
                    "track_id": track_id,
                    "track_url": track_url,
                    "title": playlist_info.get("title", "Unknown"),
                    "uploader": playlist_info.get("uploader", "Unknown"),
                }
            }, playlist_info.get("title") or "Imported Track")

        return {
            "queued_count": queued_count,
            "title": playlist_info.get("title") or "Imported Track",
            "uploader": playlist_info.get("uploader", ""),
        }

    for entry in entries:
        track_id = entry.get("id")

        if not track_id:
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"
        track_state = get_track_state(track_id)

        if track_state["complete"] or is_download_busy(track_id):
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"

        download_queue[track_id] = {
            "track_id": track_id,
            "track_url": track_url,
            "title": entry.get("title", "Unknown"),
            "uploader": entry.get("uploader", "Unknown"),
        }
    queued_count = batch_download(download_queue, playlist_info.get("title") or "Imported Playlist")

    return {
        "queued_count": queued_count,
        "title": playlist_info.get("title") or "Imported Playlist",
        "uploader": "",
    }

def redownload_all_for_quality() -> None:
    target_quality = settings_helper.get_setting_value("audio_quality", "192")
    tracks = database.get_all_audio()

    download_queue = {}

    for track in tracks:
        track_id = track["youtube_id"]
        current_quality = track.get("requested_audio_quality") or track.get("audio_quality")

        if str(current_quality) == str(target_quality):
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"

        download_queue[track_id] = {
            "track_id": track_id,
            "track_url": track_url,
            "title": track.get("title", "Unknown"),
            "uploader": track.get("uploader", "Unknown"),
        }

    batch_download(download_queue, "Playlist Redownload for Quality Change", force_redownload=True)
