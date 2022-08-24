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
import { MarginAccount, MarginClient, PoolManager } from '@jet-lab/margin'

const cluster = process.env.NETWORK_NAME! as 'devnet' | 'mainnet-beta';

export type UserObligationV1_5 = {
  user: PublicKey;
  riskIndicator: number;
};

// Note: Jet v1.5 / v2 riskIndicator has different thresholds than v1 c-ratio
//Jet v2 risk indicator ranges from 0 to 1. 0 is zero risk and 1 is liquidation level. Collateral-ratio is deprecated. 
//Rik indicator is calculated as such: required collateral/effective collateral 
const warningThreshold = MarginAccount.RISK_WARNING_LEVEL;
const criticalThreshold = MarginAccount.RISK_CRITICAL_LEVEL;
const liquidationThreshold = MarginAccount.RISK_LIQUIDATION_LEVEL; //at 1, users will start getting liquidated
export const riskIndicatorMonitorMax = 1.5; // Note: this is to help filter extraneous data from Jet SDK
export const riskIndicatorMonitorMin = 0; // Note: this it to help filter extraneous data from jet SDK. At 0 could mean users have not deposited any collateral or have not borrowed any asset

@Injectable()
export class JetV1_5MonitoringService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JetV1_5MonitoringService.name);
  constructor(private readonly dialectConnection: DialectConnection) {}

  onModuleInit() {
    const monitor: Monitor<UserObligationV1_5> = Monitors.builder({
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
      .defineDataSource<UserObligationV1_5>()
      .poll(
        async (subscribers: ResourceId[]) =>
          this.getSubscribersMarginAccountsV1_5(subscribers),
        Duration.fromObject({ seconds: 60 }),
      )
      .transform<number, number>({
        keys: ['riskIndicator'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'rising-edge',
              threshold: warningThreshold,
              limit: criticalThreshold,
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
          message: `🛩 Jet-Protocol v1.5: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructUnhealthyWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructUnhealthyWarningMessage(ctx);
          return {
            subject: '🛩 Jet-Protocol v1.5: ⚠️ Unhealthy Risk Level',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['riskIndicator'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'falling-edge',
              threshold: warningThreshold,
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
          message: `🛩 Jet-Protocol v1.5: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructHealthyMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructHealthyMessage(ctx);
          return {
            subject: '🛩 Jet-Protocol v1.5: ✅ Healthy Risk Level',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['riskIndicator'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'rising-edge',
              threshold: criticalThreshold,
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
          message: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalWarningMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructCriticalWarningMessage(ctx);
          return {
            subject: '🛩 Jet-Protocol v1.5: 🚨 Critical Risk Level',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .also()
      .transform<number, number>({
        keys: ['riskIndicator'],
        pipelines: [
          Pipelines.threshold(
            {
              type: 'falling-edge',
              threshold: criticalThreshold,
              limit: warningThreshold,
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
          message: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .telegram(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: (ctx) => ctx.origin.user },
      )
      .sms(
        (ctx) => ({
          body: `🛩 Jet-Protocol v1.5: ` + this.constructCriticalRecoveredMessage(ctx),
        }),
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .email(
        (ctx) => {
          const message = this.constructCriticalRecoveredMessage(ctx);
          return {
            subject: '🛩 Jet-Protocol v1.5: ⚠️ Unhealthy Risk Level',
            text: message,
          };
        },
        { dispatch: 'unicast', to: ({ origin }) => origin.user },
      )
      .and()
      .build();

    monitor.start();
  }

  private constructUnhealthyWarningMessage(ctx: Data<number, UserObligationV1_5>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `⚠️ Warning! Your current risk-indicator is ${displayValue}%. It has gone above the healthy threshold of ${warningThreshold * 100}%. Please monitor your borrowing and lending closely. Your deposited assets will start being liquidated at ${liquidationThreshold * 100}%.`;
  }

  private constructHealthyMessage(ctx: Data<number, UserObligationV1_5>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `✅ Your current risk-indicator is ${displayValue}% - Your account is healthy.`;
  }

  private constructCriticalWarningMessage(ctx: Data<number, UserObligationV1_5>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `🚨 Warning! Your current risk-indicator is ${displayValue}%, which is above the critical threshold of ${criticalThreshold * 100}%. Please deposit more assets or repay your loans. Your deposited assets will start being liquidated at ${liquidationThreshold * 100}%.`;
  }

  private constructCriticalRecoveredMessage(ctx: Data<number, UserObligationV1_5>): string {
    console.log("Dispatching message with ctx:");
    console.log(`Context: `, ctx.context);
    console.log(`Value: `, ctx.value);
    const displayValue = (ctx.value * 100).toFixed(2);
    return `⚠️ Your current risk-indicator is ${displayValue}%, which is just below the critical threshold of ${criticalThreshold * 100}%. Jet recommends keeping your risk-indicator below the healthy threshold of ${warningThreshold * 100}%.`;
  }

  async onModuleDestroy() {
    await Monitors.shutdown();
  }

  private async getSubscribersMarginAccountsV1_5(
    subscribers: ResourceId[],
  ): Promise<SourceData<UserObligationV1_5>[]> {
    this.logger.log(`Polling v1.5 margin accounts for ${subscribers.length} subscribers`);

    // Load JetV2 margin pools
    const config = await MarginClient.getConfig(cluster);
    const connection = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', 'recent');
    const options = AnchorProvider.defaultOptions();
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(connection, wallet, options);
    const programs = MarginClient.getPrograms(provider, config);
    const poolManager = new PoolManager(programs, provider);
    const pools = await poolManager.loadAll();
    console.log(`Jet programs.config.url: ${programs.config.url}`);

    let userMarginAccountsPromises: Promise<UserObligationV1_5>[]  = subscribers.map(
        async (resourceId) => {
          this.logger.log(`Fetching v1.5 marginAccount for subscriber ${resourceId.toBase58()}.`);

          // Load user wallet tokens
          const walletTokens = await MarginAccount.loadTokens(poolManager.programs, resourceId.toBase58());
          // Load uer's margin accounts - v1.5 monitor, only one account will load
          // TODO: when upgrade to suport JetV2, users will be able to have multiple margin accounts
          //   we will need to use grouping key to track multiple accounts for same user
          const marginAccounts = await MarginAccount.loadAllByOwner({
              programs: poolManager.programs,
              provider: poolManager.provider,
              pools,
              walletTokens,
              owner: resourceId.toBase58(),
          });

          let riskIndicator = 0;
          // TODO revisit case where no margin account exists
          if (marginAccounts) {
            console.log(`Public key ${resourceId.toBase58()} risk indicator is ${marginAccounts[0].riskIndicator}`);
            this.logger.log(`Found marginAccount for subscriber ${resourceId.toBase58()}:`, marginAccounts);
            console.log(marginAccounts[0].riskIndicator);
            // NOTE: jet v2 program allows users to multiple margin accounts but in this v1.5 case, we only need to get the first one
            riskIndicator = marginAccounts[0].riskIndicator;
          }

          return {
            user: resourceId,
            riskIndicator: riskIndicator,
          } as UserObligationV1_5;
        },
      );

    let userMarginAccounts: UserObligationV1_5[] = await Promise.allSettled(userMarginAccountsPromises).then((results) => {
      let ret: UserObligationV1_5[] = [];
      results.forEach((result) => {
        if (result.status === 'rejected') {
          this.logger.error(`An error occurred while fetching a margin account from Jet SDK: `, result);
        } else if (result.status === 'fulfilled') {
          ret.push(result.value);
        } 
      });
      return ret;
    })
    console.log("userMarginAccounts before filter:", userMarginAccounts);

    // Only ever monitor data that is within a reasonable range of what a user would care about
    userMarginAccounts = userMarginAccounts.filter((it) => {
      return (it.riskIndicator > riskIndicatorMonitorMin && it.riskIndicator < riskIndicatorMonitorMax);
    });
    console.log("userMarginAccounts after filter:", userMarginAccounts);

    this.logger.log(`Found ${userMarginAccounts.length} subscribers with an margin accounts to monitor.`);
    console.log(userMarginAccounts);

    // TODO add some field for margin account name and update notif messages as well
    return userMarginAccounts.map((it) => {
      const sourceData: SourceData<UserObligationV1_5> = {
        groupingKey: it.user.toBase58(),
        data: {
          user: it.user,
          riskIndicator: it.riskIndicator,
        },
      };
      return sourceData;
    });
  }
}
