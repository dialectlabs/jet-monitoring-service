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
  Data,
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
  JetUserData,
  JetUser,
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
const cratioMonitorMax = 2.5; // Note: this is to help filter extraneous data from Jet SDK
const cratioMonitorMin = 1; // Note: this it to help filter extraneous data from jet SDK

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
        Duration.fromObject({ seconds: 300 }),
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
        (ctx) => ({
          message: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructUnhealthyWarningMessage(ctx);
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
        (ctx) => ({
          message: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructHealthyMessage(ctx);
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
        (ctx) => ({
          message: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructCriticalWarningMessage(ctx);
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
        (ctx) => ({
          message: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: (ctx) => ctx.origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructCriticalRecoveredMessage(ctx);
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

  private constructUnhealthyWarningMessage(ctx: Data<number, UserObligation>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `⚠️ Warning! Your current collateral-ratio is ${displayValue}%. It has dropped below the healthy threshold of ${healthyThreshodl * 100}%. Please monitor your borrowing and lending closely. Your deposited assets will start being liquidated at ${liquidationThreshodl * 100}%.`;
  }

  private constructHealthyMessage(ctx: Data<number, UserObligation>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `✅ Your current collateral-ratio is ${displayValue}% - Your account is healthy.`;
  }

  private constructCriticalWarningMessage(ctx: Data<number, UserObligation>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `🚨 Warning! Your current collateral-ratio is ${displayValue}%, which is below the critical threshold of ${criticalThreshodl * 100}%. Please deposit more assets or repay your loans. Your deposited assets will start being liquidated at ${liquidationThreshodl * 100}%.`;
  }

  private constructCriticalRecoveredMessage(ctx: Data<number, UserObligation>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
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
    let data: Promise<SourceData<UserObligation>>[] = [];
    
    subscribers.map(
      async (resourceId) => {
        this.logger.log(`Loading obligation for subscriber ${resourceId.toBase58()}.`);
        // Note: JetObligation.load() is a wrapper or create() that also loads market and reserves again
        //       We instead directly use JetUser.load() and use create() to reduce RPC calls
        const user = await JetUser.load(jetClient, market, reserves, resourceId)
        // create obligation
        const obligation = JetObligation.create(
          market,
          user,
          reserves.map(reserve => reserve.data)
        )
        this.logger.log(`Found obligation for subscriber ${resourceId.toBase58()}:`, obligation);
        console.log(obligation);
        const obCratio = obligation.collateralRatio;
        this.logger.log("obligation.collateralRatio:", obCratio);

        // Only ever monitor data that is within a reasonable range of what a user would care about
        if (obCratio > cratioMonitorMin && obCratio < cratioMonitorMax) {
          const sourceData: SourceData<UserObligation> = {
            groupingKey: resourceId.toBase58(),
            data: {
              user: resourceId,
              cratio: obCratio,
            },
          };
          data.push(Promise.resolve(sourceData));
        } else {
          this.logger.log("Seemingly extraneous data returned from Jet SDK, obligation.collateralRatio:", obCratio);
          this.logger.log("^^^ Will not include in monitor pipeline.");
        }
      },
    );

    const datum = await Promise.all(data);
    return datum;
  }
}
