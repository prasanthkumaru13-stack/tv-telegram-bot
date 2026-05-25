from http.server import BaseHTTPRequestHandler
import urllib.request
import os
import json

class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Bot Running OK")
    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length).decode("utf-8")

            # Fix real newlines inside JSON string from TradingView
            raw = raw.replace('\r\n', '\\n').replace('\n', '\\n')

            body    = json.loads(raw)
            chat_id = str(body.get("chat_id", ""))
            text    = str(body.get("text", ""))

            # Restore newlines for Telegram formatting
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

            with urllib.request.urlopen(req) as res:
                res.read()

            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")

        except Exception as e:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def log_message(self, format, *args):
        pass