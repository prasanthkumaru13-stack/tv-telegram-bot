from http.server import BaseHTTPRequestHandler
import urllib.request
import os
import json
import re

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Bot Running OK")

    def do_POST(self):
        try:
            length  = int(self.headers.get("Content-Length", 0))
            raw     = self.rfile.read(length).decode("utf-8", errors="replace")

            # Step 1: fix real newlines inside JSON values
            # Only replace newlines that are inside quoted strings
            fixed = re.sub(r'(?<!\\)\n', '\\n', raw)
            fixed = re.sub(r'(?<!\\)\r', '', fixed)

            # Step 2: parse
            body    = json.loads(fixed)
            chat_id = str(body.get("chat_id", ""))
            text    = str(body.get("text", ""))

            # Step 3: restore newlines for Telegram
            text = text.replace('\\n', '\n')

            token   = os.environ.get("BOT_TOKEN", "")
            url     = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = json.dumps({
                "chat_id": chat_id,
                "text":    text
            }).encode("utf-8")

            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=10) as res:
                res.read()

            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        except json.JSONDecodeError as e:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(f"JSON Error: {str(e)}".encode())

        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"Error: {str(e)}".encode())

    def log_message(self, format, *args):
        pass