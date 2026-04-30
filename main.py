from flask import Flask, render_template, jsonify, send_from_directory, request
import atexit
import faulthandler
import logging
import signal
import sqlite3
import sys
import threading
from datetime import datetime
import database
import downloader
import settings as settings_helper
from config import *
from threading import Thread

LOG_PATH = DATA_DIR / "audioio.log"
_fatal_log_file = None

def configure_logging():
    global _fatal_log_file

    DATA_DIR.mkdir(exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )

    _fatal_log_file = open(LOG_PATH, "a", encoding="utf-8")
    faulthandler.enable(file=_fatal_log_file)


configure_logging()


def log_process_exit():
    logging.warning("Audio.io process exiting")


atexit.register(log_process_exit)

app = Flask(__name__, static_folder="static")

class IgnoreRouteFilter(logging.Filter):
    def filter(self, record):
        return "/api/downloads" not in record.getMessage()

logging.getLogger("werkzeug").addFilter(IgnoreRouteFilter())

# HELPERS --------------------------------------------

def log_uncaught_exception(exc_type, exc_value, exc_traceback):
    logging.critical(
        "Uncaught exception",
        exc_info=(exc_type, exc_value, exc_traceback)
    )


def log_thread_exception(args):
    logging.critical(
        "Uncaught exception in thread %s",
        args.thread.name,
        exc_info=(args.exc_type, args.exc_value, args.exc_traceback)
    )


sys.excepthook = log_uncaught_exception
threading.excepthook = log_thread_exception


def install_signal_logging():
    signal_names = ["SIGINT", "SIGTERM"]

    if hasattr(signal, "SIGBREAK"):
        signal_names.append("SIGBREAK")

    for signal_name in signal_names:
        signum = getattr(signal, signal_name)
        previous_handler = signal.getsignal(signum)

        def handler(received_signum, frame, *, name=signal_name, previous=previous_handler):
            logging.warning("Received %s; shutting down", name)

            if callable(previous):
                return previous(received_signum, frame)

            if received_signum == signal.SIGTERM:
                raise SystemExit(0)

            raise KeyboardInterrupt

        signal.signal(signum, handler)


install_signal_logging()


def start_background_task(name, target, *args):
    def runner():
        app.logger.info("Background task started: %s", name)

        try:
            target(*args)
        except Exception:
            app.logger.exception("Background task failed: %s", name)
        finally:
            app.logger.info("Background task finished: %s", name)

    thread = Thread(target=runner, name=name, daemon=True)
    thread.start()
    return thread

def enrich_audio_record(track):
    if not isinstance(track, dict):
        return track

    track_id = track.get("youtube_id")

    if not track_id:
        return track

    audio_file = downloader.find_existing_audio_file(track_id)
    thumbnail_file = downloader.find_existing_thumbnail_file(track_id)

    return {
        **track,
        "audio_file_exists": audio_file is not None,
        "thumbnail_file_exists": thumbnail_file is not None,
    }

def get_request_youtube_ids():
    data = request.get_json(silent=True) or {}
    youtube_ids = data.get("youtube_ids")

    if not isinstance(youtube_ids, list) or not youtube_ids:
        return None

    cleaned_ids = []
    seen_ids = set()

    for youtube_id in youtube_ids:
        clean_id = str(youtube_id or "").strip()

        if not clean_id or clean_id in seen_ids:
            continue

        cleaned_ids.append(clean_id)
        seen_ids.add(clean_id)

    return cleaned_ids or None

# Flask Endpoints ------------------------------------

@app.route("/")
def player_page():
    return render_template("player.html", active_page="player")
@app.route("/downloads")
def downloads_page():
    return render_template("downloads.html", active_page="downloads")
@app.route("/playlists")
def playlists_page():
    return render_template("playlists.html", active_page="playlists")
@app.route("/settings")
def settings_page():
    return render_template("settings.html", active_page="settings")



@app.route("/api/settings")
def get_settings():
    return jsonify(settings_helper.sync_settings())
@app.route("/api/settings", methods=["PATCH"])
def update_settings():
    updates = request.get_json() or {}

    old_quality = settings_helper.get_setting_value("audio_quality", "192")

    settings_helper.save_settings(updates)

    new_quality = settings_helper.get_setting_value("audio_quality", "192")

    if "audio_quality" in updates and str(old_quality) != str(new_quality):
        start_background_task(
            "redownload-all-for-quality",
            downloader.redownload_all_for_quality
        )

    return jsonify({"ok": True})

