from app.providers import AVAILABLE_PROVIDERS
from app.models import Playlist, PlaylistItem, BlacklistEntry
from app.extensions import db

def sync_external(playlist_id: int):
    pl = Playlist.query.get(playlist_id)
    prov = AVAILABLE_PROVIDERS[pl.provider]
    external = prov.fetch_playlist(pl.provider_playlist_id)

    # 1. Filter out blacklisted IDs
    blacklisted = {b.provider_item_id for b in pl.blacklist}

    # 2. Find which external items are new
    existing = {i.provider_item_id for i in pl.items}
    new_items = [e for e in external
                 if e['provider_item_id'] not in existing
                 and e['provider_item_id'] not in blacklisted]

    # 3. Insert new ones
    for e in new_items:
        item = PlaylistItem(
            playlist=pl,
            provider_item_id=e['provider_item_id'],
            title=e['title'],
            url=e['url']
        )
        db.session.add(item)

    pl.last_refreshed = datetime.utcnow()
    db.session.commit()
