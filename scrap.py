import os
import time
import logging
from datetime import datetime
from typing import List, Dict, Any

from flask import Flask, request, jsonify, render_template, send_from_directory, send_file
from flask_pymongo import PyMongo
from werkzeug.security import generate_password_hash, check_password_hash
from flask_cors import CORS
from bson import ObjectId

import google.generativeai as genai
from dotenv import load_dotenv

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from webdriver_manager.chrome import ChromeDriverManager

load_dotenv()
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logging.getLogger("webdriver_manager").setLevel(logging.WARNING)

app = Flask(__name__, template_folder="templates", static_folder="static")
CORS(app)
app.config["MONGO_URI"] = os.getenv("MONGO_URI", "mongodb://localhost:27017/smartshopper")
mongo = PyMongo(app)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    gemini_model = genai.GenerativeModel(model_name="gemini-1.5-flash")
    chat_history: Dict[str, Any] = {}
    logging.info("Configured google-generativeai for Gemini")
else:
    gemini_model = None
    chat_history = {}
    logging.warning("GEMINI_API_KEY not set; using fallback chat responses")

CACHE_DIR = os.getenv("WD_CACHE_DIR", None)
if CACHE_DIR:
    DRIVER_PATH = ChromeDriverManager(cache_dir=CACHE_DIR).install()
else:
    DRIVER_PATH = ChromeDriverManager().install()
logging.info(f"Using ChromeDriver at {DRIVER_PATH}")

def get_chrome_driver():
    opts = Options()
    opts.add_argument("--window-size=1920,1080")
    opts.add_experimental_option("prefs", {
        "profile.default_content_setting_values.geolocation": 1
    })
    service = Service(DRIVER_PATH, log_path="chromedriver.log")
    return webdriver.Chrome(service=service, options=opts)

def scrape_from_quickcompare(driver, address: str, product: str) -> List[Dict[str, Any]]:
    driver.get("https://quickcompare.in/")
    wait = WebDriverWait(driver, 20)

    if address and address != "None,None":
        try:
            wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                "button.flex.w-full.flex-col.px-4"))).click()
            time.sleep(1)
            inp = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
                "input[placeholder='Manually enter location']")))
            inp.clear()
            inp.send_keys(address)
            sugg = wait.until(EC.presence_of_element_located((By.CSS_SELECTOR,
                "div.overflow-y-auto.px-4")))
            time.sleep(1)
            sugg.find_element(By.TAG_NAME, "button").click()
            time.sleep(3)
        except Exception:
            pass

    search = wait.until(EC.element_to_be_clickable((By.CSS_SELECTOR,
        "form.relative.grow input[type=search]")))
    search.clear()
    search.send_keys(product, Keys.ENTER)
    time.sleep(5)

    cards = wait.until(EC.presence_of_all_elements_located((By.CSS_SELECTOR,
        "div.grid.grid-cols-2 > div.flex.flex-col")))
    results = []

    for card in cards:
        name = card.find_element(By.CSS_SELECTOR,
            "div.line-clamp-2.text-start.text-sm.font-bold.text-text"
        ).text.strip()
        img_url = card.find_element(By.CSS_SELECTOR, "img.h-24").get_attribute("src")

        prices = []
        tiles = card.find_elements(By.CSS_SELECTOR, "div[style*='cursor: pointer']")
        for t in tiles:
            site = os.path.splitext(
                t.find_element(By.TAG_NAME, "img")
                 .get_attribute("src")
                 .split("/")[-1]
            )[0]
            mrp   = t.find_element(By.CSS_SELECTOR, "span.line-through").text.strip() if t.find_elements(By.CSS_SELECTOR, "span.line-through") else "N/A"
            offer = t.find_element(By.CSS_SELECTOR, "span.font-bold").text.strip()   if t.find_elements(By.CSS_SELECTOR, "span.font-bold") else "N/A"
            eta   = t.find_element(By.CSS_SELECTOR, "svg + span").text.strip()      if t.find_elements(By.CSS_SELECTOR, "svg + span") else "N/A"
            prices.append({"platform": site, "mrp": mrp, "offer": offer, "eta": eta})

        results.append({"name": name, "image_url": img_url, "prices": prices})

    return results

def scrape_products(address: str, product: str) -> List[Dict[str, Any]]:
    driver = get_chrome_driver()
    try:
        return scrape_from_quickcompare(driver, address, product)
    finally:
        driver.quit()

def get_fallback_response(message: str) -> str:
    m = message.lower()
    if any(w in m for w in ["hello","hi"]): return "Hi there! How can I help you today?"
    if any(w in m for w in ["deal","offer"]): return "Check our deals in the Groceries section."
    if any(w in m for w in ["compare","price"]): return "Tell me which product you'd like to compare."
    return "I can help with price comparisons, pantry management, or grocery advice."

