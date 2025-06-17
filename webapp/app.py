import os
import uuid
import shutil
from flask import Flask, render_template, request, redirect, url_for, abort, session
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.secret_key = 'REPLACE_WITH_A_SECRET_KEY'

UPLOAD_FOLDER = os.path.join('static', 'images', 'gallery1')
TRASH_FOLDER = os.path.join('private_trash')  # outside static
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif'}
SECRET_PIN = '1111'

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
os.makedirs(TRASH_FOLDER, exist_ok=True)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    images = sorted(os.listdir(app.config['UPLOAD_FOLDER']))
    logged_in = session.get('logged_in', False)
    return render_template('index.html', images=images, logged_in=logged_in)

@app.route('/login', methods=['POST'])
def login():
    if request.form.get('pin') == SECRET_PIN:
        session['logged_in'] = True
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

if __name__ == '__main__':
    app.run(debug=True)
