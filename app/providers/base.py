# app/providers/base.py

from abc import ABC, abstractmethod
from typing import List, Dict

class BaseProvider(ABC):
    @abstractmethod
    def fetch_playlist(self, playlist_id: str) -> List[Dict]:
        """
        Given an external playlist ID, return a list of items:
        [
          {
            'provider_item_id': str,  # unique ID in the external service
            'title': str,             # human-readable title
            'url': str,               # URL we can later download/stream
          },
          ...
        ]
        """
        raise NotImplementedError
