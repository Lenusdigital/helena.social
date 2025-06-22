#!/bin/bash

# === CONFIGURATION ===
LOCAL_DIR="$(pwd)/chat/"
REMOTE_USER="root"
REMOTE_HOST="yolo.cx"
REMOTE_PORT="18021"
REMOTE_DIR="/var/www/other/moved/helena.social/chat"
SERVICE_NAME="helena-chat-ws"

# === DEPLOY ===
echo "=== Deploying Chat WebSocket server to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR over port $REMOTE_PORT ==="

rsync -avz -e "ssh -p $REMOTE_PORT" --delete \
    --exclude 'node_modules/' \
    --exclude '.git/' \
    --exclude '*.log' \
    --exclude '*.tmp' \
    "$LOCAL_DIR" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

# === Restart systemd service ===
echo "=== Restarting $SERVICE_NAME service on remote ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST "
    systemctl restart $SERVICE_NAME && systemctl status $SERVICE_NAME --no-pager
"

echo "=== Deployment complete ==="
