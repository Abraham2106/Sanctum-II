"""Loopback HTTP contract tests (stdlib server, test-only runtime fake)."""
from __future__ import annotations

import json
import os
import socket
import threading
import time
import unittest
import unittest.mock
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from typing import Any

from config import ServiceConfig
from model import LoadState, reset_service_state_for_tests, start_background_load
from server import main, make_handler
from test_support import FakeRuntime, base_env, sample_revision


def free_port() -> int:
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class LoopbackServerTests(unittest.TestCase):
    def setUp(self) -> None:
        reset_service_state_for_tests()
        self.port = free_port()
        for key, value in base_env().items():
            os.environ[key] = value
        os.environ["SANCTUM_LOCAL_EMBED_PORT"] = str(self.port)
        self.config = ServiceConfig.from_env()
        self.config = ServiceConfig(
            host=self.config.host,
            port=self.port,
            token=self.config.token,
            revision=self.config.revision,
            dims=self.config.dims,
            device=self.config.device,
            dtype=self.config.dtype,
        )
        start_background_load(self.config, runtime_factory=FakeRuntime)
        thread = __import__("model")._load_thread
        assert thread is not None
        thread.join(timeout=3)
        self.assertEqual(__import__("model").get_load_state(), LoadState.READY)
        handler = make_handler(self.config)
        self.httpd = ThreadingHTTPServer((self.config.host, self.port), handler)
        self.server_thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.server_thread.start()
        time.sleep(0.05)

    def tearDown(self) -> None:
        self.httpd.shutdown()
        self.httpd.server_close()
        reset_service_state_for_tests()

    def _conn(self) -> HTTPConnection:
        return HTTPConnection("127.0.0.1", self.port, timeout=5)

    def _auth_headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = {
            "Authorization": "Bearer test-token-value",
            "Host": f"127.0.0.1:{self.port}",
        }
        if extra:
            headers.update(extra)
        return headers

    def test_health_ready_descriptor_shape(self) -> None:
        conn = self._conn()
        conn.request("GET", "/health", headers=self._auth_headers())
        resp = conn.getresponse()
        body = json.loads(resp.read().decode("utf-8"))
        conn.close()
        self.assertEqual(resp.status, 200)
        desc = body["identity"]["descriptor"]
        self.assertEqual(desc["preprocessing"]["units"], "utf16-code-units")

    def test_rejects_empty_origin(self) -> None:
        conn = self._conn()
        conn.request("GET", "/health", headers=self._auth_headers({"Origin": ""}))
        self.assertEqual(conn.getresponse().status, 403)
        conn.close()

    def test_rejects_host_with_userinfo(self) -> None:
        conn = self._conn()
        conn.request("GET", "/health", headers=self._auth_headers({"Host": f"user@127.0.0.1:{self.port}"}))
        self.assertEqual(conn.getresponse().status, 403)
        conn.close()

    def test_rejects_boolean_version(self) -> None:
        identity = __import__("model").get_identity()
        assert identity is not None
        payload = {
            "version": True,
            "purpose": "query",
            "texts": ["x"],
            "dims": 768,
            "identity": identity,
        }
        conn = self._conn()
        conn.request(
            "POST",
            "/embed",
            body=json.dumps(payload).encode("utf-8"),
            headers=self._auth_headers({"Content-Type": "application/json"}),
        )
        self.assertEqual(conn.getresponse().status, 400)
        conn.close()

    def test_rejects_extra_json_fields(self) -> None:
        identity = __import__("model").get_identity()
        assert identity is not None
        payload = {
            "version": 1,
            "purpose": "query",
            "texts": ["x"],
            "dims": 768,
            "identity": identity,
            "model": "evil",
        }
        conn = self._conn()
        conn.request(
            "POST",
            "/embed",
            body=json.dumps(payload).encode("utf-8"),
            headers=self._auth_headers({"Content-Type": "application/json"}),
        )
        self.assertEqual(conn.getresponse().status, 400)
        conn.close()

    def test_embed_batch_order(self) -> None:
        identity = __import__("model").get_identity()
        assert identity is not None
        payload = {
            "version": 1,
            "purpose": "document",
            "texts": ["one", "two"],
            "dims": 768,
            "identity": identity,
        }
        conn = self._conn()
        conn.request(
            "POST",
            "/embed",
            body=json.dumps(payload).encode("utf-8"),
            headers=self._auth_headers({"Content-Type": "application/json"}),
        )
        resp = conn.getresponse()
        body = json.loads(resp.read().decode("utf-8"))
        conn.close()
        self.assertEqual(resp.status, 200)
        self.assertEqual(len(body["embeddings"]), 2)
        self.assertNotEqual(body["embeddings"][0], body["embeddings"][1])

    def test_busy_when_inference_locked(self) -> None:
        identity = __import__("model").get_identity()
        assert identity is not None
        lock = __import__("model")._infer_lock
        lock.acquire()
        try:
            payload = {
                "version": 1,
                "purpose": "query",
                "texts": ["wait"],
                "dims": 768,
                "identity": identity,
            }
            conn = self._conn()
            conn.request(
                "POST",
                "/embed",
                body=json.dumps(payload).encode("utf-8"),
                headers=self._auth_headers({"Content-Type": "application/json"}),
            )
            self.assertEqual(conn.getresponse().status, 503)
            conn.close()
        finally:
            lock.release()

    def test_invalid_content_length_negative(self) -> None:
        identity = __import__("model").get_identity()
        assert identity is not None
        conn = self._conn()
        conn.request(
            "POST",
            "/embed",
            body=b"{}",
            headers=self._auth_headers(
                {
                    "Content-Type": "application/json",
                    "Content-Length": "-1",
                }
            ),
        )
        self.assertEqual(conn.getresponse().status, 400)
        conn.close()


class SmokeStartupTests(unittest.TestCase):
    def test_smoke_failed_without_model(self) -> None:
        reset_service_state_for_tests()
        os.environ["SANCTUM_LOCAL_EMBED_TOKEN"] = "tok"
        os.environ["SANCTUM_LOCAL_EMBED_REVISION"] = sample_revision()
        with unittest.mock.patch.object(
            __import__("model").ModelRuntime,
            "load",
            side_effect=RuntimeError("MODEL_NOT_INSTALLED"),
        ):
            code = main(["--smoke"])
        self.assertEqual(code, 0)
        self.assertEqual(__import__("model").get_failure_code(), "MODEL_NOT_INSTALLED")


if __name__ == "__main__":
    unittest.main()
