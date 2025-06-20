#!/bin/bash

LOCAL_DIR="$(pwd)/"
REMOTE_USER="root"
REMOTE_HOST="yolo.cx"
REMOTE_PORT="18021"
REMOTE_DIR="/var/www/other/moved/helena.social/flaskapp"
DRAW_HTML="templates/draw.html"
VERSION_FILE="VERSION"

# Read version from VERSION file
if [[ ! -f "$VERSION_FILE" ]]; then
    echo "!!! ERROR: VERSION file not found. Aborting."
    exit 1
fi

APP_VERSION=$(cat "$VERSION_FILE" | tr -d ' \n')

if [[ -z "$APP_VERSION" ]]; then
    echo "!!! ERROR: VERSION file empty. Aborting."
    exit 1
fi

# Auto bump version (vX.XXX → vX.(XXX+1))
BASE_VER=$(echo "$APP_VERSION" | cut -d'.' -f1 | tr -d 'v')
MINOR_VER=$(echo "$APP_VERSION" | cut -d'.' -f2)

if [[ -z "$BASE_VER" || -z "$MINOR_VER" ]]; then
    echo "!!! ERROR: Invalid VERSION format. Aborting."
    exit 1
fi

NEW_MINOR_VER=$((10#$MINOR_VER + 1))
NEW_VERSION="v$BASE_VER.$(printf "%03d" $NEW_MINOR_VER)"

# Write bumped version back
echo "$NEW_VERSION" > "$VERSION_FILE"

echo "=== Bumping to new version: $NEW_VERSION ==="

VERSION_DATE=$(date +"%H%M%S %Y%m%d")

# Backup draw.html
cp "$DRAW_HTML" "$DRAW_HTML.bak"

# Replace version line in draw.html
sed -E -i '' "s#<title>HP v[0-9]+\.[0-9]+ \([0-9 ]+\)</title>#<title>HP $NEW_VERSION (${VERSION_DATE})</title>#" "$DRAW_HTML"

# Extract result
RESULT_LINE=$(grep '<title>HP v' "$DRAW_HTML")

if [[ -n "$RESULT_LINE" ]]; then
    echo "=== Updated draw.html title: $RESULT_LINE ==="
else
    echo "!!! ERROR: Failed to update draw.html. Aborting."
    exit 1
fi

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

echo "=== Deployment complete: version $NEW_VERSION (${VERSION_DATE}) deployed ==="
