from http.server import BaseHTTPRequestHandler
import urllib.request
import os
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

            print(f"RAW: {repr(raw)}")

            # Extract chat_id
            chat_id_match = re.search(r'"chat_id"\s*:\s*"([^"]+)"', raw)
            # Extract text — everything between "text":" and last "}
            text_match    = re.search(r'"text"\s*:\s*"(.*?)"\s*\}', raw, re.DOTALL)

            if not chat_id_match or not text_match:
                raise ValueError("Could not parse chat_id or text")

            chat_id = chat_id_match.group(1)
            text    = text_match.group(1)

            # Fix escaped newlines
            text = text.replace('\\n', '\n')

            print(f"CHAT_ID: {chat_id}")
            print(f"TEXT: {text}")

            token   = os.environ.get("BOT_TOKEN", "")
            url     = f"https://api.telegram.org/bot{token}/sendMessage"
            payload = f'{{"chat_id":"{chat_id}","text":{__import__("json").dumps(text)}}}'

            req = urllib.request.Request(
                url,
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )

            with urllib.request.urlopen(req, timeout=10) as res:
                res.read()

            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        except Exception as e:
            print(f"ERROR: {str(e)}")
            self.send_response(500)
            self.end_headers()
            self.wfile.write(f"Error: {str(e)}".encode())

    def log_message(self, format, *args):
        pass