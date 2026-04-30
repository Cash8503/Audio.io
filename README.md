# Audio.io

Audio.io is a local Flask web app for downloading, organizing, and playing audio from YouTube URLs and playlists. It uses `yt-dlp` for extraction, FFmpeg for MP3 conversion, and SQLite for the local library database.

## Features

- Import individual tracks or playlists from YouTube-compatible URLs
- Convert downloads to MP3 with bundled, system, or automatically downloaded FFmpeg tools
- Browse and play your downloaded audio library in the browser
- Save thumbnails and track metadata locally
- Monitor active, queued, completed, and failed downloads
- Tune settings from the web UI, including theme, accent color, audio quality, and concurrent downloads
- Automatically repair missing files and clean orphaned files on startup

## Project Structure

```text
.
+-- main.py                  # Flask app and API routes
+-- downloader.py            # yt-dlp download, playlist, status, and repair logic
+-- database.py              # SQLite setup and audio library queries
+-- settings.py              # Runtime settings sync and persistence
+-- config.py                # Paths and shared constants
+-- settings.example.json    # Default settings schema and values
+-- templates/               # Flask/Jinja pages and partials
+-- static/                  # CSS, JavaScript, and image assets
+-- ffmpeg/                  # Optional bundled FFmpeg executables
+-- data/                    # Runtime database, settings, audio, and thumbnails
```

## Requirements

- Python 3.10 or newer
- Windows or Linux. FFmpeg is resolved from bundled binaries, system `PATH`, or downloaded release binaries on first startup.
- Internet access for `yt-dlp` downloads and updates

Python packages are listed in `requirements.txt`:

```text
Flask==3.1.0
yt-dlp==2026.03.17
```

## Setup

1. Create and activate a virtual environment:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
```

2. Install dependencies:

```powershell
py -3 -m pip install -r requirements.txt
```

3. Start the app:

```powershell
py -3 main.py
```

4. Open the app in your browser:

```text
http://localhost:8000
```

On startup, Audio.io initializes the database, creates missing runtime folders, syncs settings from `settings.example.json`, makes sure FFmpeg/ffprobe are available, and prepares YouTube cookie support when possible.

## Usage

- Go to `/` to browse and play your local library.
- Go to `/downloads` to submit a URL and watch download progress.
- Go to `/settings` to change theme, accent color, audio quality, concurrent downloads, and startup repair behavior.

Downloaded MP3 files, thumbnails, the SQLite database, and runtime settings are stored under `data/`.

## Development

Run a quick syntax check:

```powershell
py -3 -m py_compile main.py downloader.py settings.py config.py database.py sharedhelpers.py
```

Useful API routes:

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/audios` | `GET` | List downloaded audio records |
| `/api/import` | `POST` | Start importing a track or playlist from a JSON `{ "url": "..." }` body |
| `/api/downloads` | `GET` | Get current download statuses |
| `/api/downloads/<download_id>` | `DELETE` | Dismiss a download status |
| `/api/download-stats` | `GET` | Get batch download summaries |
| `/api/settings` | `GET` | Load synced settings |
| `/api/settings` | `PATCH` | Update settings |
| `/api/audios/<youtube_id>` | `DELETE` | Delete a library record |
| `/api/audios/<youtube_id>/refresh-metadata` | `POST` | Refresh saved track metadata and thumbnail from YouTube |

## Git Notes

Runtime files in `data/`, Python cache files, and environment files should stay out of Git. The README is explicitly unignored so it can be committed even though other Markdown notes may remain local.

## License

No license has been added yet.
