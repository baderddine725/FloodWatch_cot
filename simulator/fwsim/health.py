# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/health.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Contrôle de santé HTTP (bonne pratique n° 10 du cours) : ``GET /health``.

200 si toutes les stations vivantes sont connectées au broker, 503 sinon. Utilisé par le
HEALTHCHECK de l'image Docker.
"""
from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable


def start_health_server(port: int, provider: Callable[[], dict]) -> ThreadingHTTPServer:
    """Démarre le serveur dans un fil d'exécution démon. ``provider()`` renvoie l'état (clé ``status``)."""

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802 (nom imposé par http.server)
            if self.path.rstrip("/") != "/health":
                self.send_error(404)
                return
            state = provider()
            body = json.dumps(state, ensure_ascii=False).encode("utf-8")
            self.send_response(200 if state.get("status") == "UP" else 503)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):  # pas de journal par requête (sondes toutes les 10 s)
            pass

    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    threading.Thread(target=server.serve_forever, name="health", daemon=True).start()
    return server
