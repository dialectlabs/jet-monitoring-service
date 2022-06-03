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
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN, Wallet } from '@project-serum/anchor';
import { AnchorProvider } from 'anchor-new';
import { Duration } from 'luxon';
import {
  JET_MARKET_ADDRESS_DEVNET,
  JET_MARKET_ADDRESS,
  JetClient,
  JetMarket,
  JetObligation,
  JetReserve,
} from '@jet-lab/jet-engine';

function getJetClient(): Promise<JetClient> {
  const jetConnection = new Connection(
    process.env.RPC_URL ?? 'https://api.devnet.solana.com',
    AnchorProvider.defaultOptions(),
  );
  const jetProvider = new AnchorProvider(
    jetConnection,
    new Wallet(Keypair.generate()),
    AnchorProvider.defaultOptions(),
  );
  let useDevnet: boolean = process.env.NETWORK_NAME?.includes("devnet") ? true : false;
  return JetClient.connect(jetProvider, useDevnet);
}

type UserObligation = {
  user: PublicKey;
  cratio: number;
};

const healthyThreshodl = 1.5;
const criticalThreshodl = 1.35;
const liquidationThreshodl = 1.25;

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
              limit: criticalThreshodl,
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
          message: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructUnhealthyWarningMessage(value);
          return {
            subject: '🛩 Jet-Protocol: ⚠️ Unhealthy Collateral-ratio',
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
          message: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructHealthyMessage(value);
          return {
            subject: '🛩 Jet-Protocol: ✅ Healthy Collateral-ratio',
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
          message: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructCriticalWarningMessage(value);
          return {
            subject: '🛩 Jet-Protocol: 🚨 Critical Collateral-ratio',
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
              limit: healthyThreshodl,
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
          message: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        ({ value }) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(value),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        ({ value }) => {
          const message = this.constructCriticalRecoveredMessage(value);
          return {
            subject: '🛩 Jet-Protocol: ⚠️ Unhealthy Collateral-ratio',
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
    const displayValue = (value * 100).toFixed(2);
    return `⚠️ Warning! Your current collateral-ratio is ${displayValue}%. It has dropped below the healthy threshold of ${healthyThreshodl * 100}%. Please monitor your borrowing and lending closely. Your deposited assets will start being liquidated at ${liquidationThreshodl * 100}%.`;
  }

  private constructHealthyMessage(value: number): string {
    const displayValue = (value * 100).toFixed(2);
    return `✅ Your current collateral-ratio is ${displayValue}% - Your account is healthy.`;
  }

  private constructCriticalWarningMessage(value: number): string {
    const displayValue = (value * 100).toFixed(2);
    return `🚨 Warning! Your current collateral-ratio is ${displayValue}%, which is below the critical threshold of ${criticalThreshodl * 100}%. Please deposit more assets or repay your loans. Your deposited assets will start being liquidated at ${liquidationThreshodl * 100}%.`;
  }

  private constructCriticalRecoveredMessage(value: number): string {
    const displayValue = (value * 100).toFixed(2);
    return `⚠️ Your current collateral-ratio is ${displayValue}%, which is just above the critical threshold of ${criticalThreshodl * 100}%. Jet recommends keeping your collateral-ratio above the healthy threshold of ${healthyThreshodl * 100}%.`;
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }

  private async getSubscribersObligations(
    subscribers: ResourceId[],
  ): Promise<SourceData<UserObligation>[]> {
    this.logger.log(`Polling obligations for ${subscribers.length} subscribers`);
    const jetClient = await getJetClient();
    const jetMarketAddress = jetClient.devnet === true ? JET_MARKET_ADDRESS_DEVNET : JET_MARKET_ADDRESS;
    const market = await JetMarket.load(jetClient, jetMarketAddress);
    const reserves = await JetReserve.loadMultiple(jetClient, market);
    this.logger.log(`Jet Client isDevnet:`, jetClient.devnet);
    console.log(jetClient.devnet);
    const data: Promise<SourceData<UserObligation>>[] = subscribers.map(
      async (resourceId) => {
        this.logger.log(`Loading obligation for subscriber ${resourceId.toBase58()}.`);
        const obligation = await JetObligation.load(
          jetClient,
          jetMarketAddress,
          reserves,
          resourceId,
        );
        this.logger.log(`Found obligation for subscriber ${resourceId.toBase58()}:`, obligation);
        console.log(obligation);
        this.logger.log("obligation.collateralRatio:");
        console.log(obligation.collateralRatio);
        const sourceData: SourceData<UserObligation> = {
          groupingKey: resourceId.toBase58(),
          data: {
            user: resourceId,
            cratio: obligation.collateralRatio,
          },
        };
        return sourceData;
      },
    );
    const datum = await Promise.all(data);
    return datum;
  }
}
