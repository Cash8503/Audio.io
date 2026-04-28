from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import os
import platform
import re
import shutil
import stat
import tarfile
import tempfile
import zipfile
from urllib.request import Request, urlopen


BTBN_RELEASE_API = "https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/tags/latest"
USER_AGENT = "Audio.io ffmpeg bootstrap"


@dataclass(frozen=True)
class FFmpegTools:
    ffmpeg: Path
    ffprobe: Path
    location: Path
    source: str


def resolve_ffmpeg_tools(base_dir: Path, cache_dir: Path) -> FFmpegTools | None:
    cached_tools = None

    try:
        cached_tools = _find_tools_in_dir(_platform_cache_dir(cache_dir), "downloaded")
    except RuntimeError:
        pass

    return (
        _find_tools_in_dir(base_dir / "ffmpeg", "bundled")
        or cached_tools
        or _find_system_tools()
    )


def ensure_ffmpeg_tools(base_dir: Path, cache_dir: Path) -> FFmpegTools:
    existing = resolve_ffmpeg_tools(base_dir, cache_dir)

    if existing:
        return existing

    return _download_tools(cache_dir)


def _tool_name(name: str) -> str:
    return f"{name}.exe" if platform.system().lower() == "windows" else name


def _find_tools_in_dir(directory: Path, source: str) -> FFmpegTools | None:
    ffmpeg = directory / _tool_name("ffmpeg")
    ffprobe = directory / _tool_name("ffprobe")

    if ffmpeg.is_file() and ffprobe.is_file():
        return FFmpegTools(ffmpeg=ffmpeg, ffprobe=ffprobe, location=directory, source=source)

    return None


def _find_system_tools() -> FFmpegTools | None:
    ffmpeg = shutil.which("ffmpeg")
    ffprobe = shutil.which("ffprobe")

    if not ffmpeg or not ffprobe:
        return None

    ffmpeg_path = Path(ffmpeg)
    ffprobe_path = Path(ffprobe)
    location = ffmpeg_path.parent if ffmpeg_path.parent == ffprobe_path.parent else ffmpeg_path
    return FFmpegTools(ffmpeg=ffmpeg_path, ffprobe=ffprobe_path, location=location, source="system")


def _platform_key() -> str:
    system = platform.system().lower()
    machine = platform.machine().lower()

    is_arm64 = machine in {"arm64", "aarch64"}
    is_x64 = machine in {"amd64", "x86_64", "x64"}

    if system == "windows" and is_x64:
        return "win64"
    if system == "windows" and is_arm64:
        return "winarm64"
    if system == "linux" and is_x64:
        return "linux64"
    if system == "linux" and is_arm64:
        return "linuxarm64"

    raise RuntimeError(f"Automatic FFmpeg download is not supported for {system}/{machine}. Install ffmpeg and ffprobe on PATH.")


def _platform_cache_dir(cache_dir: Path) -> Path:
    return cache_dir / _platform_key()


def _download_tools(cache_dir: Path) -> FFmpegTools:
    platform_key = _platform_key()
    target_dir = _platform_cache_dir(cache_dir)
    cache_root = cache_dir.resolve()
    target_parent = target_dir.parent.resolve()

    if target_parent != cache_root:
        raise RuntimeError(f"Refusing to write FFmpeg outside cache directory: {target_dir}")

    release = _fetch_json(BTBN_RELEASE_API)
    assets = release.get("assets", [])
    asset = _select_asset(assets, platform_key)
    checksum_asset = _find_asset(assets, "checksums.sha256")

    if not asset:
        raise RuntimeError(f"No FFmpeg build found for {platform_key}. Install ffmpeg and ffprobe on PATH.")
    if not checksum_asset:
        raise RuntimeError("Could not find FFmpeg checksum asset.")

    cache_dir.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="ffmpeg-download-", dir=cache_dir) as tmp_name:
        tmp_dir = Path(tmp_name)
        archive_path = tmp_dir / asset["name"]
        checksum_path = tmp_dir / checksum_asset["name"]

        _download(asset["browser_download_url"], archive_path)
        _download(checksum_asset["browser_download_url"], checksum_path)
        _verify_checksum(archive_path, checksum_path)

        extract_dir = tmp_dir / "extract"
        extract_dir.mkdir()
        _extract_archive(archive_path, extract_dir)

        ffmpeg = _find_extracted_tool(extract_dir, "ffmpeg")
        ffprobe = _find_extracted_tool(extract_dir, "ffprobe")

        if not ffmpeg or not ffprobe:
            raise RuntimeError("Downloaded FFmpeg archive did not contain ffmpeg and ffprobe.")

        if target_dir.exists():
            shutil.rmtree(target_dir)

        target_dir.mkdir(parents=True)
        target_ffmpeg = target_dir / _tool_name("ffmpeg")
        target_ffprobe = target_dir / _tool_name("ffprobe")
        shutil.copy2(ffmpeg, target_ffmpeg)
        shutil.copy2(ffprobe, target_ffprobe)
        _make_executable(target_ffmpeg)
        _make_executable(target_ffprobe)

    return FFmpegTools(ffmpeg=target_ffmpeg, ffprobe=target_ffprobe, location=target_dir, source="downloaded")


