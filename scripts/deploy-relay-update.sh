#!/usr/bin/env bash
set -euo pipefail

archive=${1:-/root/codex-bridge-fix.tar.gz}
environment_file=${2:-/root/codex-bridge-fix.env}
app_dir=/opt/codex-bridge-relay
node_dir=/opt/codex-bridge-node
rollback_archive=/root/codex-bridge-rollback.tar.gz
rollback_env=/root/codex-bridge-rollback.env

[[ $(id -u) -eq 0 ]]
test -f "$archive"
test -f "$environment_file"
test -x "$node_dir/bin/node"
test -d "$app_dir/node_modules"

tar --exclude=node_modules -czf "$rollback_archive" -C "$app_dir" .
install -o root -g root -m 0600 /etc/codex-bridge-relay.env "$rollback_env"

restore() {
  echo "Update failed; restoring the previous Relay release." >&2
  tar -xzf "$rollback_archive" -C "$app_dir"
  install -o root -g root -m 0600 "$rollback_env" /etc/codex-bridge-relay.env
  systemctl start codex-bridge-relay.service || true
}
trap restore ERR

systemctl stop codex-bridge-relay.service
tar -xzf "$archive" -C "$app_dir"
install -o root -g root -m 0600 "$environment_file" /etc/codex-bridge-relay.env
export PATH="$node_dir/bin:$PATH"
cd "$app_dir"
npm ci --no-audit --no-fund
npm run build
chown -R root:codexrelay "$app_dir"
find "$app_dir" -type d -exec chmod 0755 {} +
systemctl start codex-bridge-relay.service

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:43120/relay/health >/dev/null; then
    trap - ERR
    rm -f "$rollback_archive" "$rollback_env" "$archive" "$environment_file"
    echo "Relay update is healthy."
    exit 0
  fi
  sleep 1
done

false