@app.route("/api/settings/<key>/default", methods=["POST"])
def reset_setting_to_default(key):
    old_quality = settings_helper.get_setting_value("audio_quality", "192")
    setting = settings_helper.reset_setting_to_default(key)

    if setting is None:
        return jsonify({"ok": False, "error": "Setting default not found"}), 404

    new_quality = settings_helper.get_setting_value("audio_quality", "192")

    if key == "audio_quality" and str(old_quality) != str(new_quality):
        start_background_task(
            "redownload-all-for-quality",
            downloader.redownload_all_for_quality
        )

    return jsonify({"ok": True, "key": key, "setting": setting})

@app.route("/api/auth/cookies", methods=["POST"])
def upload_cookies():
    cookies_file = request.files.get("cookies")

    if not cookies_file:
        return jsonify({"ok": False, "error": "Missing cookies.txt file"}), 400

    if cookies_file.filename != "cookies.txt":
        return jsonify({"ok": False, "error": "Upload a file named cookies.txt"}), 400

    AUTH_DIR.mkdir(parents=True, exist_ok=True)
    cookies_file.save(COOKIE_PATH)

    return jsonify({
        "ok": True,
        "message": "cookies.txt uploaded.",
        "path": str(COOKIE_PATH)
    }), 200

@app.route("/api/auth/cookies")
def cookie_status():
    exists = COOKIE_PATH.exists()
    stat = COOKIE_PATH.stat() if exists else None

    return jsonify({
        "ok": True,
        "exists": exists,
        "filename": COOKIE_PATH.name,
        "size_bytes": stat.st_size if stat else 0,
        "updated_at": (
            datetime.fromtimestamp(stat.st_mtime).isoformat(timespec="seconds")
            if stat else None
        ),
    }), 200

@app.route("/api/audios")
def api_audios():
    audios = database.get_all_audio()
    return jsonify([enrich_audio_record(track) for track in audios])

@app.route("/api/audios/bulk-delete", methods=["POST"])
def bulk_delete_audio():
    youtube_ids = get_request_youtube_ids()

    if youtube_ids is None:
        return jsonify({"ok": False, "error": "Choose at least one track"}), 400

    deleted_tracks = []
    missing_ids = []

    for youtube_id in youtube_ids:
        clean_id = str(youtube_id or "").strip()

        if not clean_id:
            continue

        track = database.get_audio_record(clean_id)

        if not track:
            missing_ids.append(clean_id)
            continue

        if database.delete_audio(clean_id):
            deleted_tracks.append(track)

            with downloader.download_status_lock:
                downloader.download_status.pop(clean_id, None)

    return jsonify({
        "ok": True,
        "deleted": [track["youtube_id"] for track in deleted_tracks],
        "tracks": deleted_tracks,
        "missing": missing_ids,
    }), 200

@app.route("/api/audios/bulk-refresh-metadata", methods=["POST"])
def bulk_refresh_audio_metadata():
    youtube_ids = get_request_youtube_ids()

    if youtube_ids is None:
        return jsonify({"ok": False, "error": "Choose at least one track"}), 400

    refreshed_tracks = []
    missing_ids = []
    failed = []

    for youtube_id in youtube_ids:
        if not database.get_audio_record(youtube_id):
            missing_ids.append(youtube_id)
            continue

        try:
            refreshed = downloader.refresh_track_metadata(youtube_id)
        except Exception as error:
            app.logger.exception("Failed to refresh metadata for %s", youtube_id)
            failed.append({
                "youtube_id": youtube_id,
                "error": downloader.clean_download_error(error),
            })
            continue

        if refreshed:
            refreshed_tracks.append(enrich_audio_record(refreshed))
        else:
            missing_ids.append(youtube_id)

    return jsonify({
        "ok": True,
        "refreshed": refreshed_tracks,
        "missing": missing_ids,
        "failed": failed,
    }), 200

