import os
import uuid
import shutil
from flask import Flask, render_template, request, redirect, url_for, abort, session, send_file
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import sqlite3
import json
import subprocess
from datetime import datetime, timedelta


# AI - bit - downloads shit loads of models
# from io import BytesIO
# from PIL import Image
# import base64
# import torch
# print(torch.cuda.is_available())  # Will return False on macOS
# print(torch.__version__)
# print(torch.backends.mps.is_available())  # For Apple Silicon acceleration
# print(torch.backends.mkldnn.is_available())  # For CPU optimization
# from diffusers import StableDiffusionImg2ImgPipeline


app = Flask(__name__)

# --- DB paths (absolute, under the app folder) ---
APP_ROOT = os.path.dirname(os.path.abspath(__file__))

def rel_path(*parts: str) -> str:
    return os.path.join(APP_ROOT, *parts)

HISTORY_DB = rel_path("History")     # or rel_path("history.db") if you prefer an extension
USERS_DB   = rel_path("users.db")
GAMES_DB   = rel_path("games.db")


from datetime import datetime
app.jinja_env.globals['cache_bust'] = lambda: int(datetime.utcnow().timestamp())

UPLOAD_FOLDER = os.path.join('static', 'images', 'gallery1')
TRASH_FOLDER = os.path.join('private_trash')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}


from dotenv import load_dotenv
load_dotenv()


app.secret_key = os.environ.get("FLASK_SECRET_KEY") or os.urandom(32)

# Read PIN from environment variable and hash it
SECRET_PIN_HASH = generate_password_hash(os.environ.get("APP_PIN", "default"))

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(TRASH_FOLDER, exist_ok=True)

limiter = Limiter(key_func=get_remote_address)
limiter.init_app(app)


from functools import wraps

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not session.get('logged_in'):
            return redirect(url_for('index'))  # or redirect to a login page
        return f(*args, **kwargs)
    return decorated_function



def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    images = sorted(os.listdir(app.config['UPLOAD_FOLDER']))
    logged_in = session.get('logged_in', False)
    return render_template('index.html', images=images, logged_in=logged_in)

@app.route('/login', methods=['POST'])
@limiter.limit("5 per minute")  # rate limit to prevent brute-force
def login():
    pin = request.form.get('pin', '')
    if check_password_hash(SECRET_PIN_HASH, pin):
        session['logged_in'] = True
    else:
        session['logged_in'] = False
    return redirect(url_for('index'))

@app.route('/logout', methods=['POST'])
def logout():
    session.clear()
    return redirect(url_for('index'))

@app.route('/upload', methods=['POST'])
def upload():
    if not session.get('logged_in'):
        return 'Unauthorized', 403
    if 'image' not in request.files:
        return 'No image part', 400
    file = request.files['image']
    if file.filename == '':
        return 'No selected file', 400
    if file and allowed_file(file.filename):
        original_filename = secure_filename(file.filename)
        extension = os.path.splitext(original_filename)[1]
        unique_name = f"{uuid.uuid4().hex}{extension}"
        file.save(os.path.join(app.config['UPLOAD_FOLDER'], unique_name))
        return redirect(url_for('index'))
    return 'Invalid file type', 400

@app.route('/delete', methods=['POST'])
def delete():
    if not session.get('logged_in'):
        return 'Unauthorized', 403
    filename = request.form.get('filename')
    safe_filename = secure_filename(filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], safe_filename)
    trash_path = os.path.join(TRASH_FOLDER, safe_filename)
    if os.path.exists(file_path):
        shutil.move(file_path, trash_path)
        return redirect(url_for('index'))
    return 'File not found', 404

@app.errorhandler(429)
def ratelimit_handler(e):
    if request.path.startswith('/api/'):
        return jsonify({'status': 'error', 'message': 'rate limit exceeded'}), 429
    return redirect(url_for('winner'))


@app.route('/winner')
def winner():
    return "<h1>You won! Now what? 😈</h1>", 200


@app.route('/draw')
def draw():
    return render_template('draw.html')





def webkit_to_datetime(webkit_timestamp):
    if not webkit_timestamp:
        return None
    return datetime(1601, 1, 1) + timedelta(microseconds=webkit_timestamp)

def datetime_to_webkit(dt_str):
    try:
        dt = datetime.strptime(dt_str, "%Y-%m-%d")
        delta = dt - datetime(1601, 1, 1)
        return int(delta.total_seconds() * 1_000_000)
    except Exception:
        return None


