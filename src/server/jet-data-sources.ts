import { JetClient } from '@jet-lab/jet-engine';
import { getCollateralizationRatio } from './jet-api';
import {
  DataSourceMetadata,
  PollableDataSource,
  ResourceId,
  DataPackage,
  ResourceParameterData,
} from '@dialectlabs/monitor';
export const C_RATIO_PARAMETER_ID = 'Collateralization ratio';

const JET_DATASOURCE_METADATA: DataSourceMetadata = {
  id: 'Jet',
  parameters: [
    {
      id: C_RATIO_PARAMETER_ID,
      description:
        'The collateralization ratio is calculated as collateral value/loan value.',
    },
  ],
};

export class JetDataSources implements PollableDataSource<number> {
  constructor(private readonly jetClient: JetClient) {}

  async connect(): Promise<DataSourceMetadata> {
    return Promise.resolve(JET_DATASOURCE_METADATA);
  }

  disconnect(): Promise<void> {
    console.log('Jet data source disconnected');
    return Promise.resolve();
  }

  async extract(subscribers: ResourceId[]): Promise<DataPackage<number>> {
    console.log(`Extracting data for ${subscribers.length} subscribers`);
    return Promise.all(
      subscribers.flatMap(
        (resourceId): Promise<ResourceParameterData<number>>[] => {
          const collateralizationRatio = getCollateralizationRatio(
            resourceId,
            this.jetClient,
          );
          return [
            collateralizationRatio.then((cRatio) => ({
              resourceId,
              parameterData: {
                parameterId: C_RATIO_PARAMETER_ID,
                data: cRatio,
              },
            })),
          ];
        },
      ),
    );
  }
}

export class FixedUserJetDataSource implements PollableDataSource<number> {
  private readonly delegate: JetDataSources;

  constructor(
    jetClient: JetClient,
    private readonly userToGetDataFrom: ResourceId,
  ) {
    this.delegate = new JetDataSources(jetClient);
  }

  async connect(): Promise<DataSourceMetadata> {
    return this.delegate.connect();
  }

  disconnect(): Promise<void> {
    return this.delegate.disconnect();
  }

  async extract(subscribers: ResourceId[]): Promise<DataPackage<number>> {
    return this.delegate
      .extract(subscribers.map(() => this.userToGetDataFrom))
      .then((it) =>
        it.map((it, idx) => ({
          ...it,
          resourceId: subscribers[idx],
        })),
      );
  }
}