@app.route("/api/audios/bulk-redownload", methods=["POST"])
def bulk_redownload_audio():
    youtube_ids = get_request_youtube_ids()

    if youtube_ids is None:
        return jsonify({"ok": False, "error": "Choose at least one track"}), 400

    result = downloader.redownload_tracks(youtube_ids)

    return jsonify({
        "ok": True,
        **result,
    }), 202

@app.route("/api/playlists")
def api_playlists():
    return jsonify(database.get_all_playlists())

@app.route("/api/playlists", methods=["POST"])
def create_playlist():
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()

    if not name:
        return jsonify({"ok": False, "error": "Playlist name is required"}), 400

    try:
        playlist = database.create_playlist(name)
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "A playlist with that name already exists"}), 409

    if not playlist:
        return jsonify({"ok": False, "error": "Playlist name is required"}), 400

    return jsonify({"ok": True, "playlist": playlist}), 201

@app.route("/api/playlists/<int:playlist_id>")
def api_playlist(playlist_id):
    playlist = database.get_playlist(playlist_id)

    if not playlist:
        return jsonify({"ok": False, "error": "Playlist not found"}), 404

    tracks = database.get_playlist_tracks(playlist_id)

    return jsonify({
        "ok": True,
        "playlist": playlist,
        "tracks": [enrich_audio_record(track) for track in tracks],
    }), 200

@app.route("/api/playlists/<int:playlist_id>", methods=["PATCH"])
def update_playlist(playlist_id):
    data = request.get_json(silent=True) or {}
    name = str(data.get("name", "")).strip()

    if not name:
        return jsonify({"ok": False, "error": "Playlist name is required"}), 400

    try:
        playlist = database.rename_playlist(playlist_id, name)
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "A playlist with that name already exists"}), 409

    if not playlist:
        return jsonify({"ok": False, "error": "Playlist not found"}), 404

    return jsonify({"ok": True, "playlist": playlist}), 200

@app.route("/api/playlists/<int:playlist_id>", methods=["DELETE"])
def delete_playlist(playlist_id):
    playlist = database.get_playlist(playlist_id)

    if not playlist:
        return jsonify({"ok": False, "error": "Playlist not found"}), 404

    youtube_ids = database.get_playlist_track_ids(playlist_id)

    if not database.delete_playlist(playlist_id):
        return jsonify({"ok": False, "error": "Playlist not found"}), 404

    return jsonify({
        "ok": True,
        "deleted": playlist_id,
        "playlist": playlist,
        "youtube_ids": youtube_ids,
    }), 200

@app.route("/api/playlists/<int:playlist_id>/tracks", methods=["POST"])
def add_playlist_tracks(playlist_id):
    data = request.get_json(silent=True) or {}
    youtube_ids = data.get("youtube_ids")

    if not isinstance(youtube_ids, list) or not youtube_ids:
        return jsonify({"ok": False, "error": "Choose at least one track"}), 400

    added_count = database.add_tracks_to_playlist(playlist_id, youtube_ids)

    if added_count is None:
        return jsonify({"ok": False, "error": "Playlist not found"}), 404

    playlist = database.get_playlist(playlist_id)

    return jsonify({
        "ok": True,
        "added": added_count,
        "playlist": playlist,
    }), 200

@app.route("/api/playlists/<int:playlist_id>/tracks/<youtube_id>", methods=["DELETE"])
def remove_playlist_track(playlist_id, youtube_id):
    if not database.remove_track_from_playlist(playlist_id, youtube_id):
        return jsonify({"ok": False, "error": "Playlist track not found"}), 404

    playlist = database.get_playlist(playlist_id)

    return jsonify({
        "ok": True,
        "removed": youtube_id,
        "playlist": playlist,
    }), 200

@app.route("/audio/<filename>")
def audio(filename):
    return send_from_directory(AUDIO_DIR, filename)
@app.route("/thumbnail/<filename>")
def thumbnail(filename):
    return send_from_directory(
        THUMBS_DIR,
        filename,
        max_age=60 * 60 * 24 * 30
    )



@app.route("/api/import", methods=["POST"])
def import_request():
    data = request.get_json(silent=True) or {}
    url = str(data.get("url", "")).strip()

    if not url:
        return jsonify({"ok": False, "error": "Missing URL"}), 400

    start_background_task("import", downloader.extract_playlist, url)

    return jsonify({"ok": True}), 202
