import {
  EventDetectionPipeline,
  Operators,
  ParameterId,
  PipeLogLevel,
  setPipeLogLevel,
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

export const jetEventDetectionPipelines: Record<
  ParameterId,
  EventDetectionPipeline<number>[]
> = Object.fromEntries([
  [
    C_RATIO_PARAMETER_ID,
    [collateralizationRatioNotifications, collateralizationRatioWarnings],
  ],
]);