def _fetch_json(url: str) -> dict:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"})

    with urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def _download(url: str, destination: Path) -> None:
    request = Request(url, headers={"User-Agent": USER_AGENT})

    with urlopen(request, timeout=120) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)


def _find_asset(assets: list[dict], name: str) -> dict | None:
    for asset in assets:
        if asset.get("name") == name:
            return asset

    return None


def _select_asset(assets: list[dict], platform_key: str) -> dict | None:
    release_assets = []
    master_asset = None

    for asset in assets:
        name = str(asset.get("name") or "")

        if platform_key not in name or "-gpl" not in name or "-shared" in name:
            continue

        release_match = re.match(
            rf"ffmpeg-n(?P<version>[0-9.]+)-latest-{re.escape(platform_key)}-gpl-(?P=version)\.(?:zip|tar\.xz)$",
            name,
        )

        if release_match:
            release_assets.append((_version_key(release_match.group("version")), asset))
            continue

        if name == f"ffmpeg-master-latest-{platform_key}-gpl.zip" or name == f"ffmpeg-master-latest-{platform_key}-gpl.tar.xz":
            master_asset = asset

    if release_assets:
        release_assets.sort(key=lambda item: item[0], reverse=True)
        return release_assets[0][1]

    return master_asset


def _version_key(version: str) -> tuple[int, ...]:
    return tuple(int(part) for part in version.split(".") if part.isdigit())


def _verify_checksum(archive_path: Path, checksum_path: Path) -> None:
    expected = None

    for line in checksum_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = line.strip().split()

        if len(parts) >= 2 and parts[-1].lstrip("*") == archive_path.name:
            expected = parts[0].lower()
            break

    if not expected:
        raise RuntimeError(f"No SHA256 checksum found for {archive_path.name}.")

    actual = hashlib.sha256(archive_path.read_bytes()).hexdigest()

    if actual.lower() != expected:
        raise RuntimeError(f"FFmpeg checksum mismatch for {archive_path.name}.")


def _extract_archive(archive_path: Path, destination: Path) -> None:
    if archive_path.suffix == ".zip":
        with zipfile.ZipFile(archive_path) as archive:
            for member in archive.infolist():
                output_path = (destination / member.filename).resolve()

                if not output_path.is_relative_to(destination.resolve()):
                    raise RuntimeError(f"Unsafe path in FFmpeg archive: {member.filename}")

            archive.extractall(destination)
        return

    if archive_path.name.endswith(".tar.xz"):
        with tarfile.open(archive_path, "r:xz") as archive:
            for member in archive.getmembers():
                output_path = (destination / member.name).resolve()

                if not output_path.is_relative_to(destination.resolve()):
                    raise RuntimeError(f"Unsafe path in FFmpeg archive: {member.name}")

            archive.extractall(destination)
        return

    raise RuntimeError(f"Unsupported FFmpeg archive type: {archive_path.name}")


def _find_extracted_tool(directory: Path, name: str) -> Path | None:
    tool_name = _tool_name(name)

    for path in directory.rglob(tool_name):
        if path.is_file() and path.parent.name == "bin":
            return path

    for path in directory.rglob(tool_name):
        if path.is_file():
            return path

    return None


def _make_executable(path: Path) -> None:
    if platform.system().lower() == "windows":
        return

    current_mode = path.stat().st_mode
    path.chmod(current_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
