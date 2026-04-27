import os

from flask import Flask, render_template, jsonify, send_from_directory, request
import logging
import database
import downloader
import settings as settings_helper
from config import *
from threading import Thread

app = Flask(__name__, static_folder="static")

class IgnoreRouteFilter(logging.Filter):
    def filter(self, record):
        return "/api/downloads" not in record.getMessage()

logging.getLogger("werkzeug").addFilter(IgnoreRouteFilter())

# HELPERS --------------------------------------------

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
        Thread(target=downloader.redownload_all_for_quality, daemon=True).start()

    return jsonify({"ok": True})

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



@app.route("/import/<path:url>", methods=["POST"])
def importReq(url):
    Thread(
        target=downloader.extract_playlist,
        args=(url,),
        daemon=True
    ).start()
    return jsonify({"ok": True})
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

    deleted = database.delete_audio(youtube_id)

    with downloader.download_status_lock:
        downloader.download_status.pop(youtube_id, None)

    if not deleted:
        return jsonify({"ok": False, "error": "Track not found"}), 404

    return jsonify({"ok": True, "deleted": youtube_id}), 200

# Run ------------------------------------------------
if __name__ == "__main__":
    settings_helper.sync_settings()

    database.init_db()
    downloader.check_dirs()

    if settings_helper.get_setting_value("auto_cull_orphan_files", True):
        downloader.find_and_cull_orphan_files()

    if settings_helper.get_setting_value("auto_redownload_missing", True):
        missingFiles = downloader.find_db_rows_with_missing_files()
        if missingFiles:
            print(f"Re-downloading {len(missingFiles)} Files")
            downloader.redownload_missing_files()

    print("All files pass validation.")
    print("Audio.io is running at http://localhost:8000")

    app.run(host="0.0.0.0", port=8000, debug=False, use_reloader=False)
