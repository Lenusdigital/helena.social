#!/bin/bash

LOCAL_DIR="$(pwd)/"
REMOTE_USER="root"
REMOTE_HOST="yolo.cx"
REMOTE_PORT="18021"
REMOTE_DIR="/var/www/other/moved/helena.social/flaskapp"

echo "=== Deploying Flask app to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR over port $REMOTE_PORT ==="

rsync -avz -e "ssh -p $REMOTE_PORT" --delete \
    --exclude 'venv/' \
    --exclude '.git/' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    "$LOCAL_DIR" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

echo "=== Restarting Flask service on remote ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST "systemctl restart helena_flask && systemctl status helena_flask --no-pager"

echo "=== Fixing permissions for static assets ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST << EOF
cd $REMOTE_DIR
find static/fonts -type f -exec chmod 644 {} \;
find static/fonts -type d -exec chmod 755 {} \;
chown -R www-data:www-data static/fonts

chown -R www-data:www-data static/images/gallery1
chmod -R 775 static/images/gallery1
EOF


echo "=== Deployment complete ==="
