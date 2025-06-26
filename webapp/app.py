import os
import uuid
import shutil
from flask import Flask, render_template, request, redirect, url_for, abort, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import sqlite3
import json



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



from datetime import datetime, timedelta

def webkit_to_datetime(webkit_timestamp):
    if not webkit_timestamp:
        return None
    return datetime(1601, 1, 1) + timedelta(microseconds=webkit_timestamp)

@app.route('/history')
@login_required
def history():
    results = []
    query = request.args.get('query', '')
    status = ''
    per_page = 50
    page = request.args.get('page', 1, type=int)
    offset = (page - 1) * per_page
    total = 0

    try:
        conn = sqlite3.connect('History')
        cursor = conn.cursor()

        if query:
            cursor.execute("SELECT COUNT(*) FROM urls WHERE title LIKE ? OR url LIKE ?", 
                           ('%' + query + '%', '%' + query + '%'))
            total = cursor.fetchone()[0]

            cursor.execute("""
                SELECT id, title, url, last_visit_time FROM urls
                WHERE title LIKE ? OR url LIKE ?
                ORDER BY last_visit_time DESC
                LIMIT ? OFFSET ?
            """, ('%' + query + '%', '%' + query + '%', per_page, offset))
        else:
            cursor.execute("SELECT COUNT(*) FROM urls")
            total = cursor.fetchone()[0]

            cursor.execute("""
                SELECT id, title, url, last_visit_time FROM urls
                ORDER BY last_visit_time DESC
                LIMIT ? OFFSET ?
            """, (per_page, offset))

        rows = cursor.fetchall()
        conn.close()

        results = [
            {
                'id': row[0],
                'title': row[1],
                'url': row[2],
                'date': webkit_to_datetime(row[3]).strftime('%Y-%m-%d %H:%M:%S') if row[3] else "Unknown"
            }
            for row in rows
        ]

        total_pages = (total + per_page - 1) // per_page
        status = f"Showing page {page} of {total_pages}, {total} total record(s)."

    except Exception as e:
        status = f"Error reading database: {str(e)}"
        total_pages = 1

    return render_template(
        'history.html',
        results=results,
        query=query,
        status=status,
        page=page,
        total_pages=total_pages
    )



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



if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=1111)
