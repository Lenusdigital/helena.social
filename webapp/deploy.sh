#!/bin/bash

# Default values
PIN=""

# Parse arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        -pin) PIN="$2"; shift ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

if [[ -z "$PIN" ]]; then
    echo "Error: PIN must be provided with -pin"
    exit 1
fi

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
    --exclude 'private_trash/' \
    --exclude 'static/images/gallery1/' \
    "$LOCAL_DIR" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

echo "=== Writing .env file on remote ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST << EOF
cat > $REMOTE_DIR/.env << EOL
APP_PIN=$PIN
EOL
chmod 644 $REMOTE_DIR/.env
EOF

echo "=== Restarting Flask service on remote ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST "systemctl restart helena_flask && systemctl status helena_flask --no-pager"

echo "=== Fixing permissions for static assets and History file ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST << EOF
cd $REMOTE_DIR
find static/fonts -type f -exec chmod 644 {} \;
find static/fonts -type d -exec chmod 755 {} \;
chown -R www-data:www-data static/fonts

chown -R www-data:www-data static/images/gallery1
chmod -R 775 static/images/gallery1

if [ -f History ]; then
    chmod 644 History
    echo "=== Set permissions for History file ==="
else
    echo "=== WARNING: History file not found ==="
fi

if [ ! -d private_trash ]; then
    echo "=== WARNING: private_trash/ does not exist on server ==="
fi
EOF

echo "=== Deployment complete ==="
