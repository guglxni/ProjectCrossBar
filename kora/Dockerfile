FROM ghcr.io/solana-foundation/kora:latest

WORKDIR /app
COPY kora.toml signers.toml ./

# Heroku sets PORT; default 8080 for local docker.
CMD sh -c 'kora --rpc-url "${RPC_URL:-https://api.devnet.solana.com}" --config /app/kora.toml rpc start --signers-config /app/signers.toml -p "${PORT:-8080}"'
