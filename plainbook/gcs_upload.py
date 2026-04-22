import json
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from google.cloud import storage
from google.oauth2 import service_account


def _require_bucket_name() -> str:
    bucket_name = os.environ.get("GCS_STUDY_BUCKET", "").strip()
    if not bucket_name:
        raise ValueError("GCS_STUDY_BUCKET is not configured")
    return bucket_name


def _get_storage_client() -> storage.Client:
    # Prefer explicit service-account JSON from env for Codespaces.
    # Fallback to ADC when running on GCP with workload identity.
    service_account_json = os.environ.get("GCP_SERVICE_ACCOUNT_JSON", "").strip()
    if service_account_json:
        info = json.loads(service_account_json)
        creds = service_account.Credentials.from_service_account_info(info)
        project_id = info.get("project_id")
        return storage.Client(project=project_id, credentials=creds)
    return storage.Client()


def _safe_name(name: str) -> str:
    # Keep object names predictable and avoid unsafe path chars.
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_") or "notebook"


def build_object_path(notebook_name: str, prefix: Optional[str] = None) -> str:
    base_prefix = (prefix or os.environ.get("GCS_STUDY_PREFIX") or "user-studies").strip("/")
    now = datetime.now(timezone.utc)
    date_part = now.strftime("%Y-%m-%d")
    time_part = now.strftime("%H%M%S")
    unique = uuid.uuid4().hex[:12]
    safe_name = _safe_name(notebook_name)
    if not safe_name.endswith(".plnb"):
        safe_name = f"{safe_name}.plnb"
    return f"{base_prefix}/{date_part}/{time_part}_{unique}_{safe_name}"


def upload_notebook_json(notebook_json: dict, object_path: str) -> str:
    bucket_name = _require_bucket_name()
    client = _get_storage_client()
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(object_path)
    payload = json.dumps(notebook_json, ensure_ascii=True, indent=1)
    blob.upload_from_string(
        payload,
        content_type="application/json",
    )
    return object_path
