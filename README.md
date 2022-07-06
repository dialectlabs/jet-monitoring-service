# Jet-monitoring-service

A service running `@dialectlabs/monitor` to notify Jet users when their collateral balance becomes unhealthy and/or nearing liquidation.
Users can subscribe to receive notifications directly to their wallet inbox (on-chain Dialect thread), via email, or telegram. 
Use the Jet decentralized borrowing and lending app at https://app.jetprotocol.io/ and subscribe to notifications via the in the top right corner.

The service is currently hosted with the Dialect web3 cloud hosting service.
See https://github.com/dialectlabs/monitor for details on the monitor module.

This code is open source. To contribute, see the development section below.

## Local Development

### Prerequisites

- Git
- Yarn (<2)
- Nodejs (>=16.10.0 <17)

### Getting started with monitor development in this repo

#### Install dependencies

**yarn:**

```shell
yarn
```

#### Run a solana validator node with dialect program

Please follow the instructions in https://github.com/dialectlabs/protocol#local-development

### Running locally

#### Step 1. Generate a new keypair for monitoring service and fund it

```bash
export your_path=~/projects/dialect
solana-keygen new --outfile ${your_path}/jet-monitoring-service-dev-local-key.json
solana-keygen pubkey ${your_path}/jet-monitoring-service-dev-local-key.json > ${your_path}/jet-monitoring-service-dev-local-key.pub
solana -k ${your_path}/jet-monitoring-service-dev-local-key.json airdrop 5
```

#### Step 2. Start server

```shell
export your_path=~/projects/dialect
PRIVATE_KEY=$(cat ${your_path}/jet-monitoring-service-dev-local-key.json) yarn start:dev
```

#### Step 3. Start client

```shell
export your_path=~/projects/dialect
MONITORING_SERVICE_PUBLIC_KEY=$(cat ${your_path}/jet-monitoring-service-dev-local-key.pub) ts-node test/dialect-clients.ts
```

#### Step 4. Look at client logs for notifications

When both client and server are started, server will send notifications to clients

### Containerization

#### Build image (macOS)

```shell
brew install jq
./docker-build.sh
```

#### Run container locally

```shell
export your_path=~/projects/dialect
docker run --name dialectlabs_monitoring-service -e PRIVATE_KEY=$(cat ${your_path}/jet-monitoring-service-dev-local-key.json) dialectlab/monitoring-service:latest 
```

#### Publish image

```shell
brew install jq
docker login
./docker-publish.sh
```
