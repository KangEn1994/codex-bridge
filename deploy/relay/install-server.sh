#!/usr/bin/env bash
set -euo pipefail

archive=${1:-/root/codex-bridge-relay.tar.gz}
environment_file=${2:-/root/codex-bridge-relay.env}
app_dir=/opt/codex-bridge-relay
node_dir=/opt/codex-bridge-node

if [[ $(id -u) -ne 0 ]]; then
  echo "This installer must run as root." >&2
  exit 1
fi

# npm's launcher resolves `node` through PATH. Put the isolated Node 22 runtime
# first so the server's system-wide Node.js installation remains untouched.
export PATH="$node_dir/bin:$PATH"
test -f "$archive"
test -f "$environment_file"

if [[ ! -x "$node_dir/bin/node" ]]; then
  node_version=v22.23.2
  node_base="https://nodejs.org/dist/$node_version"
  filename="node-$node_version-linux-x64.tar.xz"
  expected=d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307
  node_archive=$(mktemp --suffix=.tar.xz)
  node_next=$(mktemp -d /opt/codex-bridge-node-next.XXXXXX)
  trap 'rm -f "$node_archive"; rm -rf "$node_next"' EXIT
  curl -fsSL "$node_base/$filename" -o "$node_archive"
  actual=$(sha256sum "$node_archive" | awk '{print $1}')
  [[ "$actual" == "$expected" ]]
  tar -xJf "$node_archive" -C "$node_next" --strip-components=1
  mv "$node_next" "$node_dir"
  rm -f "$node_archive"
  trap - EXIT
fi

# mktemp creates the staging directory as 0700. The service runs as the
# unprivileged codexrelay user, so make only the runtime tree traversable.
chown -R root:root "$node_dir"
find "$node_dir" -type d -exec chmod 0755 {} +

if ! id codexrelay >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/codex-bridge-relay --create-home --shell /usr/sbin/nologin codexrelay
fi

install -d -m 0755 "$app_dir"
tar -xzf "$archive" -C "$app_dir"
cd "$app_dir"
npm ci --no-audit --no-fund
npm run build
chown -R root:codexrelay "$app_dir"
find "$app_dir" -type d -exec chmod 0755 {} +

install -o root -g root -m 0600 "$environment_file" /etc/codex-bridge-relay.env
install -o root -g root -m 0644 deploy/relay/codex-bridge-relay.service /etc/systemd/system/codex-bridge-relay.service
systemctl daemon-reload
systemctl enable --now codex-bridge-relay.service

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:43120/relay/health >/dev/null; then
    echo "Codex Bridge Relay is healthy on 127.0.0.1:43120."
    exit 0
  fi
  sleep 1
done

systemctl status codex-bridge-relay.service --no-pager || true
journalctl -u codex-bridge-relay.service -n 80 --no-pager || true
exit 1
