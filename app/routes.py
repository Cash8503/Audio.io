from flask import Blueprint, render_template, request, redirect, url_for
from .extensions import db
from .models import Playlist, PlaylistItem

bp = Blueprint('main', __name__)

@bp.route('/')
def index():
    playlists = Playlist.query.all()
    return render_template('index.html', playlists=playlists)

# — Create a new local playlist —
@bp.route('/playlists/create', methods=['POST'])
def create_playlist():
    name = request.form.get('name', '').strip()
    if name:
        pl = Playlist(name=name, is_external=False)
        db.session.add(pl)
        db.session.commit()
    return redirect(url_for('main.index'))

# — Delete a playlist (and its items via cascade) —
@bp.route('/playlists/<int:pid>/delete', methods=['POST'])
def delete_playlist(pid):
    pl = Playlist.query.get_or_404(pid)
    db.session.delete(pl)
    db.session.commit()
    return redirect(url_for('main.index'))

# — Add an item to a local playlist —
@bp.route('/playlists/<int:pid>/items/create', methods=['POST'])
def create_item(pid):
    pl = Playlist.query.get_or_404(pid)
    provider_item_id = request.form.get('provider_item_id', '').strip()
    title = request.form.get('title', '').strip() or provider_item_id
    url = request.form.get('url', '').strip() or ''
    if provider_item_id:
        item = PlaylistItem(
            playlist=pl,
            provider_item_id=provider_item_id,
            title=title,
            url=url
        )
        db.session.add(item)
        db.session.commit()
    return redirect(url_for('main.index'))

# — Remove a single item from a playlist —
@bp.route('/playlists/<int:pid>/items/<int:iid>/delete', methods=['POST'])
def delete_item(pid, iid):
    item = PlaylistItem.query.filter_by(id=iid, playlist_id=pid).first_or_404()
    db.session.delete(item)
    db.session.commit()
    return redirect(url_for('main.index'))
