# app/providers/youtube.py

from yt_dlp import YoutubeDL
from .base import BaseProvider
from typing import List, Dict

class YouTubeProvider(BaseProvider):
    def __init__(self):
        # ydl_opts controls how yt-dlp behaves
        self.ydl_opts = {
            'extract_flat': True,   # only metadata, no nested downloads
            'skip_download': True,  # don’t fetch the actual media
            'quiet': True,          # suppress console output
        }

    def fetch_playlist(self, playlist_id: str) -> List[Dict]:
        url = f'https://www.youtube.com/playlist?list={playlist_id}'
        with YoutubeDL(self.ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

        entries = info.get('entries', []) or []
        items: List[Dict] = []
        for e in entries:
            items.append({
                'provider_item_id': e.get('id'),
                'title':             e.get('title'),
                'url':               e.get('url') or e.get('webpage_url'),
            })
        return items
