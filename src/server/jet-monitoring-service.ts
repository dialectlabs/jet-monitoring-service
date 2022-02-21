import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { idl, programs, Wallet_ } from '@dialectlabs/web3';
import {
  Data,
  Monitor,
  Monitors,
  Pipelines,
  ResourceId,
} from '@dialectlabs/monitor';
import { Idl, Program, Provider } from '@project-serum/anchor';
import BN from 'bn.js';
import {
  JET_MARKET_ADDRESS_DEVNET,
  JetClient,
  JetMarket,
  JetObligation,
  JetReserve,
} from '@jet-lab/jet-engine';
import { Duration } from 'luxon';
import { MintPosition, mints } from './jet-api';
import * as anchor from '@project-serum/anchor';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const jetKeypair: Keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
);
const wallet = Wallet_.embedded(jetKeypair.secretKey);

function getDialectProgram(): Program {
  const dialectConnection = new Connection(
    process.env.RPC_URL || 'http://localhost:8899',
    'recent',
  );
  const dialectProvider = new Provider(
    dialectConnection,
    wallet,
    Provider.defaultOptions(),
  );
  return new Program(
    idl as Idl,
    new PublicKey(programs['localnet'].programAddress),
    dialectProvider,
  );
}

function getJetClient(): Promise<JetClient> {
  const jetConnection = new Connection(
    'https://api.devnet.solana.com',
    Provider.defaultOptions(),
  );
  const jetProvider = new Provider(
    jetConnection,
    wallet,
    Provider.defaultOptions(),
  );
  return JetClient.connect(jetProvider, true);
}

async function run() {
  type DataType = {
    cratio: number;
  };

  const jetClient = await getJetClient();

  function getCratio(obligation: JetObligation) {
    const positions: (MintPosition | undefined)[] = mints.map((m) => {
      const position = obligation.positions.find((p) =>
        p.reserve.tokenMint.equals(m.publicKey),
      );
      return (
        position && {
          ...m,
          depositedUsd: position.collateralBalance
            .muln(position.reserve.priceData.price || 1) // 1 to handle USDC
            .divb(new BN(m.decimals))
            .lamports.toNumber(),
          borrowedUsd: position.loanBalance
            .muln(position.reserve.priceData.price || 1) // 1 to handle USDC
            .divb(new BN(m.decimals))
            .lamports.toNumber(),
        }
      );
    });
    const totalDepositedUsd = positions
      .filter((it) => it)
      .reduce((acc, next) => acc + next!.depositedUsd, 0);
    const totalBorrowedUsd = positions
      .filter((it) => it)
      .reduce((acc, next) => acc + next!.borrowedUsd, 0);
    return totalBorrowedUsd === 0
      ? 0
      : Math.round((totalDepositedUsd / totalBorrowedUsd) * 100);
  }

  const unhealthyCRatioWarningThreshold = 150; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation
  const liquidationWarningThreshold = 125; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation

  const jetMonitor: Monitor<DataType> = Monitors.builder({
    dialectProgram: getDialectProgram(),
    monitorKeypair: jetKeypair,
  })
    .defineDataSource<DataType>()
    .poll(async (subscribers: ResourceId[]) => {
      console.log(`Polling data for ${subscribers.length} jet subscribers`);
      // Load devnet market data from RPC
      const market = await JetMarket.load(jetClient, JET_MARKET_ADDRESS_DEVNET);
      // Load all reserves
      const reserves = await JetReserve.loadMultiple(jetClient, market);

      const data: Promise<Data<DataType>>[] = subscribers.map(
        async (resourceId) => {
          const obligation = await JetObligation.load(
            jetClient,
            JET_MARKET_ADDRESS_DEVNET,
            reserves,
            resourceId,
          );
          return {
            data: {
              cratio: getCratio(obligation),
            },
            resourceId,
          };
        },
      );
      return Promise.all(data).then((datum) => datum);
    }, Duration.fromObject({ seconds: 15 }))
    .transform<number>({
      keys: ['cratio'],
      pipelines: [
        Pipelines.threshold(
          {
            type: 'falling-edge',
            threshold: unhealthyCRatioWarningThreshold,
          },
          {
            messageBuilder: (value) =>
              `Warning: Your cratio (${value}) has dropped below the ${unhealthyCRatioWarningThreshold} unhealthy threshold`,
          },
          {
            type: 'throttle-time',
            timeSpan: Duration.fromObject({ minutes: 5 }),
          },
        ),
        Pipelines.threshold(
          {
            type: 'falling-edge',
            threshold: liquidationWarningThreshold,
          },
          {
            messageBuilder: (value) =>
              `Danger: Your cratio (${value}) has dropped below the ${liquidationWarningThreshold} liquidation threshold, and is now at risk of liquidation.`,
          },
          {
            type: 'throttle-time',
            timeSpan: Duration.fromObject({ minutes: 1 }),
          },
        ),
      ],
    })
    .dispatch('unicast')
    .build();

  jetMonitor.start();
}

run();
