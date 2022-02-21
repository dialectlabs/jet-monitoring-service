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
    'https://dialect.devnet.rpcpool.com/ee21d5f582c150119dd6475765b3',
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
          const cratio = getCratio(obligation);
          return {
            data: {
              cratio,
            },
            resourceId,
          };
        },
      );
      return Promise.all(data).then((datum) => datum);
    }, Duration.fromObject({ seconds: 5 }))
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
            `⚠️ Warning! Your cratio is ${value}%. It has dropped below the ${unhealthyCRatioWarningThreshold}% threshold and is now considered unhealthy. If it drops any further, you may soon be at risk of liquidation.`,
          },
          // {
          //   type: 'throttle-time',
          //   timeSpan: Duration.fromObject({ minutes: 5 }),
          // },
        ),
        Pipelines.threshold(
          {
            type: 'rising-edge',
            threshold: unhealthyCRatioWarningThreshold,
          },
          {
            messageBuilder: (value) =>
            `✅ Your C-Ratio has risen back above the ${unhealthyCRatioWarningThreshold}% unhealthy threshold, and is now ${value}%.`,
          },
          // Optionally turn on throttling, to limit to one message in a given time window.
          // {
          //   type: 'throttle-time',
          //   timeSpan: Duration.fromObject({ minutes: 5 }),
          // },
        ),
        Pipelines.threshold(
          {
            type: 'falling-edge',
            threshold: liquidationWarningThreshold,
          },
          {
            messageBuilder: (value) =>
              `🚨 Danger! Your C-Ratio is ${value}%, and has dropped below the ${liquidationWarningThreshold}% liquidation threshold. You are now at risk of liquidation.`,
          },
          // Optionally turn on throttling, to limit to one message in a given time window.
          // {
          //   type: 'throttle-time',
          //   timeSpan: Duration.fromObject({ minutes: 1 }),
          // },
        ),
        Pipelines.threshold(
          {
            type: 'rising-edge',
            threshold: liquidationWarningThreshold,
          },
          {
            messageBuilder: (value) =>
            `Your C-Ratio has risen back above the ${liquidationWarningThreshold}% liquidation threshold, and is now ${value}%.`,
          },
          // Optionally turn on throttling, to limit to one message in a given time window.
          // {
          //   type: 'throttle-time',
          //   timeSpan: Duration.fromObject({ minutes: 5 }),
          // },
        ),
      ],
    })
    .dispatch('unicast')
    .build();

  jetMonitor.start();
}

run();
