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
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length).decode("utf-8", errors="replace")

            print(f"RAW BODY: {repr(raw)}")

            # Step 1: fix real newlines
            fixed = re.sub(r'(?<!\\)\n', '\\n', raw)
            fixed = re.sub(r'(?<!\\)\r', '', fixed)

            # Step 2: remove control characters except \n \t
            fixed = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', fixed)

            print(f"FIXED BODY: {repr(fixed)}")

            body    = json.loads(fixed)
            chat_id = str(body.get("chat_id", "973902721"))
            text    = str(body.get("text", ""))

            # Restore newlines for Telegram
            text = text.replace('\\n', '\n')

            token = os.environ.get("BOT_TOKEN", "")
            url   = f"https://api.telegram.org/bot{token}/sendMessage"

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
            print(f"JSON ERROR: {str(e)}")
            print(f"RAW WAS: {repr(raw)}")
            self.send_response(400)
            self.end_headers()
            self.wfile.write(f"JSON Error: {str(e)}".encode())

        except Exception as e:
            print(f"GENERAL ERROR: {str(e)}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"Error: {str(e)}".encode())

    def log_message(self, format, *args):
        pass