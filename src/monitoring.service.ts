import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  Monitor,
  Monitors,
  Pipelines,
  ResourceId,
  SourceData,
} from '@dialectlabs/monitor';
import { DialectConnection } from './dialect-connection';
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  Provider,
  BN,
  Wallet,
} from '@project-serum/anchor';
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
const devnet = clusterApiUrl('devnet');
const MAINNET_RPC_URL =
  'https://solana-api.syndica.io/access-token/6sW38nSZ1Qm4WVRN4Vnbjb9EF2QudlpGZBToMtPyqoXqkIenDwJ5FVK1HdWSqqah/rpc';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const jetKeypair: Keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
);
const wallet = new Wallet(jetKeypair);
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

type UserObligation = {
  user: PublicKey;
  cratio: number;
};

const healthyThreshodl = 150;
const criticalThreshodl = 135;
const liquidationThreshodl = 125;

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
    const monitor: Monitor<UserObligation> = Monitors.builder({
      dialectProgram: this.dialectConnection.getProgram(),
      monitorKeypair: this.dialectConnection.getKeypair(),
      sinks: {
        sms: {
          twilioUsername: process.env.TWILIO_ACCOUNT_SID!,
          twilioPassword: process.env.TWILIO_AUTH_TOKEN!,
          senderSmsNumber: process.env.TWILIO_SMS_SENDER!,
        },
        email: {
          apiToken: process.env.SENDGRID_KEY!,
          senderEmail: process.env.SENDGRID_EMAIL!,
        },
        telegram: {
          telegramBotToken: process.env.TELEGRAM_TOKEN!,
        },
      },
      web2SubscriberRepositoryUrl: process.env.WEB2_SUBSCRIBER_SERVICE_BASE_URL,
    })
      .defineDataSource<UserObligation>()
      .poll(
        async (subscribers: ResourceId[]) =>
          this.getSubscribersObligations(subscribers),
        Duration.fromObject({ seconds: 5 }),
      )
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'falling-edge',
              threshold: healthyThreshodl,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(
        ({ value }) => ({
          message: this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructUnhealthyWarningMessage(value);
          return {
            subject: 'Jet-Protocol: ⚠️ Unhealthy Collateral-ratio',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'rising-edge',
              threshold: healthyThreshodl,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(
        ({ value }) => ({
          message: this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructHealthyMessage(value);
          return {
            subject: 'Jet-Protocol: ✅ Healthy Collateral-ratio',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'falling-edge',
              threshold: criticalThreshodl,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(
        ({ value }) => ({
          message: this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructCriticalWarningMessage(value);
          return {
            subject: 'Jet-Protocol: 🚨 Critical Collateral-ratio',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['cratio'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'rising-edge',
              threshold: criticalThreshodl,
            },
            {
              type: 'throttle-time',
              timeSpan: Duration.fromObject({ minutes: 5 }),
            },
          ),
        ],
      })
      .notify()
      .dialectThread(
        ({ value }) => ({
          message: this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructCriticalRecoveredMessage(value);
          return {
            subject: 'Jet-Protocol: ⚠️ Unhealthy Collateral-ratio',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .and()
      .build();

    monitor.start();
  }

  private constructUnhealthyWarningMessage(value: number): string {
    return `Jet-Protocol: ⚠️ Warning! Your current collateral-ratio is ${value}%. It has dropped below the healthy threshold of ${healthyThreshodl}%. Please monitor your borrowing and lending closely. Your deposited assets will start being liquidated at ${liquidationThreshodl}%.`
  }

  private constructHealthyMessage(value: number): string {
    return `Jet-Protocol: ✅ Your current collateral-ratio is ${value}% - Your account is healthy.`;
  }

  private constructCriticalWarningMessage(value: number): string {
    return `Jet-Protocol: 🚨 Warning! Your current collateral-ratio is ${value}%, which is below the critical threshold of ${criticalThreshodl}%. Please deposit more assets or repay your loans. Your deposited assets will start being liquidated at ${liquidationThreshodl}%.`;
  }

  private constructCriticalRecoveredMessage(value: number): string {
    return `Jet-Protocol: ⚠️ Your current collateral-ratio is ${value}%, which is just above the critical threshold of ${criticalThreshodl}%. Jet recommends keeping your collateral-ratio above the healthy threshold of ${healthyThreshodl}%.`;
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }

  private async getSubscribersObligations(
    subscribers: ResourceId[],
  ): Promise<SourceData<UserObligation>[]> {
    console.log(`Polling data for ${subscribers.length} subscribers`);
    const jetClient = await getJetClient();
    const market = await JetMarket.load(jetClient, JET_MARKET_ADDRESS_DEVNET);
    const reserves = await JetReserve.loadMultiple(jetClient, market);
    const data: Promise<SourceData<UserObligation>>[] = subscribers.map(
      async (resourceId) => {
        const obligation = await JetObligation.load(
          jetClient,
          JET_MARKET_ADDRESS_DEVNET,
          reserves,
          resourceId,
        );
        const cratio = getCratio(obligation);
        const sourceData: SourceData<UserObligation> = {
          groupingKey: resourceId.toBase58(),
          data: {
            user: resourceId,
            cratio: cratio,
          },
        };
        return sourceData;
      },
    );
    const datum = await Promise.all(data);
    return datum;
  }
}
