from http.server import BaseHTTPRequestHandler
import urllib.request
import os
import json
import re

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")

def send_telegram(chat_id, text):
    url     = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": text}).encode("utf-8")
    req     = urllib.request.Request(
        url, data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.read()

def parse_raw(raw):
    # Fix real newlines inside JSON
    fixed = re.sub(r'(?<!\\)\n', '\\n', raw)
    fixed = re.sub(r'(?<!\\)\r', '', fixed)
    # Remove control characters
    fixed = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', fixed)
    return json.loads(fixed)

def format_message(data):
    t         = data.get("type", "")
    indicator = data.get("indicator", "")
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    tf        = data.get("tf", "")

    # Direction emoji
    dir_emoji = "🟢" if direction == "LONG" else "🔴"

    # ── ENTRY ──────────────────────────────────────────
    if t == "ENTRY":
        mode      = data.get("mode", "")
        quality   = data.get("quality", "")
        confidence= data.get("confidence", "")
        alignment = data.get("alignment", "")
        entry     = data.get("entry", "")
        tp1       = data.get("tp1", "")
        tp2       = data.get("tp2", "")
        tp3       = data.get("tp3", "")
        sl        = data.get("sl", "")

        entry_label = "LONG ENTRY" if direction == "LONG" else "SHORT ENTRY"
        entry_emoji = "🚀" if direction == "LONG" else "🔴"

        return (
            f"Indicator Code: {indicator}\n"
            f"🔱 Trade: #{ticker} 🔱\n\n"
            f"{entry_emoji} {entry_label}: {entry}\n\n"
            f"📊 Mode: {mode}\n"
            f"✅ Quality: {quality}\n"
            f"💯 Conf: {confidence}% | 📶 {alignment}/5\n"
            f"⏱ TF: {tf}m\n\n"
            f"🀄️ LEVERAGE: 5x\n\n"
            f"🎯 TP1: {tp1}\n"
            f"🎯 TP2: {tp2}\n"
            f"🎯 TP3: {tp3}\n\n"
            f"⛔️ SL: {sl}"
        )

    # ── TP1 ────────────────────────────────────────────
    elif t == "TP1":
        price      = data.get("price", "")
        profit_pct = data.get("profit_pct", "")
        duration   = data.get("duration", "")
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP1 HIT\n"
            f"🎯 TP1: {price}\n"
            f"📈 Profit: {profit_pct}%\n"
            f"⏳ Period: {duration}"
        )

    # ── TP2 ────────────────────────────────────────────
    elif t == "TP2":
        price      = data.get("price", "")
        profit_pct = data.get("profit_pct", "")
        duration   = data.get("duration", "")
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP2 HIT\n"
            f"🎯 TP2: {price}\n"
            f"📈 Profit: {profit_pct}%\n"
            f"🔒 Lock profits\n"
            f"⏳ Period: {duration}"
        )

    # ── TP3 ────────────────────────────────────────────
    elif t == "TP3":
        price      = data.get("price", "")
        profit_pct = data.get("profit_pct", "")
        duration   = data.get("duration", "")
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP3 HIT\n"
            f"🏁 Target Completed\n"
            f"🎯 TP3: {price}\n"
            f"📈 Profit: {profit_pct}%\n"
            f"⏳ Period: {duration}"
        )

    # ── SL ─────────────────────────────────────────────
    elif t == "SL":
        price    = data.get("price", "")
        loss_pct = data.get("loss_pct", "")
        duration = data.get("duration", "")
        tp1_hit  = data.get("tp1_hit", False)
        tp2_hit  = data.get("tp2_hit", False)

        # Context based on which TPs were hit
        if tp2_hit:
            context = "⚠️ SL hit after TP2 — still profitable"
        elif tp1_hit:
            context = "⚠️ SL hit after TP1 — breakeven zone"
        else:
            context = "📉 Clean stop loss"

        return (
            f"Indicator Code: {indicator}\n"
            f"❌ #{ticker} | SL HIT\n"
            f"🛑 SL: {price}\n"
            f"📉 Loss: {loss_pct}%\n"
            f"{context}\n"
            f"⏳ Period: {duration}"
        )

    # ── EXIT ───────────────────────────────────────────
    elif t == "EXIT":
        reason     = data.get("reason", "")
        exit_price = data.get("exit_price", "")
        duration   = data.get("duration", "")
        tp1_hit    = data.get("tp1_hit", False)
        tp2_hit    = data.get("tp2_hit", False)
        tp3_hit    = data.get("tp3_hit", False)

        direction_label = "LONG" if direction == "LONG" else "SHORT"

        # TP summary
        tp_hits = []
        if tp1_hit: tp_hits.append("TP1")
        if tp2_hit: tp_hits.append("TP2")
        if tp3_hit: tp_hits.append("TP3")
        tp_summary = " → ".join(tp_hits) if tp_hits else "No TPs hit"

        return (
            f"Indicator Code: {indicator}\n"
            f"🚪 EXIT {direction_label} | {ticker}\n"
            f"📌 Reason: {reason}\n"
            f"💰 Exit: {exit_price}\n"
            f"✅ Hits: {tp_summary}\n"
            f"⏱ TF: {tf}m\n"
            f"⏳ Duration: {duration}"
        )

    # ── UNKNOWN ────────────────────────────────────────
    else:
        return f"Unknown alert type: {t}\nRaw: {json.dumps(data)}"


class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"TrendSync Bot Running OK")

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length).decode("utf-8", errors="replace")

            print(f"RAW: {repr(raw)}")

            data    = parse_raw(raw)
            chat_id = str(data.get("chat_id", ""))

            print(f"TYPE: {data.get('type')} | TICKER: {data.get('ticker')}")

            text = format_message(data)

            print(f"TEXT:\n{text}")

            send_telegram(chat_id, text)

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