@app.route('/history')
def history():
    query = request.args.get('query', '').strip()
    domain = request.args.get('domain', '').strip()
    date_from = request.args.get('date_from', '')
    date_to = request.args.get('date_to', '')
    visit_type = request.args.get('visit_type', '')
    sort = request.args.get('sort', 'date')
    page = request.args.get('page', 1, type=int)
    per_page = 50
    offset = (page - 1) * per_page
    results, total, total_pages, status = [], 0, 1, ''

    sort_column = {
        'date': 'v.visit_time',
        'title': 'u.title',
        'url': 'u.url'
    }.get(sort, 'v.visit_time')

    filters = []
    values = []

    if query:
        filters.append("(u.title LIKE ? OR u.url LIKE ? OR k.term LIKE ?)")
        values += ['%' + query + '%'] * 3

    if domain:
        filters.append("u.url LIKE ?")
        values.append(f"%{domain}%")

    if date_from:
        try:
            ts = datetime_to_webkit(date_from)
            filters.append("v.visit_time >= ?")
            values.append(ts)
        except:
            pass

    if date_to:
        try:
            ts = datetime_to_webkit(date_to)
            filters.append("v.visit_time <= ?")
            values.append(ts)
        except:
            pass

    if visit_type == 'typed':
        filters.append("(v.transition & 0xff) = 1")
    elif visit_type == 'link':
        filters.append("(v.transition & 0xff) = 2")

    where_clause = "WHERE " + " AND ".join(filters) if filters else ""

    try:
        conn = conn = sqlite3.connect(HISTORY_DB)
        cursor = conn.cursor()

        count_query = f"""
            SELECT COUNT(*) FROM urls u
            JOIN visits v ON u.id = v.url
            LEFT JOIN keyword_search_terms k ON k.url_id = u.id
            {where_clause}
        """
        cursor.execute(count_query, values)
        total = cursor.fetchone()[0]

        query_stmt = f"""
            SELECT u.id, u.title, u.url, v.visit_time, v.transition, k.term
            FROM urls u
            JOIN visits v ON u.id = v.url
            LEFT JOIN keyword_search_terms k ON k.url_id = u.id
            {where_clause}
            ORDER BY {sort_column} DESC
            LIMIT ? OFFSET ?
        """
        cursor.execute(query_stmt, values + [per_page, offset])
        rows = cursor.fetchall()
        conn.close()

        results = [
            {
                'id': row[0],
                'title': row[1],
                'url': row[2],
                'date': webkit_to_datetime(row[3]).strftime('%Y-%m-%d %H:%M:%S') if row[3] else "Unknown",
                'transition': row[4],
                'term': row[5]
            }
            for row in rows
        ]

        total_pages = (total + per_page - 1) // per_page
        status = f"Showing page {page} of {total_pages}, {total} total record(s)."

    except Exception as e:
        status = f"Error reading history: {str(e)}"

    return render_template(
        'history.html',
        results=results,
        query=query,
        domain=domain,
        date_from=date_from,
        date_to=date_to,
        visit_type=visit_type,
        sort=sort,
        page=page,
        total_pages=total_pages,
        status=status
    )





@app.route('/export_history')
def export_history():
    query = request.args.get('query', '')
    sort = request.args.get('sort', 'date')

    sort_column = {
        'date': 'last_visit_time',
        'title': 'title',
        'url': 'url'
    }.get(sort, 'last_visit_time')

    try:
        conn = conn = sqlite3.connect(HISTORY_DB)
        cursor = conn.cursor()

        if query:
            cursor.execute(f"""
                SELECT id, title, url, last_visit_time FROM urls
                WHERE title LIKE ? OR url LIKE ?
                ORDER BY {sort_column} DESC
            """, ('%' + query + '%', '%' + query + '%'))
        else:
            cursor.execute(f"""
                SELECT id, title, url, last_visit_time FROM urls
                ORDER BY {sort_column} DESC
            """)

        rows = cursor.fetchall()
        conn.close()

        data = [
            {
                'id': row[0],
                'title': row[1],
                'url': row[2],
                'date': webkit_to_datetime(row[3]).isoformat() if row[3] else None
            }
            for row in rows
        ]
        return jsonify(data)

    except Exception as e:
        return jsonify({"error": str(e)}), 500









# from datetime import datetime, timedelta


# def webkit_to_datetime(webkit_timestamp):
#     if not webkit_timestamp:
#         return None
#     return datetime(1601, 1, 1) + timedelta(microseconds=webkit_timestamp)

# @app.route('/history')
# def history():
#     query = request.args.get('query', '')
#     sort = request.args.get('sort', 'date')
#     page = request.args.get('page', 1, type=int)
#     per_page = 50
#     offset = (page - 1) * per_page
#     results = []
#     total = 0
#     total_pages = 1
#     status = ''

#     sort_column = {
#         'date': 'last_visit_time',
#         'title': 'title',
#         'url': 'url'
#     }.get(sort, 'last_visit_time')

#     try:
#         conn = conn = sqlite3.connect(HISTORY_DB)
#         cursor = conn.cursor()

#         if query:
#             cursor.execute(f"SELECT COUNT(*) FROM urls WHERE title LIKE ? OR url LIKE ?", 
#                            ('%' + query + '%', '%' + query + '%'))
#             total = cursor.fetchone()[0]

#             cursor.execute(f"""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 WHERE title LIKE ? OR url LIKE ?
#                 ORDER BY {sort_column} DESC
#                 LIMIT ? OFFSET ?
#             """, ('%' + query + '%', '%' + query + '%', per_page, offset))
#         else:
#             cursor.execute("SELECT COUNT(*) FROM urls")
#             total = cursor.fetchone()[0]

#             cursor.execute(f"""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 ORDER BY {sort_column} DESC
#                 LIMIT ? OFFSET ?
#             """, (per_page, offset))

