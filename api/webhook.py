from http.server import BaseHTTPRequestHandler
import urllib.request
import os
import json
import re
import time

BOT_TOKEN = os.environ.get("BOT_TOKEN", "")

# ─── IN-MEMORY TRADE STORE ────────────────────────────────────────────────────
# Stores active trades: key = "TICKER_DIRECTION_INDICATOR"
# Example: "BTCUSDT_SHORT_1S"
active_trades = {}

# ─── TELEGRAM ─────────────────────────────────────────────────────────────────
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

# ─── JSON PARSER ──────────────────────────────────────────────────────────────
def parse_raw(raw):
    fixed = re.sub(r'(?<!\\)\n', '\\n', raw)
    fixed = re.sub(r'(?<!\\)\r', '', fixed)
    fixed = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', fixed)
    return json.loads(fixed)

# ─── TRADE KEY ────────────────────────────────────────────────────────────────
def trade_key(data):
    # Unique key to identify an active trade in memory
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    indicator = data.get("indicator", "")
    return f"{ticker}_{direction}_{indicator}"

# ─── TRADE ID GENERATOR ───────────────────────────────────────────────────────
def generate_trade_id(data):
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    indicator = data.get("indicator", "")
    ts        = int(time.time() * 1000)
    return f"{ticker}_{direction}_{indicator}_{ts}"

# ─── TELEGRAM FORMATTER ───────────────────────────────────────────────────────
def format_message(data, trade_id=None):
    t         = data.get("type", "")
    indicator = data.get("indicator", "")
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    tf        = data.get("tf", "")

    if t == "ENTRY":
        mode       = data.get("mode", "")
        quality    = data.get("quality", "")
        confidence = data.get("confidence", "")
        alignment  = data.get("alignment", "")
        entry      = data.get("entry", "")
        tp1        = data.get("tp1", "")
        tp2        = data.get("tp2", "")
        tp3        = data.get("tp3", "")
        sl         = data.get("sl", "")
        entry_label = "LONG ENTRY 🚀" if direction == "LONG" else "SHORT ENTRY 🔴"
        return (
            f"Indicator Code: {indicator}\n"
            f"🔱 Trade: #{ticker} 🔱\n\n"
            f"{entry_label}: {entry}\n\n"
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

    elif t == "TP1":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP1 HIT\n"
            f"🎯 TP1: {data.get('price', '')}\n"
            f"📈 Profit: {data.get('profit_pct', '')}%\n"
            f"⏳ Period: {data.get('duration', '')}"
        )

    elif t == "TP2":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP2 HIT\n"
            f"🎯 TP2: {data.get('price', '')}\n"
            f"📈 Profit: {data.get('profit_pct', '')}%\n"
            f"🔒 Lock profits\n"
            f"⏳ Period: {data.get('duration', '')}"
        )

    elif t == "TP3":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP3 HIT\n"
            f"🏁 Target Completed\n"
            f"🎯 TP3: {data.get('price', '')}\n"
            f"📈 Profit: {data.get('profit_pct', '')}%\n"
            f"⏳ Period: {data.get('duration', '')}"
        )

    elif t == "SL":
        tp1_hit = data.get("tp1_hit", False)
        tp2_hit = data.get("tp2_hit", False)
        context = (
            "⚠️ SL hit after TP2 — still profitable" if tp2_hit else
            "⚠️ SL hit after TP1 — breakeven zone"   if tp1_hit else
            "📉 Clean stop loss"
        )
        return (
            f"Indicator Code: {indicator}\n"
            f"❌ #{ticker} | SL HIT\n"
            f"🛑 SL: {data.get('price', '')}\n"
            f"📉 Loss: {data.get('loss_pct', '')}%\n"
            f"{context}\n"
            f"⏳ Period: {data.get('duration', '')}"
        )

    elif t == "EXIT":
        tp1_hit = data.get("tp1_hit", False)
        tp2_hit = data.get("tp2_hit", False)
        tp3_hit = data.get("tp3_hit", False)
        tp_hits = [tp for tp, hit in [("TP1", tp1_hit), ("TP2", tp2_hit), ("TP3", tp3_hit)] if hit]
        tp_summary  = " → ".join(tp_hits) if tp_hits else "No TPs hit"
        dir_label   = "LONG" if direction == "LONG" else "SHORT"
        return (
            f"Indicator Code: {indicator}\n"
            f"🚪 EXIT {dir_label} | {ticker}\n"
            f"📌 Reason: {data.get('reason', '')}\n"
            f"💰 Exit: {data.get('exit_price', '')}\n"
            f"✅ Hits: {tp_summary}\n"
            f"⏱ TF: {tf}m\n"
            f"⏳ Duration: {data.get('duration', '')}"
        )

    return f"Unknown type: {t}"

# ─── TRADE PROCESSOR ──────────────────────────────────────────────────────────
def process_trade(data):
    t   = data.get("type", "")
    key = trade_key(data)

    if t == "ENTRY":
        # Generate trade_id and store in memory
        trade_id = generate_trade_id(data)
        active_trades[key] = {
            "trade_id":  trade_id,
            "ticker":    data.get("ticker"),
            "direction": data.get("direction"),
            "indicator": data.get("indicator"),
            "tf":        data.get("tf"),
            "mode":      data.get("mode"),
            "quality":   data.get("quality"),
            "confidence":data.get("confidence"),
            "alignment": data.get("alignment"),
            "entry":     data.get("entry"),
            "tp1":       data.get("tp1"),
            "tp2":       data.get("tp2"),
            "tp3":       data.get("tp3"),
            "sl":        data.get("sl"),
            "tp1_hit":   False,
            "tp2_hit":   False,
            "tp3_hit":   False,
        }
        print(f"TRADE OPENED: {trade_id}")
        return trade_id

    else:
        # Find existing trade from memory
        trade = active_trades.get(key)
        if not trade:
            print(f"WARNING: No active trade found for key {key}")
            return None

        trade_id = trade["trade_id"]

        if t == "TP1":
            trade["tp1_hit"] = True
            print(f"TP1 HIT: {trade_id}")

        elif t == "TP2":
            trade["tp2_hit"] = True
            print(f"TP2 HIT: {trade_id}")

        elif t == "TP3":
            trade["tp3_hit"] = True
            print(f"TP3 HIT: {trade_id}")

        elif t == "SL":
            print(f"SL HIT: {trade_id}")
            # Keep in memory until EXIT arrives

        elif t == "EXIT":
            print(f"TRADE CLOSED: {trade_id}")
            # Remove from memory
            active_trades.pop(key, None)

        return trade_id

# ─── HANDLER ──────────────────────────────────────────────────────────────────
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
            t       = data.get("type", "")

            print(f"TYPE: {t} | TICKER: {data.get('ticker')} | DIR: {data.get('direction')}")

            # Process trade — get or generate trade_id
            trade_id = process_trade(data)
            print(f"TRADE_ID: {trade_id}")

            # Format and send Telegram message
            text = format_message(data, trade_id)
            print(f"MESSAGE:\n{text}")
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