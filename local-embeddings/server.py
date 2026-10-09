"""DEC-0023 stdlib HTTP loopback embedding service."""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Optional

from config import ServiceConfig, configured_for_load, validate_bind_config
from http_validation import (
    bearer_authorized,
    host_rejected,
    origin_rejected,
    parse_content_length,
    parse_embed_document,
    transfer_encoding_rejected,
)
from model import (
    embed_request,
    get_failure_code,
    get_identity,
    get_load_state,
    join_background_load,
    start_background_load,
)
from model import LoadState

SMOKE_JOIN_SECONDS = 30.0
REQUEST_TIMEOUT_SECONDS = 120.0


class EmbedHTTPRequestHandler(BaseHTTPRequestHandler):
    server_version = "SanctumLocalEmbed/1"
    config: ServiceConfig
    timeout = REQUEST_TIMEOUT_SECONDS

    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("sanctum-local-embed: request handled\n")

    def _send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode(
            "utf-8"
        )
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> tuple[Optional[bytes], Optional[str]]:
        if transfer_encoding_rejected(self.headers):
            return None, "INVALID_CONTENT_LENGTH"
        length, err = parse_content_length(self.headers)
        if err:
            return None, err
        if length is None:
            return b"", None
        data = self.rfile.read(length)
        if len(data) != length:
            return None, "BODY_TOO_LARGE"
        return data, None

    def _gate_request(self) -> bool:
        if host_rejected(self.headers, self.config):
            self._send_json(403, {"version": 1, "error": {"code": "FORBIDDEN"}})
            return False
        if origin_rejected(self.headers):
            self._send_json(403, {"version": 1, "error": {"code": "FORBIDDEN"}})
            return False
        if not bearer_authorized(self.headers, self.config.token):
            self._send_json(401, {"version": 1, "error": {"code": "UNAUTHORIZED"}})
            return False
        return True

    def do_GET(self) -> None:
        if not self._gate_request():
            return
        if self.path.split("?", 1)[0] != "/health":
            self._send_json(404, {"version": 1, "error": {"code": "NOT_FOUND"}})
            return
        state = get_load_state().value
        payload: dict[str, Any] = {"version": 1, "state": state}
        code = get_failure_code()
        if code:
            payload["code"] = code
        identity = get_identity()
        if state == "ready" and identity is not None:
            payload["identity"] = identity
        self._send_json(200, payload)

    def do_POST(self) -> None:
        if not self._gate_request():
            return
        if self.path.split("?", 1)[0] != "/embed":
            self._send_json(404, {"version": 1, "error": {"code": "NOT_FOUND"}})
            return

        raw, err = self._read_body()
        if err:
            status = 413 if err == "BODY_TOO_LARGE" else 400
            self._send_json(status, {"version": 1, "error": {"code": err}})
            return

        doc, schema_err = parse_embed_document(raw or b"", self.config)
        if schema_err:
            self._send_json(400, {"version": 1, "error": {"code": schema_err}})
            return
        assert doc is not None

        try:
            embeddings = embed_request(
                self.config,
                doc["purpose"],
                doc["texts"],
                doc["identity"],
            )
        except RuntimeError as exc:
            code = str(exc)
            if code == "BUSY":
                self._send_json(503, {"version": 1, "error": {"code": "BUSY"}})
                return
            if code == "NOT_READY":
                self._send_json(503, {"version": 1, "error": {"code": "NOT_READY"}})
                return
            self._send_json(500, {"version": 1, "error": {"code": "INTERNAL"}})
            return
        except ValueError as exc:
            self._send_json(400, {"version": 1, "error": {"code": str(exc)}})
            return

        server_identity = get_identity()
        if server_identity is None:
            self._send_json(503, {"version": 1, "error": {"code": "NOT_READY"}})
            return

        self._send_json(
            200,
            {
                "version": 1,
                "identity": server_identity,
                "embeddings": embeddings,
            },
        )

    def do_OPTIONS(self) -> None:
        self._send_json(403, {"version": 1, "error": {"code": "FORBIDDEN"}})


def make_handler(config: ServiceConfig) -> type[EmbedHTTPRequestHandler]:
    class Handler(EmbedHTTPRequestHandler):
        pass

    Handler.config = config
    return Handler


def serve(config: ServiceConfig) -> None:
    validate_bind_config(config)
    if not configured_for_load(config):
        raise SystemExit("SANCTUM_LOCAL_EMBED_TOKEN is required")
    start_background_load(config)
    handler = make_handler(config)
    httpd = ThreadingHTTPServer((config.host, config.port), handler)
    httpd.serve_forever()


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Sanctum local text embedding sidecar (DEC-0023)")
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="Wait bounded for background load; print sanitized health JSON to stderr.",
    )
    args = parser.parse_args(argv)
    config = ServiceConfig.from_env()
    try:
        validate_bind_config(config)
    except ValueError:
        print(json.dumps({"version": 1, "state": "unconfigured", "code": "INVALID_BIND"}), file=sys.stderr)
        return 2

    if args.smoke or configured_for_load(config):
        start_background_load(config)

    if args.smoke:
        still_running = not join_background_load(timeout=SMOKE_JOIN_SECONDS)
        state = get_load_state().value
        code = get_failure_code()
        if still_running and state == LoadState.LOADING.value:
            print(
                json.dumps({"version": 1, "state": "loading", "code": "LOAD_TIMEOUT"}),
                file=sys.stderr,
            )
            return 1
        print(json.dumps({"version": 1, "state": state, "code": code}), file=sys.stderr)
        return 0 if state in ("ready", "failed", "unconfigured") else 1

    if not configured_for_load(config):
        print("SANCTUM_LOCAL_EMBED_TOKEN is required", file=sys.stderr)
        return 2
    serve(config)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
