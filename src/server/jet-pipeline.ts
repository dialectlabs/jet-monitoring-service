import {
  EventDetectionPipeline,
  Operators,
  ParameterId,
  PipeLogLevel,
  setPipeLogLevel,
  SubscriberEvent,
} from '@dialectlabs/monitor';
import { C_RATIO_PARAMETER_ID } from './jet-data-sources';
import { Duration } from 'luxon';

setPipeLogLevel(PipeLogLevel.INFO);

const collateralizationRatioNotifications: EventDetectionPipeline<number> = (
  source,
) =>
  source
    .pipe(Operators.Utility.log(PipeLogLevel.INFO))
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.FlowControl.rateLimit(Duration.fromObject({ seconds: 20 })))
    .pipe(
      Operators.Event.info(
        'C-ratio info',
        (cRatio: number) => `Your c-ratio is: ${cRatio}`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

const collateralizationRatioWarnings: EventDetectionPipeline<number> = (
  source,
) =>
  source
    .pipe(Operators.Utility.log(PipeLogLevel.INFO))
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.Window.fixedSize(3))
    .pipe(Operators.Aggregate.avg())
    .pipe(...Operators.Trigger.fallingEdge(20))
    .pipe(
      Operators.Event.info(
        'C-ratio warning',
        (cRatio: number) => `Your c-ratio is too low: ${cRatio}`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

export const jetUnicastMonitorPipelines: Record<
  ParameterId,
  EventDetectionPipeline<number>[]
> = Object.fromEntries([
  [
    C_RATIO_PARAMETER_ID,
    [collateralizationRatioNotifications, collateralizationRatioWarnings],
  ],
]);

const welcomeMessagePipeline: EventDetectionPipeline<SubscriberEvent> = (
  source,
) =>
  source
    .pipe(Operators.Utility.log(PipeLogLevel.INFO))
    .pipe(
      Operators.Transform.filter(
        ({ parameterData: { data } }) => data === 'added',
      ),
    )
    .pipe(
      Operators.Event.info(
        'Welcome',
        () => `Thanks for subscribing for Jet Notifications (managed by Dialect). 
You'll receive daily notifications about your collateralization ratio & risk of liquidation warnings.`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO));

export const jetSubscriberStateMonitorPipelines: EventDetectionPipeline<SubscriberEvent>[] =
  [welcomeMessagePipeline];
