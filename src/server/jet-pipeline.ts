import { EventDetectionPipeline, ParameterId } from '@dialectlabs/monitor';
import { Operators, PipeLogLevel } from '@dialectlabs/monitor';
import { C_RATIO_PARAMETER_ID } from './jet-data-sources';
import { Duration } from 'luxon';

const collateralizationRatioNotifications: EventDetectionPipeline<number> = (
  source,
) =>
  source
    .pipe(
      Operators.Utility.log(
        PipeLogLevel.INFO,
        'Data for notifications pipeline',
      ),
    )
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.FlowControl.rateLimit(Duration.fromObject({ seconds: 20 })))
    .pipe(
      Operators.Event.info(
        'C-ratio info',
        (cRatio: number) => `Your c-ratio is: ${cRatio}`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO, 'Notification'));

const collateralizationRatioWarnings: EventDetectionPipeline<number> = (
  source,
) =>
  source
    .pipe(
      Operators.Utility.log(PipeLogLevel.INFO, 'Data for warnings pipeline'),
    )
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
    .pipe(Operators.Utility.log(PipeLogLevel.INFO, 'Warning'));

export const jetEventDetectionPipelines: Record<
  ParameterId,
  EventDetectionPipeline<number>[]
> = Object.fromEntries([
  [
    C_RATIO_PARAMETER_ID,
    [collateralizationRatioNotifications, collateralizationRatioWarnings],
  ],
]);
