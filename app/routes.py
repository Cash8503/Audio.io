from flask import Blueprint, render_template
from .models import Playlist
from .extensions import db

bp = Blueprint('main', __name__)

@bp.route('/')
def index():
    playlists = Playlist.query.all()
    return render_template('index.html', playlists=playlists)
