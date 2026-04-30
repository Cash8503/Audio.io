import sqlite3
from contextlib import contextmanager
from config import *

AUDIO_COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "youtube_id": "TEXT UNIQUE",
    "title": "TEXT",
    "uploader": "TEXT",
    "duration": "INTEGER",
    "audio_path": "TEXT",
    "thumbnail_path": "TEXT",
    "description": "TEXT",
    "audio_quality": "TEXT",
    "requested_audio_quality": "TEXT",
    "audio_bitrate": "INTEGER",
    "metadata_refreshed_at": "TEXT",
    "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
}

PLAYLIST_COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "name": "TEXT NOT NULL UNIQUE",
    "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
}

PLAYLIST_TRACK_COLUMNS = {
    "id": "INTEGER PRIMARY KEY AUTOINCREMENT",
    "playlist_id": "INTEGER NOT NULL",
    "youtube_id": "TEXT NOT NULL",
    "position": "INTEGER NOT NULL DEFAULT 0",
    "created_at": "TIMESTAMP DEFAULT CURRENT_TIMESTAMP",
}

@contextmanager
def get_connection():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def create_table_sql(table_name, columns):
    column_sql = []

    for name, definition in columns.items():
        column_sql.append(f"{name} {definition}".strip())

    columns_joined = ",\n".join(column_sql)

    return f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            {columns_joined}
        )
    """

def ensure_columns(table_name, expected_columns):
    with get_connection() as conn:
        existing_columns = conn.execute(f"""
            PRAGMA table_info({table_name})
        """).fetchall()

        existing_column_names = [column["name"] for column in existing_columns]

        for column_name, column_definition in expected_columns.items():
            if column_name not in existing_column_names:
                print(f"Adding missing column: {column_name}")

                conn.execute(f"""
                    ALTER TABLE {table_name}
                    ADD COLUMN {column_name} {column_definition}
                """)

def init_db():
    with get_connection() as conn:
        conn.execute(create_table_sql("audios", AUDIO_COLUMNS))
        conn.execute(create_table_sql("playlists", PLAYLIST_COLUMNS))
        conn.execute(create_table_sql("playlist_tracks", PLAYLIST_TRACK_COLUMNS))
        conn.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_tracks_unique
            ON playlist_tracks (playlist_id, youtube_id)
        """)

    ensure_columns("audios", AUDIO_COLUMNS)
    ensure_columns("playlists", PLAYLIST_COLUMNS)
    ensure_columns("playlist_tracks", PLAYLIST_TRACK_COLUMNS)

def add_audio(item):
    with get_connection() as conn:
        conn.execute("""
            INSERT OR REPLACE INTO audios (
                youtube_id,
                title,
                uploader,
                duration,
                audio_path,
                thumbnail_path,
                description,
                audio_quality,
                requested_audio_quality,
                audio_bitrate,
                metadata_refreshed_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            item.get("youtube_id"),
            item.get("title"),
            item.get("uploader"),
            item.get("duration"),
            item.get("audio_path"),
            item.get("thumbnail_path"),
            item.get("description"),
            item.get("audio_quality"),
            item.get("requested_audio_quality"),
            item.get("audio_bitrate"),
            item.get("metadata_refreshed_at")
        ))

def update_audio_metadata(youtube_id, updates):
    allowed_columns = {
        "title",
        "uploader",
        "duration",
        "thumbnail_path",
        "description",
        "metadata_refreshed_at",
    }

    filtered_updates = {
        key: value
        for key, value in updates.items()
        if key in allowed_columns
    }

    if not filtered_updates:
        return get_audio_record(youtube_id)

    assignments = ", ".join(f"{key} = ?" for key in filtered_updates)
    values = list(filtered_updates.values())
    values.append(youtube_id)

    with get_connection() as conn:
        cursor = conn.execute(f"""
            UPDATE audios
            SET {assignments}
            WHERE youtube_id = ?
        """, values)

        if cursor.rowcount == 0:
            return None

    return get_audio_record(youtube_id)

def audio_exists(youtube_id):
    with get_connection() as conn:
        result = conn.execute("""
            SELECT 1
            FROM audios
            WHERE youtube_id = ?
            LIMIT 1
        """, (youtube_id,)).fetchone()

        return result is not None

def get_audio_record(youtube_id):
    with get_connection() as conn:
        row = conn.execute("""
            SELECT *
            FROM audios
            WHERE youtube_id = ?
            LIMIT 1
        """, (youtube_id,)).fetchone()

        return dict(row) if row else None

def get_all_audio():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT *
            FROM audios
            ORDER BY id DESC
        """).fetchall()

        return [dict(row) for row in rows]

def delete_audio(youtube_id):
    with get_connection() as conn:
        conn.execute("""
            DELETE FROM playlist_tracks
            WHERE youtube_id = ?
        """, (youtube_id,))

        cursor = conn.execute("""
            DELETE FROM audios
            WHERE youtube_id = ?
        """, (youtube_id,))

        return cursor.rowcount > 0

