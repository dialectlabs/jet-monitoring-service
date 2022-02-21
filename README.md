# jet-monitoring-service

### generate a new keypair for jet monitoring service and fund it

```bash
export keypairs_dir=~/projects/dialect
solana-keygen new --outfile ${keypairs_dir}/jet-service-dev-local-key.json
solana-keygen pubkey ${keypairs_dir}/jet-service-dev-local-key.json > ${keypairs_dir}/jet-service-dev-local-key.pub
solana -k ${keypairs_dir}/jet-service-dev-local-key.json airdrop 300
```
### start server

```
export keypairs_dir=~/projects/dialect
PRIVATE_KEY=$(cat ${keypairs_dir}/jet-service-dev-local-key.json) ts-node src/server/jet-monitoring-service.ts
```

### start client

```
export keypairs_dir=~/projects/dialect
JET_PUBLIC_KEY=$(solana address --keypair ${keypairs_dir}/jet-service-dev-local-key.json) USER_PRIVATE_KEY=$(cat ${keypairs_dir}/monitoring-service-dev-local-key.json) ts-node src/client/jet-client.ts
```
