from pathlib import Path
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
AUDIO_EXTENSIONS = {".mp3"}
THUMB_EXTENSIONS = {".jpg"}

YTDL_ARGS = {
    'format': 'bestaudio*/best',
    'outtmpl': str(INCOMPLETE_DIR / "%(id)s.%(ext)s"),
    'ffmpeg_location': str(BASE_DIR / 'ffmpeg'),
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


FFMPEG = str(BASE_DIR / "ffmpeg" / "ffmpeg.exe")
FFPROBE = str(BASE_DIR / "ffmpeg" / "ffprobe.exe")