def create_playlist(name):
    cleaned_name = str(name or "").strip()

    if not cleaned_name:
        return None

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO playlists (name)
            VALUES (?)
        """, (cleaned_name,))

        playlist_id = cursor.lastrowid

    return get_playlist(playlist_id)

def get_playlist(playlist_id):
    with get_connection() as conn:
        row = conn.execute("""
            SELECT
                playlists.*,
                COUNT(playlist_tracks.youtube_id) AS track_count
            FROM playlists
            LEFT JOIN playlist_tracks
                ON playlist_tracks.playlist_id = playlists.id
            WHERE playlists.id = ?
            GROUP BY playlists.id
            LIMIT 1
        """, (playlist_id,)).fetchone()

        return dict(row) if row else None

def get_playlist_by_name(name):
    cleaned_name = str(name or "").strip()

    if not cleaned_name:
        return None

    with get_connection() as conn:
        row = conn.execute("""
            SELECT
                playlists.*,
                COUNT(playlist_tracks.youtube_id) AS track_count
            FROM playlists
            LEFT JOIN playlist_tracks
                ON playlist_tracks.playlist_id = playlists.id
            WHERE playlists.name = ?
            GROUP BY playlists.id
            LIMIT 1
        """, (cleaned_name,)).fetchone()

        return dict(row) if row else None

def get_or_create_playlist(name):
    playlist = get_playlist_by_name(name)

    if playlist:
        return playlist

    return create_playlist(name)

def get_all_playlists():
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT
                playlists.*,
                COUNT(playlist_tracks.youtube_id) AS track_count
            FROM playlists
            LEFT JOIN playlist_tracks
                ON playlist_tracks.playlist_id = playlists.id
            GROUP BY playlists.id
            ORDER BY playlists.name COLLATE NOCASE ASC
        """).fetchall()

        return [dict(row) for row in rows]

def rename_playlist(playlist_id, name):
    cleaned_name = str(name or "").strip()

    if not cleaned_name:
        return None

    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE playlists
            SET name = ?
            WHERE id = ?
        """, (cleaned_name, playlist_id))

        if cursor.rowcount == 0:
            return None

    return get_playlist(playlist_id)

def delete_playlist(playlist_id):
    with get_connection() as conn:
        conn.execute("""
            DELETE FROM playlist_tracks
            WHERE playlist_id = ?
        """, (playlist_id,))

        cursor = conn.execute("""
            DELETE FROM playlists
            WHERE id = ?
        """, (playlist_id,))

        return cursor.rowcount > 0

def add_tracks_to_playlist(playlist_id, youtube_ids):
    cleaned_ids = [
        str(youtube_id).strip()
        for youtube_id in youtube_ids
        if str(youtube_id or "").strip()
    ]

    if not cleaned_ids:
        return 0

    with get_connection() as conn:
        playlist = conn.execute("""
            SELECT id
            FROM playlists
            WHERE id = ?
            LIMIT 1
        """, (playlist_id,)).fetchone()

        if not playlist:
            return None

        position_row = conn.execute("""
            SELECT COALESCE(MAX(position), -1) AS max_position
            FROM playlist_tracks
            WHERE playlist_id = ?
        """, (playlist_id,)).fetchone()
        next_position = int(position_row["max_position"]) + 1
        added_count = 0

        for youtube_id in cleaned_ids:
            exists = conn.execute("""
                SELECT 1
                FROM audios
                WHERE youtube_id = ?
                LIMIT 1
            """, (youtube_id,)).fetchone()

            if not exists:
                continue

            cursor = conn.execute("""
                INSERT OR IGNORE INTO playlist_tracks (
                    playlist_id,
                    youtube_id,
                    position
                )
                VALUES (?, ?, ?)
            """, (playlist_id, youtube_id, next_position))

            if cursor.rowcount:
                added_count += 1
                next_position += 1

        return added_count

def remove_track_from_playlist(playlist_id, youtube_id):
    with get_connection() as conn:
        cursor = conn.execute("""
            DELETE FROM playlist_tracks
            WHERE playlist_id = ? AND youtube_id = ?
        """, (playlist_id, youtube_id))

        return cursor.rowcount > 0

def get_playlist_track_ids(playlist_id):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT youtube_id
            FROM playlist_tracks
            WHERE playlist_id = ?
            ORDER BY position ASC, created_at ASC
        """, (playlist_id,)).fetchall()

        return [row["youtube_id"] for row in rows]

def get_playlist_tracks(playlist_id):
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT audios.*
            FROM playlist_tracks
            JOIN audios
                ON audios.youtube_id = playlist_tracks.youtube_id
            WHERE playlist_tracks.playlist_id = ?
            ORDER BY playlist_tracks.position ASC, playlist_tracks.created_at ASC
        """, (playlist_id,)).fetchall()

        return [dict(row) for row in rows]
