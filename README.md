# jet-monitoring-service

### generate a new keypair for jet monitoring service and fund it

```bash
export your_path=~/projects/dialect
solana-keygen new --outfile ${your_path}/jet-service-dev-local-key.json
solana-keygen pubkey ${your_path}/jet-service-dev-local-key.json > ${your_path}/jet-service-dev-local-key.pub
solana -k ${your_path}/jet-service-dev-local-key.json airdrop 300
```
### start server

```
export your_path=~/projects/dialect
PRIVATE_KEY=$(cat ${your_path}/jet-service-dev-local-key.json) ts-node src/server/jet-monitoring-service.ts
```

### start client

```
export your_path=~/projects/dialect
JET_PUBLIC_KEY=$(solana address --keypair ${your_path}/jet-service-dev-local-key.json) USER_PRIVATE_KEY=$(cat /path/to/your/keypair.json) ts-node src/client/jet-client.ts
```
