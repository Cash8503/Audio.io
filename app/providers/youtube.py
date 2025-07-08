class BaseProvider:
    def fetch_playlist(self, playlist_id: str) -> list[dict]:
        """Return list of { item_id, title, url }."""
        raise NotImplementedError
