from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.parse
import os
import json
import re
import time

BOT_TOKEN    = os.environ.get("BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

# ─── IN-MEMORY ACTIVE TRADES ──────────────────────────────────────────────────
active_trades = {}

# ─── SUPABASE ─────────────────────────────────────────────────────────────────
def supabase(method, table, data=None, params=None):
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    if params:
        url += "?" + urllib.parse.urlencode(params)

    body = json.dumps(data).encode("utf-8") if data else None

    req = urllib.request.Request(
        url, data=body, method=method,
        headers={
            "Content-Type":  "application/json",
            "apikey":        SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Prefer":        "return=representation"
        }
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())

def db_insert(data):
    return supabase("POST", "trades", data)

def db_update(trade_id, data):
    return supabase("PATCH", "trades", data, {"trade_id": f"eq.{trade_id}"})

def db_find(trade_id):
    result = supabase("GET", "trades", params={
        "trade_id": f"eq.{trade_id}",
        "limit": "1"
    })
    return result[0] if result else None

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

# ─── TRADE KEY (for memory lookup) ────────────────────────────────────────────
def trade_key(data):
    return f"{data.get('ticker')}_{data.get('direction')}_{data.get('indicator')}"

# ─── TRADE ID GENERATOR ───────────────────────────────────────────────────────
def generate_trade_id(data):
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    indicator = data.get("indicator", "")
    ts        = int(time.time() * 1000)
    return f"{ticker}_{direction}_{indicator}_{ts}"

# ─── TELEGRAM FORMATTER ───────────────────────────────────────────────────────
def format_message(data):
    t         = data.get("type", "")
    indicator = data.get("indicator", "")
    ticker    = data.get("ticker", "")
    direction = data.get("direction", "")
    tf        = data.get("tf", "")

    if t == "ENTRY":
        entry_label = "LONG ENTRY 🚀" if direction == "LONG" else "SHORT ENTRY 🔴"
        return (
            f"Indicator Code: {indicator}\n"
            f"🔱 Trade: #{ticker} 🔱\n\n"
            f"{entry_label}: {data.get('entry')}\n\n"
            f"📊 Mode: {data.get('mode')}\n"
            f"✅ Quality: {data.get('quality')}\n"
            f"💯 Conf: {data.get('confidence')}% | 📶 {data.get('alignment')}/5\n"
            f"⏱ TF: {tf}m\n\n"
            f"🀄️ LEVERAGE: 5x\n\n"
            f"🎯 TP1: {data.get('tp1')}\n"
            f"🎯 TP2: {data.get('tp2')}\n"
            f"🎯 TP3: {data.get('tp3')}\n\n"
            f"⛔️ SL: {data.get('sl')}"
        )

    elif t == "TP1":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP1 HIT\n"
            f"🎯 TP1: {data.get('price')}\n"
            f"📈 Profit: {data.get('profit_pct')}%\n"
            f"⏳ Period: {data.get('duration')}"
        )

    elif t == "TP2":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP2 HIT\n"
            f"🎯 TP2: {data.get('price')}\n"
            f"📈 Profit: {data.get('profit_pct')}%\n"
            f"🔒 Lock profits\n"
            f"⏳ Period: {data.get('duration')}"
        )

    elif t == "TP3":
        return (
            f"Indicator Code: {indicator}\n"
            f"✅ #{ticker} | TP3 HIT\n"
            f"🏁 Target Completed\n"
            f"🎯 TP3: {data.get('price')}\n"
            f"📈 Profit: {data.get('profit_pct')}%\n"
            f"⏳ Period: {data.get('duration')}"
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
            f"🛑 SL: {data.get('price')}\n"
            f"📉 Loss: {data.get('loss_pct')}%\n"
            f"{context}\n"
            f"⏳ Period: {data.get('duration')}"
        )

    elif t == "EXIT":
        tp1_hit = data.get("tp1_hit", False)
        tp2_hit = data.get("tp2_hit", False)
        tp3_hit = data.get("tp3_hit", False)
        tp_hits    = [tp for tp, hit in [("TP1", tp1_hit), ("TP2", tp2_hit), ("TP3", tp3_hit)] if hit]
        tp_summary = " → ".join(tp_hits) if tp_hits else "No TPs hit"
        dir_label  = "LONG" if direction == "LONG" else "SHORT"
        return (
            f"Indicator Code: {indicator}\n"
            f"🚪 EXIT {dir_label} | {ticker}\n"
            f"📌 Reason: {data.get('reason')}\n"
            f"💰 Exit: {data.get('exit_price')}\n"
            f"✅ Hits: {tp_summary}\n"
            f"⏱ TF: {tf}m\n"
            f"⏳ Duration: {data.get('duration')}"
        )

    return f"Unknown type: {t}"

