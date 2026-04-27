import yt_dlp
from yt_dlp.version import __version__ as YTDLP_VERSION
from pathlib import Path
from threading import Lock
import subprocess
import sys
import database
from datetime import datetime
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional
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

ARCHIVE_REQUEST_PREFIX = "archive-request-"

ANSI_ESCAPE_RE = re.compile(r'\x1b\[[0-9;]*m')

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

    def __str__(self) -> str:
        return f"{self.title} by {self.uploader} - {self.status} ({self.percent}%)"


# HELPERS --------------------------------------------

def get_ytdl_args():
    quality = settings_helper.get_setting_value("audio_quality", "192")

    return {
        **YTDL_ARGS,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "mp3",
                "preferredquality": str(quality)
            }
        ],
        "progress_hooks": [ytdlp_progress_hook],
    }


def get_flat_ytdl_args():
    return FLAT_ARGS

def check_dirs():
    DATA_DIR.mkdir(exist_ok=True)
    AUDIO_DIR.mkdir(exist_ok=True)
    THUMBS_DIR.mkdir(exist_ok=True)
    INCOMPLETE_DIR.mkdir(exist_ok=True)

    for item in INCOMPLETE_DIR.iterdir():
        item.unlink()

def get_duration(file_path):
    try:
        r = subprocess.run(
            [FFPROBE, '-v', 'quiet', '-print_format', 'json', '-show_format', str(file_path)],
            capture_output=True, text=True, timeout=15
        )
        return float(json.loads(r.stdout)['format'].get('duration', 0))
    except Exception:
        return 0

def find_thumbnail_file(track_id):
    for ext in ['.jpg', '.jpeg', '.png', '.webp']:
        p = INCOMPLETE_DIR / f"{track_id}{ext}"
        if p.exists():
            return p
    return None


def save_thumbnail(track_id, src_path):
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

def find_existing_audio_file(track_id):
    for ext in AUDIO_EXTENSIONS:
        path = AUDIO_DIR / f"{track_id}{ext}"
        if path.exists():
            return path
    return None

def find_existing_thumbnail_file(track_id):
    for ext in THUMB_EXTENSIONS:
        path = THUMBS_DIR / f"{track_id}{ext}"
        if path.exists():
            return path
    return None

def find_and_cull_orphan_files():
    audio_orphans = []
    thumbnail_orphans = []
    #Find Audios
    for file in AUDIO_DIR.glob("*"):
        if not file.is_file():
            continue

        if file.suffix.lower() not in AUDIO_EXTENSIONS:
            continue

        track_id = file.stem

        if not database.get_audio(track_id):
            audio_orphans.append(file)
    #Find Thumbanails
    for file in THUMBS_DIR.glob("*"):
        if not file.is_file():
            continue

        if file.suffix.lower() not in THUMB_EXTENSIONS:
            continue

        track_id = file.stem

        if not database.get_audio(track_id):
            thumbnail_orphans.append(file)

    total = len(audio_orphans) + len(thumbnail_orphans)
    if total == 0:
        print("No orphaned files found.")
        return 0

    for file in audio_orphans:
        print(file)
        file.unlink()

    for file in thumbnail_orphans:
        print(file)
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

def redownload_missing_files():
    missing = find_db_rows_with_missing_files()

    if not missing:
        print("No missing files found.")
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

        print(f"Re-downloading {track_id}: {reason}")
        download_single(track_url, save_to_db=False)

def get_track_state(track_id):
    db_exists = database.get_audio(track_id)
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

def clean_download_error(error):
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
        return "YouTube asked for sign-in or bot verification. Update yt-dlp in Setup > Advanced, then retry."

    if "requested format is not available" in lower_message:
        return "yt-dlp could not find a downloadable audio format. Update yt-dlp in Setup > Advanced, then retry."

    # Optional: trim very long errors
    max_length = 300
    if len(message) > max_length:
        message = message[:max_length].rstrip() + "..."

    return message

def ytdlp_progress_hook(d):
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

def clear_download_status(download_id: str) -> None:
    with download_status_lock:
        download_status.pop(download_id, None)

def create_archive_request(track_url: str) -> str:
    request_id = f"{ARCHIVE_REQUEST_PREFIX}{uuid.uuid4().hex}"

    update_download_status(
        request_id,
        title="Importing URL",
        uploader="",
        status="starting",
        percent=0,
        filename=track_url
    )

    return request_id

def start_archive(track_url: str, request_id: str) -> None:
    try:
        result = extract_playlist(track_url)

        if result.get("queued_count", 0) == 0:
            update_download_status(
                request_id,
                title=result.get("title") or "Nothing new to import",
                uploader=result.get("uploader") or "",
                status="complete",
                percent=100
            )
            return

        clear_download_status(request_id)
    except Exception as e:
        clean_error = clean_download_error(e)

        update_download_status(
            request_id,
            title="Import failed",
            uploader="",
            status="error",
            percent=0,
            error=clean_error
        )

        print(f"Archive failed: {track_url} - {clean_error}")

def create_download_batch(batch_id, title, total_items):
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

