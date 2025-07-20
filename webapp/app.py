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
app.secret_key = 'REPLACE_WITH_A_SECRET_KEY'

from datetime import datetime
app.jinja_env.globals['cache_bust'] = lambda: int(datetime.utcnow().timestamp())

UPLOAD_FOLDER = os.path.join('static', 'images', 'gallery1')
TRASH_FOLDER = os.path.join('private_trash')
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}


from dotenv import load_dotenv
load_dotenv()

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
        conn = sqlite3.connect('History')
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
        conn = sqlite3.connect('History')
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
#         conn = sqlite3.connect('History')
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
#         conn = sqlite3.connect('History')
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
#         conn = sqlite3.connect('History')
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





if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=1111)
