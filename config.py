from pathlib import Path
from ffmpeg_manager import ensure_ffmpeg_tools, resolve_ffmpeg_tools

MAX_WORKERS = 6

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = DATA_DIR / "audioio.db"
SETTINGS_PATH = DATA_DIR / "settings.json"
AUDIO_DIR = DATA_DIR / "audios"
THUMBS_DIR = DATA_DIR / "thumbnails"
INCOMPLETE_DIR = DATA_DIR / "incomplete"
AUTH_DIR = DATA_DIR / "auth"
COOKIE_PATH = AUTH_DIR / "cookies.txt"
STATIC_DIR = BASE_DIR / "static"
HTML_DIR = STATIC_DIR / "html"
CSS_DIR = STATIC_DIR / "css"
JS_DIR = STATIC_DIR / "js"
FFMPEG_DOWNLOAD_DIR = DATA_DIR / "ffmpeg"
AUDIO_EXTENSIONS = {".mp3"}
THUMB_EXTENSIONS = {".jpg"}

YTDL_ARGS = {
    'format': 'bestaudio*/best',
    'outtmpl': str(INCOMPLETE_DIR / "%(id)s.%(ext)s"),
    'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
    'writethumbnail': True,
    'quiet': True,
    'no_warnings': True,
    'noplaylist': True,
    'noprogress': True,
}

FLAT_ARGS = {
    'extract_flat': True,
    'quiet': True,
    'no_warnings': True
}


FFMPEG = "ffmpeg"
FFPROBE = "ffprobe"


def _apply_ffmpeg_tools(tools):
    global FFMPEG, FFPROBE

    FFMPEG = str(tools.ffmpeg)
    FFPROBE = str(tools.ffprobe)
    YTDL_ARGS["ffmpeg_location"] = str(tools.location)


def configure_ffmpeg(auto_download=False):
    tools = (
        ensure_ffmpeg_tools(BASE_DIR, FFMPEG_DOWNLOAD_DIR)
        if auto_download
        else resolve_ffmpeg_tools(BASE_DIR, FFMPEG_DOWNLOAD_DIR)
    )

    if tools:
        _apply_ffmpeg_tools(tools)

    return tools


configure_ffmpeg(auto_download=False)


def get_config_dirs():
    return [
        value
        for key, value in globals().items()
        if key.endswith("_DIR") and isinstance(value, Path)
    ]
