"""Spotify helpers.

Riders authorise Spotify on their own phone with OAuth PKCE (no client secret
in the app or here). The backend only validates and relays track URIs — it
never touches Spotify audio and never holds riders' Spotify tokens.
"""

import re

_URI = re.compile(r"^spotify:(track|episode|playlist|album):([A-Za-z0-9]{22})$")
_URL = re.compile(r"^https://open\.spotify\.com/(track|episode|playlist|album)/([A-Za-z0-9]{22})")


def normalise_uri(value: str) -> str | None:
    """Accept a spotify: URI or an open.spotify.com link, return the URI."""
    value = value.strip()
    if m := _URI.match(value):
        return value
    if m := _URL.match(value):
        return f"spotify:{m.group(1)}:{m.group(2)}"
    return None


SCOPES = [
    "user-read-playback-state",
    "user-modify-playback-state",
    "user-read-currently-playing",
    "playlist-read-private",
    "app-remote-control",
]
