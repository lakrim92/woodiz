#!/bin/bash
# Backup quotidien des fichiers JSON de données — conserve 30 jours

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$DIR/backups"
DATE="$(date +%Y-%m-%d)"
DEST="$BACKUP_DIR/$DATE"

mkdir -p "$DEST"

for f in orders.json pending_items.json promo_used.json; do
  if [ -f "$DIR/$f" ]; then
    cp "$DIR/$f" "$DEST/$f"
  fi
done

# Supprimer les backups de plus de 30 jours
find "$BACKUP_DIR" -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup OK → $DEST"