#         rows = cursor.fetchall()
#         conn.close()

#         results = [
#             {
#                 'id': row[0],
#                 'title': row[1],
#                 'url': row[2],
#                 'date': webkit_to_datetime(row[3]).strftime('%Y-%m-%d %H:%M:%S') if row[3] else "Unknown"
#             }
#             for row in rows
#         ]

#         total_pages = (total + per_page - 1) // per_page
#         status = f"Showing page {page} of {total_pages}, {total} total record(s)."

#     except Exception as e:
#         status = f"Error reading history: {str(e)}"

#     return render_template(
#         'history.html',
#         results=results,
#         query=query,
#         sort=sort,
#         page=page,
#         total_pages=total_pages,
#         status=status
#     )

# @app.route('/export_history')
# def export_history():
#     query = request.args.get('query', '')
#     sort = request.args.get('sort', 'date')

#     sort_column = {
#         'date': 'last_visit_time',
#         'title': 'title',
#         'url': 'url'
#     }.get(sort, 'last_visit_time')

#     try:
#         conn = conn = sqlite3.connect(HISTORY_DB)
#         cursor = conn.cursor()

#         if query:
#             cursor.execute(f"""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 WHERE title LIKE ? OR url LIKE ?
#                 ORDER BY {sort_column} DESC
#             """, ('%' + query + '%', '%' + query + '%'))
#         else:
#             cursor.execute(f"""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 ORDER BY {sort_column} DESC
#             """)

#         rows = cursor.fetchall()
#         conn.close()

#         data = [
#             {
#                 'id': row[0],
#                 'title': row[1],
#                 'url': row[2],
#                 'date': webkit_to_datetime(row[3]).isoformat() if row[3] else None
#             }
#             for row in rows
#         ]
#         return jsonify(data)

#     except Exception as e:
#         return jsonify({"error": str(e)}), 500


# def webkit_to_datetime(webkit_timestamp):
#     if not webkit_timestamp:
#         return None
#     return datetime(1601, 1, 1) + timedelta(microseconds=webkit_timestamp)

# @app.route('/history')
# @login_required
# def history():
#     results = []
#     query = request.args.get('query', '')
#     status = ''
#     per_page = 50
#     page = request.args.get('page', 1, type=int)
#     offset = (page - 1) * per_page
#     total = 0

#     try:
#         conn = conn = sqlite3.connect(HISTORY_DB)
#         cursor = conn.cursor()

#         if query:
#             cursor.execute("SELECT COUNT(*) FROM urls WHERE title LIKE ? OR url LIKE ?", 
#                            ('%' + query + '%', '%' + query + '%'))
#             total = cursor.fetchone()[0]

#             cursor.execute("""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 WHERE title LIKE ? OR url LIKE ?
#                 ORDER BY last_visit_time DESC
#                 LIMIT ? OFFSET ?
#             """, ('%' + query + '%', '%' + query + '%', per_page, offset))
#         else:
#             cursor.execute("SELECT COUNT(*) FROM urls")
#             total = cursor.fetchone()[0]

#             cursor.execute("""
#                 SELECT id, title, url, last_visit_time FROM urls
#                 ORDER BY last_visit_time DESC
#                 LIMIT ? OFFSET ?
#             """, (per_page, offset))

#         rows = cursor.fetchall()
#         conn.close()

#         results = [
#             {
#                 'id': row[0],
#                 'title': row[1],
#                 'url': row[2],
#                 'date': webkit_to_datetime(row[3]).strftime('%Y-%m-%d %H:%M:%S') if row[3] else "Unknown"
#             }
#             for row in rows
#         ]

#         total_pages = (total + per_page - 1) // per_page
#         status = f"Showing page {page} of {total_pages}, {total} total record(s)."

#     except Exception as e:
#         status = f"Error reading database: {str(e)}"
#         total_pages = 1

#     return render_template(
#         'history.html',
#         results=results,
#         query=query,
#         status=status,
#         page=page,
#         total_pages=total_pages
#     )







@app.route('/users')
@login_required
def users():
    query = request.args.get('query', '').lower()
    filter_type = request.args.get('filter_type', 'name')
    selected = query  # for use in client/company selection display
    results = []
    companies, names = [], []
    
    try:
        with open('all-users-cleaned.json', 'r') as f:
            all_users = json.load(f)

        # Deduplicate
        seen = set()
        unique_users = []
        for user in all_users:
            key = (user.get('name'), user.get('email'), user.get('company'))
            if key not in seen:
                seen.add(key)
                unique_users.append(user)

        # Collect for display
        companies = sorted(set(user['company'] for user in unique_users if user.get('company')))
        names = sorted(set(user['name'] for user in unique_users if user.get('name')))

        if filter_type == 'company' and query:
            results = [u for u in unique_users if u.get('company', '').lower() == query]
        elif filter_type == 'name' and query:
            results = [u for u in unique_users if u.get('name', '').lower() == query]
        elif filter_type == 'name':
            results = unique_users  # fallback: show all

    except Exception as e:
        results = []
        companies = []
        names = []
        selected = ''
    
    return render_template(
        'users.html',
        results=results,
        filter_type=filter_type,
        query=query,
        selected=selected,
        companies=companies,
        names=names
    )