# ─── TRADE PROCESSOR ──────────────────────────────────────────────────────────
def process_trade(data):
    t   = data.get("type", "")
    key = trade_key(data)

    # ── ENTRY ──────────────────────────────────────────────────────────────
    if t == "ENTRY":
        trade_id = generate_trade_id(data)

        # Store in memory
        active_trades[key] = trade_id

        # Insert into Supabase
        db_insert({
            "trade_id":   trade_id,
            "indicator":  data.get("indicator"),
            "ticker":     data.get("ticker"),
            "direction":  data.get("direction"),
            "timeframe":  data.get("tf"),
            "mode":       data.get("mode"),
            "quality":    data.get("quality"),
            "confidence": data.get("confidence"),
            "alignment":  data.get("alignment"),
            "entry_price":data.get("entry"),
            "tp1_price":  data.get("tp1"),
            "tp2_price":  data.get("tp2"),
            "tp3_price":  data.get("tp3"),
            "sl_price":   data.get("sl"),
            "status":     "OPEN"
        })

        print(f"DB INSERT: {trade_id}")
        return trade_id

    # ── TP1 ────────────────────────────────────────────────────────────────
    elif t == "TP1":
        trade_id = active_trades.get(key)
        if not trade_id:
            print(f"WARNING: No active trade for {key}")
            return None

        db_update(trade_id, {"tp1_hit": True})
        print(f"DB UPDATE TP1: {trade_id}")
        return trade_id

    # ── TP2 ────────────────────────────────────────────────────────────────
    elif t == "TP2":
        trade_id = active_trades.get(key)
        if not trade_id:
            print(f"WARNING: No active trade for {key}")
            return None

        db_update(trade_id, {"tp2_hit": True})
        print(f"DB UPDATE TP2: {trade_id}")
        return trade_id

    # ── TP3 ────────────────────────────────────────────────────────────────
    elif t == "TP3":
        trade_id = active_trades.get(key)
        if not trade_id:
            print(f"WARNING: No active trade for {key}")
            return None

        db_update(trade_id, {"tp3_hit": True})
        print(f"DB UPDATE TP3: {trade_id}")
        return trade_id

    # ── SL ─────────────────────────────────────────────────────────────────
    elif t == "SL":
        trade_id = active_trades.get(key)
        if not trade_id:
            print(f"WARNING: No active trade for {key}")
            return None

        db_update(trade_id, {
            "sl_hit":     True,
            "sl_price":   data.get("price"),
            "status":     "CLOSED",
            "exit_price": data.get("price"),
            "exit_reason":"SL HIT",
            "duration":   data.get("duration"),
            "tp1_hit":    data.get("tp1_hit", False),
            "tp2_hit":    data.get("tp2_hit", False),
        })

        # Remove from memory
        active_trades.pop(key, None)
        print(f"DB UPDATE SL CLOSED: {trade_id}")
        return trade_id

    # ── EXIT ───────────────────────────────────────────────────────────────
    elif t == "EXIT":
        trade_id = active_trades.get(key)
        if not trade_id:
            print(f"WARNING: No active trade for {key}")
            return None

        db_update(trade_id, {
            "status":     "CLOSED",
            "exit_reason":data.get("reason"),
            "exit_price": data.get("exit_price"),
            "duration":   data.get("duration"),
            "tp1_hit":    data.get("tp1_hit", False),
            "tp2_hit":    data.get("tp2_hit", False),
            "tp3_hit":    data.get("tp3_hit", False),
        })

        # Remove from memory
        active_trades.pop(key, None)
        print(f"DB UPDATE EXIT CLOSED: {trade_id}")
        return trade_id

    return None

# ─── HANDLER ──────────────────────────────────────────────────────────────────
class handler(BaseHTTPRequestHandler):

    def do_GET(self):
        supabase_url = os.environ.get("SUPABASE_URL", "NOT SET")
        supabase_key = os.environ.get("SUPABASE_KEY", "NOT SET")
        debug = {
            "status":      "running",
            "supabase_url": supabase_url[:30] + "..." if len(supabase_url) > 10 else supabase_url,
            "supabase_key": supabase_key[:15] + "..." if len(supabase_key) > 10 else supabase_key,
            "bot_token":   "SET" if os.environ.get("BOT_TOKEN") else "NOT SET"
        }
        self.send_response(200)
        self.end_headers()
        self.wfile.write(json.dumps(debug).encode())

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw    = self.rfile.read(length).decode("utf-8", errors="replace")

            print(f"RAW: {repr(raw)}")

            data    = parse_raw(raw)
            chat_id = str(data.get("chat_id", ""))
            t       = data.get("type", "")

            print(f"TYPE: {t} | TICKER: {data.get('ticker')} | DIR: {data.get('direction')}")

            # 1. Process trade — DB operations
            trade_id = process_trade(data)
            print(f"TRADE_ID: {trade_id}")

            # 2. Format and send Telegram
            text = format_message(data)
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