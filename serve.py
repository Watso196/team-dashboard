#!/usr/bin/env python3
"""
Team Pulse — Local Server Launcher
Run this script from the same folder as ado-dashboard.html

Copy .env.example to .env and fill in your values before starting.
"""
import http.server
import socketserver
import webbrowser
import os
import sys
import socket
import json

PORT = 8765
FILE = "ado-dashboard.html"  # entry point — ENV is injected into this file only

os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ── .env loader ──────────────────────────────────────────────────────────────
# Reads KEY=value lines; ignores blank lines and # comments.
# No external dependencies — works with any Python 3.x install.

def load_env(path=".env"):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            # Strip optional surrounding quotes from value
            val = val.strip().strip("'\"")
            env[key.strip()] = val
    return env

env = load_env()

# Map .env keys → the config object the dashboard expects
config = {
    "org":     env.get("ADO_ORG_URL", ""),
    "project": env.get("ADO_PROJECT", ""),
    "team":    env.get("ADO_TEAM", ""),
    "pat":     env.get("ADO_PAT", ""),

    # Sprint mode: "iterations" (default) or "dates"
    "sprintMode":      env.get("ADO_SPRINT_MODE", "iterations"),

    # Date-based mode: start date of most recent sprint (YYYY-MM-DD)
    "sprintStartDate": env.get("ADO_SPRINT_START_DATE", ""),

    # How many past iterations/sprints to load history for (default 12)
    "iterationCount":  int(env.get("ADO_ITERATION_COUNT", "12")),
    "sprintCount":     int(env.get("ADO_SPRINT_COUNT", "12")),

    # Members is a comma-separated list in .env, split into an array here
    "members": [m.strip() for m in env.get("ADO_MEMBERS", "").split(",") if m.strip()],

    # Optional features
    "designReviewEnabled": env.get("ADO_DESIGN_REVIEW", "").lower() in ("true", "1", "yes"),

    # Related projects — all projects to pull work items and PRs from
    "relatedProjects": [p.strip() for p in env.get("ADO_RELATED_PROJECTS", "").split(",") if p.strip()],
}

# Warn if .env is missing or empty so the user knows to set it up
if not any([config["org"], config["project"]]):
    print("  ℹ  No .env file found (or it's empty).")
    print("  Copy .env.example → .env and fill in your values")
    print("  to pre-fill the dashboard form.\n")


# ── Port check ────────────────────────────────────────────────────────────────

def is_port_in_use(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("localhost", port)) == 0

if is_port_in_use(PORT):
    print(f"\n  ⚠  Port {PORT} is already in use.")
    print(f"  This usually means a previous server is still running.\n")
    print(f"  To kill it, run:")
    print(f"    lsof -ti:{PORT} | xargs kill -9\n")
    print(f"  Then re-run: python serve.py\n")
    sys.exit(1)


# ── Request handler ───────────────────────────────────────────────────────────
# Intercepts requests for the dashboard HTML and injects a <script> block
# containing window.ENV so the browser-side JS can read config without
# any secrets being baked into the HTML file itself.

ENV_INJECTION = f"<script>window.ENV = {json.dumps(config)};</script>"
INJECT_BEFORE = b"</head>"

class EnvInjectingHandler(http.server.SimpleHTTPRequestHandler):

    # Explicit MIME types — prevents browser silently rejecting CSS/JS
    # if Python's mimetypes module isn't configured on this system.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".css":  "text/css; charset=utf-8",
        ".js":   "application/javascript; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".json": "application/json",
    }

    def do_GET(self):
        clean_path = self.path.split("?")[0].lstrip("/")
        if clean_path in (FILE, ""):
            self._serve_injected_html()
        else:
            super().do_GET()

    def end_headers(self):
        # Disable all caching so the browser always fetches fresh JS/CSS.
        # This prevents stale cached files from causing mysterious errors
        # after an update.
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _serve_injected_html(self):
        try:
            with open(FILE, "rb") as f:
                src = f.read()
        except FileNotFoundError:
            self.send_error(404, f"{FILE} not found")
            return

        injected = src.replace(INJECT_BEFORE, ENV_INJECTION.encode() + b"\n</head>", 1)

        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(injected)))
        self.end_headers()
        self.wfile.write(injected)

    def log_message(self, format, *args):
        # Print all requests so we can spot 404s on CSS/JS files.
        status = args[1] if len(args) > 1 else "?"
        path   = args[0].split()[0] if args else "?"
        color  = "\033[92m" if str(status).startswith("2") else "\033[91m"
        print(f"  {color}{status}\033[0m  {path}")


# ── Server ────────────────────────────────────────────────────────────────────

class ReusableTCPServer(socketserver.TCPServer):
    # SO_REUSEADDR lets the OS immediately reuse the port after exit,
    # preventing "address already in use" on quick restarts.
    allow_reuse_address = True


loaded_keys = [k for k in [
    "ADO_ORG_URL","ADO_PROJECT","ADO_TEAM","ADO_MEMBERS",
    "ADO_RELATED_PROJECTS",
    "ADO_SPRINT_MODE","ADO_SPRINT_START_DATE",
    "ADO_ITERATION_COUNT","ADO_SPRINT_COUNT",
    "ADO_DESIGN_REVIEW",
] if env.get(k)]
env_status = f"env loaded ({', '.join(loaded_keys)})" if loaded_keys else "no .env"

print(f"\n  Team Pulse Dashboard")
print(f"  ─────────────────────────────────────────")
print(f"  Serving on → http://localhost:{PORT}/{FILE}")
print(f"  Config     → {env_status}")
print(f"  Press Ctrl+C to stop.\n")

webbrowser.open(f"http://localhost:{PORT}/{FILE}")

try:
    with ReusableTCPServer(("", PORT), EnvInjectingHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\n\n  Server stopped. Goodbye!\n")
