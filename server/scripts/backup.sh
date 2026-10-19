#!/usr/bin/env bash
set -euo pipefail

# Backs up the CashDash Postgres database to ./backups with a timestamped dump.
# Usage: ./scripts/backup.sh  (run from server/ or anywhere)

CONTAINER="${DB_CONTAINER:-gpt-postgres}"
DB_USER="${DB_USER:-gpt}"
DB_NAME="${DB_NAME:-gptsite}"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/gptsite-$STAMP.sql.gz"

docker exec -e PGPASSWORD=gpt_secret "$CONTAINER" \
  pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$OUT"

echo "Backup written to $OUT ($(du -h "$OUT" | cut -f1))"