def download_single(track_url, save_to_db=True, expected_track_id=None, force_redownload=False):
    track_id = expected_track_id
    try:
        with yt_dlp.YoutubeDL(get_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
            track_info = ydl.extract_info(track_url, download=False)

        track_id = track_info.get("id")
        title = track_info.get('title', 'Unknown')
        description = track_info.get('description', 'Unknown')
        artist = track_info.get('uploader') or track_info.get('channel') or track_info.get('creator') or ''
        duration = track_info.get('duration') or get_duration(AUDIO_DIR / f"{track_id}.mp3")

        if not track_id:
            raise ValueError("Could not determine video ID")

        track_state = get_track_state(track_id)

        if track_state["complete"] and not force_redownload:
            print("skipping dupe...")
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
            print("files already exist, adding to db.")
            database.add_audio({
                "youtube_id": track_id,
                "title": title,
                "uploader": artist,
                "duration": duration,
                "audio_path": str(track_state["audio_exists"]),
                "thumbnail_path": track_state["thumbnail_exists"],
                "audio_quality": str(settings_helper.get_setting_value("audio_quality", "192")),
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

        with yt_dlp.YoutubeDL(get_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
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
            database.add_audio({
                "youtube_id": track_id,
                "title": title,
                "uploader": artist,
                "duration": duration,
                "audio_path": str(mp3),
                "thumbnail_path": thumb,
                "audio_quality": str(settings_helper.get_setting_value("audio_quality", "192")),
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

        update_download_status(
            error_id,
            status="error",
            percent=0,
            error=clean_error
        )

        print(f"Download failed: {track_url} - {clean_error}")
        return {
            "ok": False,
            "track_id": error_id,
            "error": clean_error,
            "downloaded_bytes": 0,
            "output_bytes": 0,
        }

def batch_download(download_queue: dict, playlist_title: str, force_redownload=False):

    if not download_queue:
        print(f"No tracks queued for batch: {playlist_title}")
        return None

    batch_id = str(uuid.uuid4())
    create_download_batch(
        batch_id=batch_id,
        title=playlist_title,
        total_items=len(download_queue),
    )

    with ThreadPoolExecutor(max_workers=settings_helper.get_setting_value("max_workers", MAX_WORKERS)) as executor:
        future_to_track = {}

        for track_id, item in download_queue.items():
            future = executor.submit(
                download_single,
                item["track_url"],
                True,
                item["track_id"],
                force_redownload
            )
            future_to_track[future] = item

    for future in as_completed(future_to_track):
        item = future_to_track[future]
        result = future.result()

        if not result or result.get("ok") is False:
            print(f"A download failed: {item['track_id']}")
            update_download_batch(batch_id, failed_delta=1)
            continue

        update_download_batch(
            batch_id,
            completed_delta=1,
            downloaded_bytes_delta=result.get("downloaded_bytes", 0),
            output_bytes_delta=result.get("output_bytes", 0),
        )
    batchobj = DownloadBatchStatus(**download_batches[batch_id])
    print(f"Batch complete: {playlist_title} - {batch_id}")
    print(f"Batch stats: {batchobj}")

def extract_playlist(track_url):
    download_queue = {}
    with yt_dlp.YoutubeDL(get_flat_ytdl_args()) as ydl: # pyright: ignore[reportArgumentType]
        playlist_info = ydl.extract_info(track_url, download=False)

    entries = playlist_info.get('entries') or []
    if not entries:
        result = download_single(track_url)
        status_obj = get_download_status(result.get("track_id")) if result.get("track_id") else None

        return {
            "queued_count": 0 if result.get("skipped") else 1,
            "title": status_obj.title if status_obj else "Imported Track",
            "uploader": status_obj.uploader if status_obj else "",
        }

    for entry in entries:
        track_id = entry.get("id")

        if not track_id:
            print("Skipping entry with no available track ID")
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"
        track_state = get_track_state(track_id)

        if track_state["complete"]:
            print("skipping dupe...")
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"

        download_queue[track_id] = {
            "track_id": track_id,
            "track_url": track_url,
            "title": entry.get("title", "Unknown"),
        }

        update_download_status(
            track_id,
            title=entry.get("title", "Unknown"),
            uploader=entry.get("uploader", "Unknown"),
            status="queued",
            percent=0
        )
    batch_download(download_queue, playlist_info.get("title") or "Imported Playlist")

    return {
        "queued_count": len(download_queue),
        "title": playlist_info.get("title") or "Imported Playlist",
        "uploader": "",
    }

def redownload_all_for_quality():
    target_quality = settings_helper.get_setting_value("audio_quality", "192")
    tracks = database.get_all_audio()

    download_queue = {}

    for track in tracks:
        track_id = track["youtube_id"]
        current_quality = track.get("audio_quality")

        if str(current_quality) == str(target_quality):
            continue

        track_url = f"https://www.youtube.com/watch?v={track_id}"

        download_queue[track_id] = {
            "track_id": track_id,
            "track_url": track_url,
            "title": track.get("title", "Unknown"),
        }

        update_download_status(
            track_id,
            title=track.get("title", "Unknown"),
            uploader=track.get("uploader", "Unknown"),
            status="queued",
            percent=0
        )

    batch_download(download_queue, "Playlist Redownload for Quality Change", force_redownload=True)
