from flask import Flask, request, jsonify
import requests
import os

app = Flask(__name__)

BOT_TOKEN = os.environ.get("BOT_TOKEN")
TELEGRAM_URL = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"

@app.route("/", methods=["GET"])
def health():
    return "Bot Running ✅", 200

@app.route("/webhook", methods=["POST"])
def webhook():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No JSON"}), 400
        
        chat_id = data.get("chat_id")
        text    = data.get("text")
        
        if not chat_id or not text:
            return jsonify({"error": "Missing fields"}), 400
        
        res = requests.post(TELEGRAM_URL, json={
            "chat_id": chat_id,
            "text":    text
        })
        
        return jsonify({"status": "sent"}), 200
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    app.run(host="0.0.0.0", port=port)