# # ------------------
# # AI - image2image (Stable Diffusion img2img)
# # ------------------



# # Load the Stable Diffusion pipeline
# # For CPU: .to("cpu") — for CUDA/GPU: .to("cuda")
# pipe = StableDiffusionImg2ImgPipeline.from_pretrained(
#     "runwayml/stable-diffusion-v1-5",
#     torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32
# )

# #pipe = pipe.to("cuda" if torch.cuda.is_available() else "cpu")
# pipe = pipe.to("cpu")

# pipe.safety_checker = lambda images, **kwargs: (images, [False] * len(images))  # Disable NSFW filter (optional)

# @app.route('/run_ai_inference', methods=['POST'])
# def run_ai_inference():
#     try:
#         data = request.get_json()
#         image_data = data.get('image_data', '')

#         if not image_data:
#             return {'error': 'No image_data received'}, 400

#         # Decode base64 from data URL
#         header, encoded = image_data.split(',', 1)
#         binary_data = base64.b64decode(encoded)

#         # Convert to PIL image (RGB mode, resized to model's input)
#         init_image = Image.open(BytesIO(binary_data)).convert("RGB")
#         init_image = init_image.resize((512, 512))

#         # Generate image using prompt + initial image
#         result_image = pipe(
#             prompt="a fantasy castle at sunset, digital painting",  # You can make this dynamic
#             image=init_image,
#             strength=0.75,            # how much to transform vs preserve
#             guidance_scale=7.5        # how strongly to follow prompt
#         ).images[0]

#         # Convert result to binary stream
#         output_io = BytesIO()
#         result_image.save(output_io, format='PNG')
#         output_io.seek(0)

#         return send_file(output_io, mimetype='image/png')

#     except Exception as e:
#         return {'error': f'{type(e).__name__}: {str(e)}'}, 500






# ====== GLOBAL LEADERBOARD (secure submit + public read) ======================

import os, time, json, hmac, hashlib, base64, sqlite3, uuid, traceback, logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from flask import jsonify, request, g
from flask_limiter.util import get_remote_address

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Config:
    token_ttl_seconds: int = 2 * 60 * 60  # 2h
    bind_to_ua: bool = True
    bind_to_ip: bool = False  # Only True if you pass real client IP (X-Forwarded-For)
    games_db_path: str = ""   # set below

def _abs_path(rel: str) -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, rel)

SUBMIT_HMAC_SECRET = os.environ.get("SUBMIT_HMAC_SECRET", "")
if not SUBMIT_HMAC_SECRET:
    raise RuntimeError("SUBMIT_HMAC_SECRET is not set. Put it in .env (SUBMIT_HMAC_SECRET=...)")

CFG = Config(games_db_path=GAMES_DB)


# ---------------------------------------------------------------------------
# Logging (structured JSON)
# ---------------------------------------------------------------------------

