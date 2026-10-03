#!/usr/bin/env bash
# Local Synapse homeserver for developing Relay, with test users and fake
# bridged chats.  Usage:
#   scripts/dev-server.sh          # create (first run) or start
#   scripts/dev-server.sh reset    # wipe and recreate
#   scripts/dev-server.sh stop
set -euo pipefail

cd "$(dirname "$0")/.."
DATA="$PWD/.dev-server"
NAME=relay-dev-synapse
IMAGE=matrixdotorg/synapse:latest
PASS=testpass123

case "${1:-start}" in
  stop)  docker rm -f "$NAME" >/dev/null 2>&1 || true; echo "Stopped."; exit 0 ;;
  reset) docker rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$DATA" ;;
esac

fresh=0
if [ ! -f "$DATA/homeserver.yaml" ]; then
  fresh=1
  mkdir -p "$DATA"
  docker run --rm -v "$DATA:/data" -e SYNAPSE_SERVER_NAME=localhost -e SYNAPSE_REPORT_STATS=no "$IMAGE" generate >/dev/null
  # Relax rate limits: the seed script and fast UI testing would trip them.
  fast='{ per_second: 1000, burst_count: 1000 }'
  cat >> "$DATA/homeserver.yaml" <<EOF
rc_message: $fast
rc_room_creation: $fast
rc_joins: { local: $fast, remote: $fast }
rc_invites: { per_room: $fast, per_user: $fast, per_issuer: $fast }
rc_login: { address: $fast, account: $fast, failed_attempts: $fast }
rc_registration: $fast
EOF
fi

if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  docker run -d --name "$NAME" -p 127.0.0.1:8008:8008 -v "$DATA:/data" "$IMAGE" >/dev/null
fi

printf 'Waiting for Synapse'
for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:8008/_matrix/client/versions >/dev/null && break
  printf '.'; sleep 1
done
echo

if [ "$fresh" = 1 ]; then
  for u in alice bob carol; do
    docker exec "$NAME" register_new_matrix_user -c /data/homeserver.yaml -u "$u" -p "$PASS" --no-admin http://localhost:8008 >/dev/null
  done
  node scripts/seed-dev.mjs http://127.0.0.1:8008 "$PASS"
fi

echo "Homeserver: http://127.0.0.1:8008   Log in as @alice:localhost / $PASS (bob and carol also exist)"
