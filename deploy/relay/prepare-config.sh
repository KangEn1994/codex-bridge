#!/usr/bin/env bash
set -euo pipefail

public_url=${1:-}
if [[ ! "$public_url" =~ ^https://[^/?#]+(:[0-9]+)?/?$ ]]; then
  echo "Usage: ./prepare-config.sh https://bridge.example.com" >&2
  exit 1
fi
public_url=${public_url%/}

new_secret() {
  openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
}

host_token=$(new_secret)
phone_token=$(new_secret)

cat > .env <<EOF
CODEX_RELAY_PUBLIC_URL=$public_url
CODEX_RELAY_HOST_TOKEN=$host_token
CODEX_RELAY_PHONE_TOKEN=$phone_token
PORT=8080
HOST=0.0.0.0
CODEX_RELAY_WEB_PORT=3000
CODEX_RELAY_WEB_INTERNAL_URL=http://127.0.0.1:3000
CODEX_RELAY_TRUST_PROXY=true
EOF

cat > relay-client.json <<EOF
{
  "publicUrl": "$public_url",
  "hostToken": "$host_token",
  "phoneToken": "$phone_token"
}
EOF

chmod 600 .env relay-client.json
echo "Created $(pwd)/.env and $(pwd)/relay-client.json"
echo "Keep both files private; they contain credentials that can control Codex Bridge."
