from datetime import datetime
from .extensions import db

class Playlist(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(128), nullable=False)
    is_external = db.Column(db.Boolean, default=False)
    provider = db.Column(db.String(64))
    provider_playlist_id = db.Column(db.String(128))
    last_refreshed = db.Column(db.DateTime)

    items = db.relationship('PlaylistItem', back_populates='playlist',
                            cascade="all, delete-orphan")
    blacklist = db.relationship('BlacklistEntry', back_populates='playlist',
                                cascade="all, delete-orphan")


class PlaylistItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    playlist_id = db.Column(db.Integer, db.ForeignKey('playlist.id'),
                            nullable=False)
    provider_item_id = db.Column(db.String(128), nullable=False)
    title = db.Column(db.String(256))
    url = db.Column(db.String(512))
    download_mode = db.Column(db.Enum('audio', 'video', 'both',
                                      name='download_mode'),
                              default='audio')
    local_path = db.Column(db.String(512))
    added_at = db.Column(db.DateTime, default=datetime.utcnow)

    playlist = db.relationship('Playlist', back_populates='items')


class BlacklistEntry(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    playlist_id = db.Column(db.Integer, db.ForeignKey('playlist.id'),
                            nullable=False)
    provider_item_id = db.Column(db.String(128), nullable=False)

    playlist = db.relationship('Playlist', back_populates='blacklist')
