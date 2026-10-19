"""Strict reference-film generation through the application's real job queue.

No model loaders or synthetic fallbacks live here. Every accepted artifact
must belong to a completed Studio job and exist beneath its output directory.
Receipts are written before polling so interrupted validation retains job IDs.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
import time
from urllib.parse import quote, urlsplit
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


class ReferenceGenerationClient:
    def __init__(self, base_url: str, output_dir: Path, receipt_dir: Path, *,
                 token: str = "", timeout: float = 3600, poll_interval: float = 2):
        from .offline_strict import ConnectionAuditor
        parsed = urlsplit(base_url)
        host = parsed.hostname or ""
        if parsed.scheme not in {"http", "https"} or not ConnectionAuditor().is_localhost(host):
            raise ValueError("Reference validation requires a local Studio backend")
        self.base_url = base_url.rstrip("/")
        self.output_dir = output_dir.resolve()
        self.receipt_dir = receipt_dir
        receipt_dir.mkdir(parents=True, exist_ok=True)
        self.token = token
        self.timeout = timeout
        self.poll_interval = poll_interval

    def request(self, path: str, body: dict | None = None) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = "Bearer " + self.token
        request = Request(self.base_url + path,
                          data=json.dumps(body).encode() if body is not None else None,
                          headers=headers)
        with urlopen(request, timeout=30) as response:
            return json.load(response)

    def generate(self, label: str, params: dict, extensions: set[str]) -> Path:
        if not params.get("model_type") or not params.get("prompt"):
            raise ValueError("Real generation requires model_type and prompt")
        if not label or Path(label).name != label:
            raise ValueError("Receipt label must be a filename")
        receipt_path = self.receipt_dir / (label + ".json")
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            if receipt.get("request") != params:
                raise ValueError("Receipt parameters changed; use a new validation directory")
            job_id = receipt["job_id"]
            if receipt.get("status") == "completed" and receipt.get("artifact"):
                from .reference_acceptance import file_hash
                artifact = Path(receipt["artifact"]).resolve()
                if (not artifact.is_relative_to(self.output_dir)
                        or not artifact.is_file()
                        or artifact.suffix.lower() not in extensions
                        or file_hash(artifact) != receipt.get("sha256")):
                    raise ValueError("Recorded artifact is missing or changed; refusing to replace approved evidence")
                return artifact
        else:
            submission = self.request("/api/v1/generate", params)
            job_id = submission["job_id"]
            receipt = {"job_id": job_id, "request": params, "status": submission.get("status")}

        def persist():
            temporary = receipt_path.with_suffix(".tmp")
            temporary.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))
            temporary.replace(receipt_path)

        persist()
        deadline = time.monotonic() + self.timeout
        previous_status = None
        while time.monotonic() < deadline:
            try:
                status = self.request("/api/v1/status/" + quote(str(job_id), safe=""))
            except HTTPError as exc:
                if exc.code not in {502, 503, 504}:
                    raise
                logging.getLogger(__name__).warning("Job %s polling temporarily unavailable: HTTP %s", job_id, exc.code)
                time.sleep(self.poll_interval)
                continue
            except (TimeoutError, URLError, ConnectionError) as exc:
                # Loading a large model may temporarily delay status requests.
                # Keep the existing job ID; never retry its POST submission.
                logging.getLogger(__name__).warning("Job %s polling temporarily unavailable: %s", job_id, exc)
                time.sleep(self.poll_interval)
                continue
            receipt["status"] = status.get("status")
            if receipt["status"] != previous_status:
                logging.getLogger(__name__).info("Reference %s job %s: %s", label, job_id, receipt["status"])
                previous_status = receipt["status"]
            persist()
            if status["status"] in {"failed", "cancelled"}:
                raise RuntimeError(f"{label}: job {job_id} {status['status']}: {status.get('error')}")
            if status["status"] == "completed":
                matches = []
                for filename in status.get("output_files", []):
                    candidate = (self.output_dir / filename).resolve()
                    if not candidate.is_relative_to(self.output_dir):
                        raise ValueError("Job artifact escapes its output directory")
                    if candidate.suffix.lower() in extensions and candidate.is_file():
                        matches.append(candidate)
                if len(matches) != 1:
                    raise RuntimeError(f"{label}: expected one generated artifact, found {len(matches)}")
                artifact = matches[0]
                digest = hashlib.sha256()
                with artifact.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                receipt.update(artifact=str(artifact), sha256=digest.hexdigest())
                persist()
                return artifact
            time.sleep(self.poll_interval)
        raise TimeoutError(f"{label}: job {job_id} exceeded validation timeout; receipt retained")