@app.route('/api/search', methods=['POST'])
def search_products():
    data = request.get_json(force=True)
    term = data.get('query','').strip()
    lat, lng = data.get('latitude'), data.get('longitude')
    if not term:
        return jsonify({"error":"Search query is required"}), 400
    address = f"{lat},{lng}" if lat and lng else ""
    try:
        return jsonify(scrape_products(address, term)), 200
    except Exception as e:
        logging.exception("Search failed")
        return jsonify({"error": str(e)}), 500

@app.route('/api/compare', methods=['POST'])
def compare():
    return search_products()

@app.route('/api/chat', methods=['POST'])
def chat():
    data = request.get_json(force=True)
    user_id = data.get("user_id","anon")
    msg     = data.get("message","").strip()
    if not msg:
        return jsonify({"response":"Please say something."}), 400
    try:
        if gemini_model:
            if user_id not in chat_history:
                chat_history[user_id] = gemini_model.start_chat()
                resp = chat_history[user_id].send_message(f"SYSTEM: You are a helpful shopping assistant.\n\nUSER: {msg}")
            else:
                resp = chat_history[user_id].send_message(msg)
            return jsonify({"response": resp.text}), 200
        else:
            return jsonify({"response": get_fallback_response(msg)}), 200
    except Exception as e:
        return jsonify({"response": f"Error: {e}"}), 500

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/static/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/api/placeholder/<int:w>/<int:h>')
def placeholder(w, h):
    from PIL import Image, ImageDraw, ImageFont
    buf = __import__('io').BytesIO()
    img = Image.new('RGB', (w, h), (240,240,240))
    d = ImageDraw.Draw(img)
    d.rectangle([(0,0),(w-1,h-1)], outline=(200,200,200))
    try:
        font = ImageFont.truetype("arial.ttf", 20)
    except:
        font = ImageFont.load_default()
    text = request.args.get('text','Product')
    tw, th = d.textsize(text, font=font)
    d.text(((w-tw)//2,(h-th)//2), text, fill=(80,80,80), font=font)
    img.save(buf, 'JPEG')
    buf.seek(0)
    return send_file(buf, mimetype='image/jpeg')

@app.route('/api/register', methods=['POST'])
def register():
    data = request.get_json(force=True)
    for f in ("name","email","password"):
        if not data.get(f):
            return jsonify({"error":f"'{f}' is required"}), 400
    if mongo.db.users.find_one({"email":data["email"]}):
        return jsonify({"error":"Email already in use"}), 409
    user = {
        "name": data["name"],
        "email": data["email"],
        "phone": data.get("phone",""),
        "password": generate_password_hash(data["password"]),
        "created_at": datetime.utcnow()
    }
    res = mongo.db.users.insert_one(user)
    for idx in [("location","2dsphere"), ("term",1), ("timestamp",1)]:
        mongo.db.searches.create_index([idx])
    return jsonify({"id": str(res.inserted_id)}), 201

@app.route('/api/login', methods=['POST'])
def login():
    data = request.get_json(force=True)
    user = mongo.db.users.find_one({"email":data.get("email")})
    if not user or not check_password_hash(user["password"], data.get("password","")):
        return jsonify({"error":"Invalid credentials"}), 401
    return jsonify({
        "id": str(user["_id"]),
        "name": user["name"],
        "email": user["email"],
        "phone": user.get("phone","")
    }), 200

@app.route('/api/pantry', methods=['GET','POST'])
def pantry():
    if request.method == 'GET':
        uid = request.args.get('user_id')
        if not uid:
            return jsonify({"error":"User ID is required"}), 400
        return jsonify(list(mongo.db.pantry.find({"user_id": uid}))), 200

    data = request.get_json(force=True)
    if not data.get('user_id') or not data.get('name'):
        return jsonify({"error":"User ID and item name are required"}), 400
    item = {
        "user_id": data["user_id"],
        "name": data["name"],
        "expiry": data.get("expiry"),
        "quantity": data.get("quantity",1),
        "added_at": datetime.utcnow()
    }
    res = mongo.db.pantry.insert_one(item)
    return jsonify({"id": str(res.inserted_id)}), 201

@app.route('/api/pantry/<item_id>', methods=['DELETE'])
def delete_pantry_item(item_id):
    try:
        res = mongo.db.pantry.delete_one({"_id": ObjectId(item_id)})
        if res.deleted_count:
            return jsonify({"success": True}), 200
        return jsonify({"error":"Item not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port, debug=True, use_reloader=False)
