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
        column_sql.append(f"{name} {definition}")

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

    ensure_columns("audios", AUDIO_COLUMNS)

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
                audio_bitrate
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            item.get("audio_bitrate")
        ))

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
        cursor = conn.execute("""
            DELETE FROM audios
            WHERE youtube_id = ?
        """, (youtube_id,))

        return cursor.rowcount > 0
