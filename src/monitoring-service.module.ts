import { Module } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { JetV1_5MonitoringService } from './jetv1-5-monitoring.service';
import { DialectConnection } from './dialect-connection';

@Module({
  imports: [],
  controllers: [],
  providers: [
    {
      provide: DialectConnection,
      useValue: DialectConnection.initialize(),
    },
    MonitoringService,
    JetV1_5MonitoringService,
  ],
})
export class MonitoringServiceModule {}
