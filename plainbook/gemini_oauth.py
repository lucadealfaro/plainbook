"""Gemini OAuth 2.0 flow for authenticating with a Google account.

Uses the "Desktop app" OAuth client type, which supports dynamic loopback
ports per RFC 8252.  Tokens are stored in ~/.config/plainbook/ and are
automatically refreshed when expired.
"""

import base64
import hashlib
import secrets
from pathlib import Path
from urllib.parse import urlencode

import requests as http_requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

# ---------------------------------------------------------------------------
# GCP OAuth Client credentials (Desktop app type — safe to ship in code)
# Replace these with your actual GCP project credentials.
# ---------------------------------------------------------------------------
GOOGLE_CLIENT_ID = "857458611885-71qbr7oi38etb8lllnp0rn2oqr2q5rjk.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET = "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"

SCOPES = ["https://www.googleapis.com/auth/generative-language.retriever"]
TOKEN_URI = "https://oauth2.googleapis.com/token"
AUTH_URI = "https://accounts.google.com/o/oauth2/v2/auth"

# Storage
APP_NAME = "plainbook"
CONFIG_DIR = Path.home() / ".config" / APP_NAME
TOKEN_PATH = CONFIG_DIR / "gemini_oauth_token.json"

# In-flight OAuth state (keyed by state string)
_pending_flows = {}


def _make_code_verifier():
    """Generate a PKCE code_verifier (RFC 7636)."""
    return secrets.token_urlsafe(64)


def _make_code_challenge(verifier):
    """S256 code challenge from a verifier."""
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def get_oauth_url(port):
    """Build the Google OAuth consent URL.

    Returns (auth_url, state) — the state is used to match the callback.
    """
    state = secrets.token_urlsafe(32)
    code_verifier = _make_code_verifier()
    code_challenge = _make_code_challenge(code_verifier)
    redirect_uri = f"http://127.0.0.1:{port}/oauth_callback"

    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{AUTH_URI}?{urlencode(params)}"

    # Remember state + verifier for the callback
    _pending_flows[state] = {
        "code_verifier": code_verifier,
        "redirect_uri": redirect_uri,
    }
    return auth_url, state


def exchange_code(code, state):
    """Exchange an authorization code for tokens and save them.

    Returns True on success, raises on failure.
    """
    flow_data = _pending_flows.pop(state, None)
    if flow_data is None:
        raise ValueError("Unknown or expired OAuth state")

    resp = http_requests.post(TOKEN_URI, data={
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "code": code,
        "code_verifier": flow_data["code_verifier"],
        "grant_type": "authorization_code",
        "redirect_uri": flow_data["redirect_uri"],
    })
    resp.raise_for_status()
    token_data = resp.json()

    # Build a Credentials object and persist it
    creds = Credentials(
        token=token_data["access_token"],
        refresh_token=token_data.get("refresh_token"),
        token_uri=TOKEN_URI,
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(TOKEN_PATH, "w") as f:
        f.write(creds.to_json())
    return True


def load_oauth_credentials():
    """Load and (if needed) refresh stored OAuth credentials.

    Returns a valid Credentials object, or None if no token exists or
    refresh fails.
    """
    if not TOKEN_PATH.exists():
        return None
    try:
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    except Exception:
        return None

    if creds.valid:
        return creds

    if creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
            with open(TOKEN_PATH, "w") as f:
                f.write(creds.to_json())
            return creds
        except Exception:
            return None

    return None


def has_oauth_credentials():
    """Check whether a usable OAuth token exists."""
    return load_oauth_credentials() is not None


