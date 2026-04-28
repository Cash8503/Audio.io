from flask import Flask, render_template, jsonify, send_from_directory, request
import atexit
import faulthandler
import logging
import signal
import sys
import threading
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

# Flask Endpoints ------------------------------------

@app.route("/")
def player_page():
    return render_template("player.html", active_page="player")
@app.route("/downloads")
def downloads_page():
    return render_template("downloads.html", active_page="downloads")
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

@app.route("/api/audios")
def api_audios():
    audios = database.get_all_audio()
    return jsonify(audios)
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
    return jsonify({"ok": True, "restored": restored}), 200

def run_app():

    settings_helper.sync_settings()

    database.init_db()
    downloader.check_dirs()
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