@app.route("/api/downloads")
def api_downloads():
    with downloader.download_status_lock:
        statuses = list(downloader.download_status.values())

    return jsonify(statuses)
@app.route("/api/downloads/<download_id>", methods=["DELETE"])
def dismiss_download(download_id):
    with downloader.download_status_lock:
        removed = downloader.download_status.pop(download_id, None)

    if removed is None:
        return jsonify({"ok": False, "error": "Download status not found"}), 404

    return jsonify({"ok": True, "dismissed": download_id}), 200
@app.route("/api/download-stats")
def api_download_stats():
    with downloader.download_batches_lock:
        batches = list(downloader.download_batches.values())

    return jsonify(batches)



@app.route("/api/audios/<youtube_id>", methods=["DELETE"])
def delete_audio(youtube_id):
    if not youtube_id:
        return jsonify({"ok": False, "error": "Missing YouTube ID"}), 400

    track = database.get_audio_record(youtube_id)

    if not track:
        return jsonify({"ok": False, "error": "Track not found"}), 404

    deleted = database.delete_audio(youtube_id)

    with downloader.download_status_lock:
        downloader.download_status.pop(youtube_id, None)

    if not deleted:
        return jsonify({"ok": False, "error": "Track not found"}), 404

    return jsonify({"ok": True, "deleted": youtube_id, "track": track}), 200

@app.route("/api/audios/<youtube_id>/restore", methods=["POST"])
def restore_audio(youtube_id):
    data = request.get_json(silent=True) or {}
    track = data.get("track") if isinstance(data.get("track"), dict) else data

    if not youtube_id:
        return jsonify({"ok": False, "error": "Missing YouTube ID"}), 400

    if not isinstance(track, dict):
        return jsonify({"ok": False, "error": "Missing track data"}), 400

    track["youtube_id"] = youtube_id

    if not track.get("title"):
        return jsonify({"ok": False, "error": "Missing track title"}), 400

    database.add_audio(track)

    restored = database.get_audio_record(youtube_id)
    return jsonify({"ok": True, "restored": enrich_audio_record(restored)}), 200

@app.route("/api/audios/<youtube_id>/refresh-metadata", methods=["POST"])
def refresh_audio_metadata(youtube_id):
    if not youtube_id:
        return jsonify({"ok": False, "error": "Missing YouTube ID"}), 400

    try:
        refreshed = downloader.refresh_track_metadata(youtube_id)
    except Exception as error:
        app.logger.exception("Failed to refresh metadata for %s", youtube_id)
        return jsonify({
            "ok": False,
            "error": downloader.clean_download_error(error),
        }), 502

    if not refreshed:
        return jsonify({"ok": False, "error": "Track not found"}), 404

    return jsonify({
        "ok": True,
        "track": enrich_audio_record(refreshed),
    }), 200

def run_app() -> None:

    settings_helper.sync_settings()

    database.init_db()
    downloader.check_dirs()
    ffmpeg_tools = configure_ffmpeg(auto_download=True)
    app.logger.info(
        "Using FFmpeg from %s: %s",
        ffmpeg_tools.source if ffmpeg_tools else "unknown",
        ffmpeg_tools.location if ffmpeg_tools else "PATH",
    )
    downloader.ensure_cookie_file()
    downloader.check_dirs() #clears any downloads made for cookie registration

    if settings_helper.get_setting_value("auto_cull_orphan_files", True):
        downloader.find_and_cull_orphan_files()

    if settings_helper.get_setting_value("auto_redownload_missing", True):
        missingFiles = downloader.find_db_rows_with_missing_files()
        if missingFiles:
            print(f"Re-downloading {len(missingFiles)} Files")
            downloader.redownload_missing_files()

    print("All files pass validation.")
    print("Audio.io is running at http://localhost:8000")
    app.logger.info("Audio.io startup complete")

    app.run(host="0.0.0.0", port=8000, debug=True)
    app.logger.warning("Flask server stopped; app.run returned normally")


# Run ------------------------------------------------
if __name__ == "__main__":
    try:
        run_app()
    except KeyboardInterrupt:
        app.logger.warning("Audio.io stopped by keyboard interrupt")
    except SystemExit:
        app.logger.warning("Audio.io stopped by system exit")
    except BaseException:
        app.logger.exception("Audio.io stopped by unexpected base exception")
        raise
