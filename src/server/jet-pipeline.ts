import {
  EventDetectionPipeline,
  Operators,
  ParameterId,
  PipeLogLevel,
  setPipeLogLevel,
  SubscriberEvent,
} from '@dialectlabs/monitor';
import { C_RATIO_PARAMETER_ID } from './jet-data-sources';

setPipeLogLevel(PipeLogLevel.INFO);

const liquidationWarningThreshold = 125; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation
const liquidationWarnings: EventDetectionPipeline<number> = (source) =>
  source
    .pipe(Operators.Utility.log(PipeLogLevel.INFO))
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.Window.fixedSize(5))
    .pipe(Operators.Aggregate.avg())
    .pipe(...Operators.Trigger.fallingEdge(liquidationWarningThreshold))
    .pipe(
      Operators.Event.warning(
        'C-ratio warning',
        (cRatio: number) =>
          `Your C-ratio ${cRatio}% is unhealthy. A portion of your collateral will is liquidated to maintain a healthy C-ratio, since it dropped below ${liquidationWarningThreshold}%.`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

const unhealthyCRatioWarningThreshold = 150; // based on https://docs.jetprotocol.io/jet-protocol/beginner-guides/understanding-c-ratio-and-liquidation
const unhealthyCRatioWarnings: EventDetectionPipeline<number> = (source) =>
  source
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.Window.fixedSize(5))
    .pipe(Operators.Aggregate.avg())
    .pipe(...Operators.Trigger.fallingEdge(unhealthyCRatioWarningThreshold))
    .pipe(
      Operators.Event.warning(
        'C-ratio warning',
        (cRatio: number) =>
          `Your C-ratio ${cRatio}% is unhealthy. A portion of your collateral will be liquidated to maintain a healthy C-ratio when it drops below ${liquidationWarningThreshold}%.`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

export const jetUnicastMonitorPipelines: Record<
  ParameterId,
  EventDetectionPipeline<number>[]
> = Object.fromEntries([
  [C_RATIO_PARAMETER_ID, [liquidationWarnings, unhealthyCRatioWarnings]],
]);

const welcomeMessagePipeline: EventDetectionPipeline<SubscriberEvent> = (
  source,
) =>
  source
    .pipe(
      Operators.Transform.filter(
        ({ parameterData: { data } }) => data === 'added',
      ),
    )
    .pipe(
      Operators.Event.info(
        'Welcome',
        () => `Thanks for subscribing for Jet Notifications (managed by Dialect). 
You'll receive notifications about your collateralization ratio & risk of liquidation warnings.`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

export const jetSubscriberStateMonitorPipelines: EventDetectionPipeline<SubscriberEvent>[] =
  [welcomeMessagePipeline];
