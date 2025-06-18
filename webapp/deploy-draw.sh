#!/bin/bash

LOCAL_DIR="$(pwd)/"
REMOTE_USER="root"
REMOTE_HOST="yolo.cx"
REMOTE_PORT="18021"
REMOTE_DIR="/var/www/other/moved/helena.social/flaskapp"

echo "=== Deploying DRAW route only to $REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR over port $REMOTE_PORT ==="

rsync -avz -e "ssh -p $REMOTE_PORT" --delete \
    --exclude 'venv/' \
    --exclude '.git/' \
    --exclude '__pycache__/' \
    --exclude '*.pyc' \
    --exclude '.DS_Store' \
    --exclude 'private_trash/' \
    --exclude 'static/images/gallery1/' \
    --exclude 'static/uploads/' \
    --exclude 'static/css/' \
    --exclude 'static/fonts/' \
    --exclude 'static/images/ui/' \
    --exclude 'static/sounds/' \
    --include 'static/draw/' \
    --include 'static/draw/***' \
    --include 'templates/' \
    --include 'templates/draw.html' \
    --exclude 'templates/***' \
    "$LOCAL_DIR" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR"

echo "=== Restarting Flask service on remote ==="
ssh -p $REMOTE_PORT $REMOTE_USER@$REMOTE_HOST "systemctl restart helena_flask && systemctl status helena_flask --no-pager"

echo "=== Deployment complete ==="
