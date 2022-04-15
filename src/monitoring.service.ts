import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Monitor, Monitors, Pipelines, ResourceId, SourceData, Data } from '@dialectlabs/monitor';
import { DialectConnection } from './dialect-connection';
import { clusterApiUrl, Connection, Keypair, PublicKey, } from '@solana/web3.js';
import { Provider, Idl, Program, BN, IdlTypes, Wallet } from '@project-serum/anchor';
import { Wallet_ } from '@dialectlabs/web3';
import { Duration } from 'luxon';
import {
  JET_MARKET_ADDRESS_DEVNET,
  JetClient,
  JetMarket,
  JetObligation,
  JetReserve,
} from '@jet-lab/jet-engine';
import { MintPosition, mints } from './jet-api';

// TODO env variables
const devnet = clusterApiUrl("devnet");
const MAINNET_RPC_URL = 'https://solana-api.syndica.io/access-token/6sW38nSZ1Qm4WVRN4Vnbjb9EF2QudlpGZBToMtPyqoXqkIenDwJ5FVK1HdWSqqah/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const jetKeypair: Keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
);
const wallet = Wallet_.embedded(jetKeypair.secretKey);
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

type DataType = {
cratio: number;
};

// TODO update, these latest from Eric at Jet 04/14/22
// 140 - warning
// 125 - partial liquidation can happen
const unhealthyCRatioWarningThreshold = 150; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation
const liquidationWarningThreshold = 125; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation

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

@Injectable()
export class MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MonitoringService.name);
  constructor(private readonly dialectConnection: DialectConnection) {}

  onModuleInit() {
    const monitor: Monitor<DataType> = Monitors.builder({
      dialectProgram: this.dialectConnection.getProgram(),
      monitorKeypair: this.dialectConnection.getKeypair(),
    })
      .defineDataSource<DataType>()
      .poll(async (subscribers: ResourceId[]) => {
        console.log(`Polling data for ${subscribers.length} subscribers`);
        const jetClient = await getJetClient();
        const market = await JetMarket.load(jetClient, JET_MARKET_ADDRESS_DEVNET);
        const reserves = await JetReserve.loadMultiple(jetClient, market);
        const data: Promise<SourceData<DataType>>[] = subscribers.map(
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
        const datum = await Promise.all(data);
        return datum;
      }, Duration.fromObject({ seconds: 5 }))
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
                type: 'falling-edge',
                threshold: unhealthyCRatioWarningThreshold,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(({ value }) => ({
        message: `⚠️ Warning! Your cratio is ${value}%. It has dropped below the ${unhealthyCRatioWarningThreshold}% threshold and is now considered unhealthy. If it drops any further, you may soon be at risk of liquidation.`,
      }))
      .and()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
                type: 'rising-edge',
                threshold: unhealthyCRatioWarningThreshold,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(({ value }) => ({
        message: `✅ Your C-Ratio has risen back above the ${unhealthyCRatioWarningThreshold}% unhealthy threshold, and is now ${value}%.`,
      }))
      .and()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
                type: 'falling-edge',
                threshold: liquidationWarningThreshold,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(({ value }) => ({
        message: `Your C-Ratio has risen back above the ${liquidationWarningThreshold}% liquidation threshold, and is now ${value}%.`,
      }))
      .and()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
                type: 'rising-edge',
                threshold: liquidationWarningThreshold,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(({ value }) => ({
        message: `Your C-Ratio has risen back above the ${liquidationWarningThreshold}% liquidation threshold, and is now ${value}%.`,
      }))
      .and()
      .dispatch('unicast')
      .build();
    
    monitor.start();
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }
}
