import { EventDetectionPipeline, ParameterId } from '@dialectlabs/monitor';
import { Operators, PipeLogLevel } from '@dialectlabs/monitor';
import { C_RATIO_PARAMETER_ID } from './jet-data-sources';
import { Duration } from 'luxon';

const collateralizationRatioNotifications: EventDetectionPipeline<number> = (
  source,
) =>
  source
    .pipe(Operators.Utility.log(PipeLogLevel.INFO, 'Test'))
    .pipe(Operators.Transform.getRaw())
    .pipe(Operators.FlowControl.rateLimit(Duration.fromObject({ seconds: 20 })))
    .pipe(
      Operators.Event.info(
        'C-ratio info',
        (cRatio: number) => `Your c-ratio is: ${cRatio}`,
      ),
    )
    .pipe(Operators.Utility.log(PipeLogLevel.INFO, 'Event'));

export const jetEventDetectionPipelines: Record<
  ParameterId,
  EventDetectionPipeline<number>
> = Object.fromEntries([
  [C_RATIO_PARAMETER_ID, collateralizationRatioNotifications],
]);