logger = logging.getLogger("leaderboard")
if not logger.handlers:
    handler = logging.StreamHandler()
    formatter = logging.Formatter('%(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
logger.setLevel(logging.INFO)

def log_json(event: str, **fields: Any) -> None:
    payload = {"event": event, **fields}
    try:
        logger.info(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    except Exception:
        logger.info(f"{event} | {fields}")

# ---------------------------------------------------------------------------
# Small utils
# ---------------------------------------------------------------------------

def _b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")

def _b64u_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def now_ms() -> int:
    return int(time.time() * 1000)

def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def safe_int(value: Any, default=0):
    try:
        return int(value)
    except Exception:
        return default

def client_ip() -> str:
    xff = (request.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
    return xff or (request.remote_addr or "")

def stable_key(email: Optional[str], client_id: Optional[str]) -> Optional[str]:
    if email:
        return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    if client_id:
        return "cid:" + hashlib.sha256(client_id.encode("utf-8")).hexdigest()
    return None

# ---------------------------------------------------------------------------
# Token sign/verify
# ---------------------------------------------------------------------------

def sign_token(payload: Dict[str, Any]) -> str:
    msg = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    sig = hmac.new(SUBMIT_HMAC_SECRET.encode("utf-8"), msg, hashlib.sha256).digest()
    return _b64u(msg) + "." + _b64u(sig)

def verify_token(tok: str) -> Optional[Dict[str, Any]]:
    try:
        msg_b64, sig_b64 = tok.split(".", 1)
        msg = _b64u_decode(msg_b64)
        sig = _b64u_decode(sig_b64)
        calc = hmac.new(SUBMIT_HMAC_SECRET.encode("utf-8"), msg, hashlib.sha256).digest()
        if not hmac.compare_digest(sig, calc):
            return None
        payload = json.loads(msg.decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()) - 30:  # 30s skew
            return None
        return payload
    except Exception:
        return None

# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(CFG.games_db_path, detect_types=sqlite3.PARSE_DECLTYPES)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=5000;")
    return conn

# Make sure files exist; avoids surprises on first boot
for _p in (USERS_DB, GAMES_DB, HISTORY_DB):
    try:
        os.makedirs(os.path.dirname(_p), exist_ok=True)
        if not os.path.exists(_p):
            open(_p, "a").close()
    except Exception as e:
        # log but don't crash
        print(f"[DB PREP] Could not prepare {_p}: {type(e).__name__}: {e}")    

def init_games_db() -> None:
    conn = sqlite3.connect(CFG.games_db_path)
    c = conn.cursor()

    # Games (unchanged)
    c.execute("""
        CREATE TABLE IF NOT EXISTS games (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_key TEXT,
            nickname TEXT,
            email TEXT,
            hits_made INTEGER NOT NULL,
            target INTEGER NOT NULL,
            avg_precision INTEGER NOT NULL,
            outcome TEXT NOT NULL,
            duration_ms INTEGER,
            created_at INTEGER NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_games_score ON games (hits_made DESC, avg_precision DESC, created_at DESC)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_games_user  ON games (user_key, created_at DESC)")

    # Nonce table (unchanged)
    c.execute("""
        CREATE TABLE IF NOT EXISTS used_nonces (
            nonce TEXT PRIMARY KEY,
            seen_at INTEGER NOT NULL
        )
    """)

    # NEW: Users table — 1 account per email, bound to one client_id
    c.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            user_key TEXT NOT NULL,
            client_id TEXT,
            nickname TEXT,
            created_at INTEGER NOT NULL,
            last_seen INTEGER NOT NULL
        )
    """)
    c.execute("CREATE INDEX IF NOT EXISTS idx_users_userkey  ON users (user_key)")
    c.execute("CREATE INDEX IF NOT EXISTS idx_users_clientid ON users (client_id)")

    conn.commit()
    conn.close()






def backfill_users_from_games_once() -> None:
    """
    Populate users from existing games so first future claimant isn't blocked by history.
    Safe to run multiple times (INSERT OR IGNORE).
    """
    conn = sqlite3.connect(CFG.games_db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute("""
            SELECT DISTINCT LOWER(TRIM(email)) AS email
            FROM games
            WHERE email IS NOT NULL AND TRIM(email) <> ''
        """).fetchall()
        now = now_ms()
        for r in rows:
            email = r["email"]
            if not email:
                continue
            emh = sha256_hex(email)
            conn.execute("""
                INSERT OR IGNORE INTO users (email, user_key, client_id, nickname, created_at, last_seen)
                VALUES (?, ?, NULL, NULL, ?, ?)
            """, (email, emh, now, now))
        conn.commit()
    finally:
        conn.close()


init_games_db()
backfill_users_from_games_once()


def nonce_used(nonce: str) -> bool:
    if not nonce:
        return True
    conn = get_db()
    try:
        cur = conn.execute("SELECT 1 FROM used_nonces WHERE nonce = ?", (nonce,))
        if cur.fetchone():
            return True
        conn.execute("INSERT INTO used_nonces (nonce, seen_at) VALUES (?, ?)", (nonce, now_ms()))
        threshold = now_ms() - 24 * 60 * 60 * 1000
        # >>> FIX: one-element tuple must be (threshold,) not (threshold)
        conn.execute("DELETE FROM used_nonces WHERE seen_at < ?", (threshold,))
        conn.commit()
        return False
    finally:
        conn.close()

# ---------------------------------------------------------------------------
# Request / Response logging
# ---------------------------------------------------------------------------

@app.before_request
def _before_request_logging():
    g.request_id = str(uuid.uuid4())
    g.start_time_ms = now_ms()
    log_json(
        "request_start",
        request_id=g.request_id,
        method=request.method,
        path=request.path,
        ip=client_ip(),
        ua=(request.headers.get("User-Agent") or "")[:200],
        content_type=request.headers.get("Content-Type"),
    )

@app.after_request
def _after_request_logging(resp):
    dur = now_ms() - getattr(g, "start_time_ms", now_ms())
    log_json(
        "request_end",
        request_id=getattr(g, "request_id", "?"),
        method=request.method,
        path=request.path,
        status=resp.status_code,
        duration_ms=dur,
        length=resp.calculate_content_length(),
    )
    return resp

@app.errorhandler(Exception)
def _handle_exception(e: Exception):
    err_id = str(uuid.uuid4())
    log_json(
        "exception",
        request_id=getattr(g, "request_id", "?"),
        error_id=err_id,
        type=type(e).__name__,
        message=str(e),
        traceback=traceback.format_exc(),
        path=request.path,
    )
    return jsonify({"status": "error", "message": "internal error", "error_id": err_id}), 500

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/api/submit_token", methods=["POST"])
@limiter.limit("20/hour")
def submit_token():
    data = request.get_json(silent=True) or {}
    cid   = (data.get("clientId") or "").strip()[:64]
    email = (data.get("email") or "").strip().lower()[:190]

    if not cid:
        return jsonify({"status": "error", "message": "clientId required"}), 400

    # Enforce: one account per email (owned by first client_id that claims it)
    if email:
        conn = get_db()
        try:
            row = conn.execute("SELECT client_id FROM users WHERE email = ?", (email,)).fetchone()
            if row is None:
                # First claim: create user bound to this client
                conn.execute("""
                    INSERT INTO users (email, user_key, client_id, created_at, last_seen)
                    VALUES (?, ?, ?, ?, ?)
                """, (email, sha256_hex(email), cid, now_ms(), now_ms()))
                conn.commit()
            else:
                existing_cid = row["client_id"]
                if existing_cid and existing_cid != cid:
                    # Already registered by a different profile/device
                    return jsonify({
                        "status": "error",
                        "code": "email_taken",
                        "message": "This email is already registered. Please use a different email."
                    }), 409
                # same device/profile: just refresh last_seen
                conn.execute("UPDATE users SET last_seen = ? WHERE email = ?", (now_ms(), email))
                conn.commit()
        finally:
            conn.close()

    emh = sha256_hex(email) if email else ""
    ua  = (request.headers.get("User-Agent") or "")[:200]
    ip  = client_ip()
    payload = {
        "cid": cid,
        "emh": emh,
        "ua": ua if CFG.bind_to_ua else "",
        "ip": ip if CFG.bind_to_ip else "",
        "exp": int(time.time()) + CFG.token_ttl_seconds,
        "n": os.urandom(8).hex(),
    }
    token = sign_token(payload)

    log_json(
        "token_issued",
        request_id=g.request_id,
        cid=cid,
        has_email=bool(email),
        ua_bound=CFG.bind_to_ua,
        ip_bound=CFG.bind_to_ip,
        exp=payload["exp"],
    )
    return jsonify({"status": "ok", "token": token, "exp": payload["exp"]})



@app.route("/api/submit_result_public", methods=["POST"])
@limiter.limit(
    "30/minute;500/day",
    key_func=lambda: request.headers.get("X-Client-Id") or get_remote_address()
)
def submit_result_public():
    data = request.get_json(silent=True) or {}

    tok = (data.get("token") or "").strip()
    vt = verify_token(tok)
    if not vt:
        log_json("token_verify_failed", request_id=g.request_id)
        return jsonify({"status": "error", "message": "bad or expired token"}), 401

    # Replay protection
    if nonce_used(vt.get("n", "")):
        log_json("replay_blocked", request_id=g.request_id)
        return jsonify({"status": "error", "message": "replay blocked"}), 409

    # Optional UA/IP check
    if CFG.bind_to_ua and vt.get("ua"):
        req_ua = (request.headers.get("User-Agent") or "")[:200]
        if vt["ua"] != req_ua:
            log_json("ua_mismatch", request_id=g.request_id, expected=vt["ua"], got=req_ua)
            return jsonify({"status": "error", "message": "ua mismatch"}), 401

    if CFG.bind_to_ip and vt.get("ip"):
        req_ip = client_ip()
        if vt["ip"] != req_ip:
            log_json("ip_mismatch", request_id=g.request_id, expected=vt["ip"], got=req_ip)
            return jsonify({"status": "error", "message": "ip mismatch"}), 401

    # Extract payload
    cid      = vt.get("cid", "")
    emh      = vt.get("emh", "")
    nickname = (data.get("nickname") or "Player").strip()[:64]
    email    = (data.get("email") or "").strip().lower()[:190]

    if email and sha256_hex(email) != emh:
        log_json("email_hash_mismatch", request_id=g.request_id)
        return jsonify({"status": "error", "message": "email mismatch"}), 400

    # NEW: ensure the submitting client owns this email (if provided)
    if email:
        conn = get_db()
        try:
            row = conn.execute("SELECT client_id FROM users WHERE email = ?", (email,)).fetchone()
            if row is None:
                return jsonify({"status": "error", "message": "unregistered email"}), 401
            owner = (row["client_id"] or "")
            if owner and owner != cid:
                log_json("email_not_owned", request_id=g.request_id, email=email, cid=cid)
                return jsonify({"status":"error","message":"email already registered by another profile"}), 403
            # Keep latest nickname + last_seen
            conn.execute("UPDATE users SET nickname = ?, last_seen = ? WHERE email = ?", (nickname, now_ms(), email))
            conn.commit()
        finally:
            conn.close()

    hits_made   = safe_int(data.get("hitsMade"), 0)
    target      = safe_int(data.get("target"), 0)
    avg_prec    = safe_int(data.get("avgPrecision"), 0)
    outcome     = (data.get("outcome") or "miss").strip().lower()
    if outcome not in ("win", "miss"):
        outcome = "miss"
    duration_ms = data.get("durationMs")
    duration_ms = safe_int(duration_ms, None) if duration_ms is not None else None

    # Validation
    if target not in (50,):
        return jsonify({"status": "error", "message": "invalid target"}), 400
    if not (0 <= hits_made <= target):
        return jsonify({"status": "error", "message": "invalid hits"}), 400
    if not (0 <= avg_prec <= 100):
        return jsonify({"status": "error", "message": "invalid precision"}), 400

    ukey = stable_key(email or None, cid or None)

    # DB write
    conn = get_db()
    try:
        conn.execute(
            """
            INSERT INTO games (user_key, nickname, email, hits_made, target, avg_precision, outcome, duration_ms, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ukey,
                nickname,
                (email or None),
                hits_made,
                target,
                avg_prec,
                outcome,
                duration_ms,
                now_ms(),
            ),
        )
        conn.commit()
    finally:
        conn.close()

    log_json(
        "submit_ok",
        request_id=g.request_id,
        cid=cid,
        ukey=ukey,
        hits_made=hits_made,
        target=target,
        avg_precision=avg_prec,
        outcome=outcome,
        duration_ms=duration_ms,
    )
    return jsonify({"status": "ok"})



@app.route("/api/leaderboard", methods=["GET"])
def leaderboard_public():
    limit = max(1, min(safe_int(request.args.get("limit", 50), 50), 200))
    conn = get_db()
    try:
        rows = conn.execute(
            """
            WITH ranked AS (
              SELECT
                id, user_key, nickname, email, hits_made, target, avg_precision, outcome, duration_ms, created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY user_key
                  ORDER BY hits_made DESC, avg_precision DESC, created_at ASC
                ) AS rn
              FROM games
            )
            SELECT nickname, hits_made, target, avg_precision, outcome, duration_ms, created_at
            FROM ranked
            WHERE rn = 1
            ORDER BY hits_made DESC, avg_precision DESC, created_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    finally:
        conn.close()

    items = [{
        "nickname":     (r["nickname"] or "Player"),
        "hitsMade":     int(r["hits_made"]),
        "target":       int(r["target"]),
        "avgPrecision": int(r["avg_precision"]),
        "outcome":      r["outcome"],
        "durationMs":   (int(r["duration_ms"]) if r["duration_ms"] is not None else None),
        "date":         int(r["created_at"]),
        "rank":         i + 1,
    } for i, r in enumerate(rows)]

    return jsonify({"status": "ok", "items": items})



@app.route("/api/leaderboard/me", methods=["GET"])
def leaderboard_me():
    """
    Find the caller's best score and global rank.
    Identify by email or clientId (query string).
      /api/leaderboard/me?email=alice@example.com
      /api/leaderboard/me?clientId=abc-123
      (both allowed; email preferred when present)
    """
    email = (request.args.get("email") or "").strip().lower()
    client_id = (request.args.get("clientId") or "").strip()
    if not email and not client_id:
        return jsonify({"status": "error", "message": "email or clientId required"}), 400

    ukey = stable_key(email if email else None, client_id if client_id else None)
    if not ukey:
        return jsonify({"status": "error", "message": "invalid identifiers"}), 400

    conn = get_db()
    try:
        # 1) Best score per user (rn=1)
        # 2) Rank all best scores globally
        row = conn.execute(
            """
            WITH per_user_best AS (
              SELECT
                id, user_key, nickname, email, hits_made, target, avg_precision, outcome, duration_ms, created_at,
                ROW_NUMBER() OVER (
                  PARTITION BY user_key
                  ORDER BY hits_made DESC, avg_precision DESC, created_at ASC
                ) AS rn
              FROM games
            ),
            ranked AS (
              SELECT
                user_key, nickname, email, hits_made, target, avg_precision, outcome, duration_ms, created_at,
                ROW_NUMBER() OVER (
                  ORDER BY hits_made DESC, avg_precision DESC, created_at ASC
                ) AS rnk
              FROM per_user_best
              WHERE rn = 1
            )
            SELECT
              nickname, email, hits_made, target, avg_precision, outcome, duration_ms, created_at, rnk
            FROM ranked
            WHERE user_key = ?
            """,
            (ukey,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        # Not ranked yet (no games for this user_key)
        return jsonify({"status": "ok", "item": None}), 200

    item = {
        "nickname":     (row["nickname"] or "Player"),
        "email":        (row["email"] or None),
        "hitsMade":     int(row["hits_made"]),
        "target":       int(row["target"]),
        "avgPrecision": int(row["avg_precision"]),
        "outcome":      row["outcome"],
        "durationMs":   (int(row["duration_ms"]) if row["duration_ms"] is not None else None),
        "date":         int(row["created_at"]),
        "rank":         int(row["rnk"]),
    }
    return jsonify({"status": "ok", "item": item})



# ---------------------------------------------------------------------------
#
# ---------------------------------------------------------------------------




##
# Users db
#


from flask import jsonify
import base64
import smtplib
from email.mime.text import MIMEText


# USERS DB
from flask import jsonify, request, session
from werkzeug.security import generate_password_hash, check_password_hash
import base64, smtplib, sqlite3, uuid, json
from email.mime.text import MIMEText

def init_user_db():
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            bio TEXT,
            profile_image TEXT,
            verification_token TEXT,
            is_verified INTEGER DEFAULT 0
        )
    """)
    conn.commit()
    conn.close()

init_user_db()

@app.route('/api/save_profile', methods=['POST'])
def save_profile():
    try:
        data = request.get_json(force=True)
        nickname = data.get('nickname', '').strip()
        email = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()
        bio = data.get('bio', '').strip()
        image_data = data.get('image')
        print("[SAVE_PROFILE] Incoming:", json.dumps(data, indent=2))

        if not nickname or not email or not password:
            return jsonify({'status': 'error', 'message': 'Nickname, email, and password required'}), 400

        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
        if cursor.fetchone():
            conn.close()
            return jsonify({'status': 'error', 'message': 'Email already registered'}), 400

        token = str(uuid.uuid4())
        password_hash = generate_password_hash(password)

        cursor.execute("""
            INSERT INTO users (nickname, email, password_hash, bio, profile_image, verification_token)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (nickname, email, password_hash, bio, image_data, token))
        conn.commit()
        conn.close()

        send_verification_email(email, token)
        print(f"[SAVE_PROFILE] Created user {email}, sent token {token}")
        return jsonify({'status': 'ok', 'message': 'Verification email sent.'})

    except Exception as e:
        print(f"[SAVE_PROFILE ERROR] {type(e).__name__}: {e}")
        return jsonify({'status': 'error', 'message': f'Internal error: {str(e)}'}), 500

@app.route('/api/login', methods=['POST'])
def login_user():
    try:
        data = request.get_json(force=True)
        email = data.get('email', '').strip().lower()
        password = data.get('password', '').strip()

        conn = sqlite3.connect('users.db')
        cursor = conn.cursor()
        cursor.execute("SELECT id, nickname, password_hash, is_verified, bio, profile_image FROM users WHERE email = ?", (email,))
        row = cursor.fetchone()
        conn.close()

        if not row:
            return jsonify({'status': 'error', 'message': 'User not found'}), 404

        user_id, nickname, password_hash, is_verified, bio, image = row
        if not check_password_hash(password_hash, password):
            return jsonify({'status': 'error', 'message': 'Incorrect password'}), 403

        session['user_id'] = user_id
        return jsonify({
            'status': 'ok',
            'message': 'Login successful.',
            'profile': {
                'nickname': nickname,
                'email': email,
                'bio': bio,
                'image': image,
                'isVerified': bool(is_verified)
            }
        })

    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Login failed: {str(e)}'}), 500

@app.route('/api/session_status')
def session_status():
    user_id = session.get('user_id')
    if not user_id:
        return jsonify({'loggedIn': False})
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    cursor.execute("SELECT nickname, email, bio, profile_image, is_verified FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        return jsonify({'loggedIn': False})
    nickname, email, bio, image, is_verified = row
    return jsonify({
        'loggedIn': True,
        'profile': {
            'nickname': nickname,
            'email': email,
            'bio': bio,
            'image': image,
            'isVerified': bool(is_verified)
        }
    })

@app.route('/api/logout', methods=['POST'])
def logout_user():
    session.clear()
    return jsonify({'status': 'ok', 'message': 'Logged out'})

@app.route('/verify_email')
def verify_email():
    token = request.args.get('token')
    if not token:
        return "Invalid verification link", 400
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    cursor.execute("UPDATE users SET is_verified = 1 WHERE verification_token = ?", (token,))
    updated = cursor.rowcount
    conn.commit()
    conn.close()
    return "Email verified successfully!" if updated else "Invalid or expired token.", 400


@app.route('/ar')
def ar_page():
    return app.send_static_file('ar/index.html')

    

def send_verification_email(to_email, token):
    try:
        link = f"http://localhost:1111/verify_email?token={token}"
        msg = MIMEText(f"Click to verify your email:\n\n{link}")
        msg['Subject'] = 'Verify your Helena Paint account'
        msg['From'] = 'noreply@yourdomain.com'
        msg['To'] = to_email
        print(f"[EMAIL] Sending to {to_email}, token: {token}")
        smtp = smtplib.SMTP('smtp.yourdomain.com', 587)
        smtp.starttls()
        smtp.login('your_username', 'your_password')
        smtp.send_message(msg)
        smtp.quit()
        print(f"[EMAIL] Sent to {to_email}")
    except Exception as e:
        print(f"[EMAIL ERROR] {type(e).__name__}: {e}")



def generate_temp_ssl_cert():
    ssl_dir = "/tmp/ssl"
    os.makedirs(ssl_dir, exist_ok=True)
    cert_file = os.path.join(ssl_dir, "server.crt")
    key_file = os.path.join(ssl_dir, "server.key")
    conf_file = os.path.join(ssl_dir, "openssl.cnf")

    if not os.path.exists(cert_file) or not os.path.exists(key_file):
        with open(conf_file, "w") as f:
            f.write("""[req]
distinguished_name = req_distinguished_name
x509_extensions=v3_req
prompt=no

[req_distinguished_name]
CN=localhost

[v3_req]
subjectAltName=DNS:localhost,IP:127.0.0.1
""")
        subprocess.run([
            "openssl","req","-x509","-newkey","rsa:2048","-days","1","-nodes",
            "-keyout", key_file, "-out", cert_file,
            "-config", conf_file, "-extensions","v3_req"
        ], check=True)
    return cert_file, key_file



if __name__ == '__main__':
    cert, key = generate_temp_ssl_cert()
    app.run(debug=True, host='0.0.0.0', port=1111, ssl_context=(cert, key))

# if __name__ == '__main__':
#     app.run(debug=True, host='0.0.0.0', port=1111)
