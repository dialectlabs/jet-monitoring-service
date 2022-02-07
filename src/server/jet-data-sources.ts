import {
  JET_MARKET_ADDRESS_DEVNET,
  JetClient,
  JetMarket,
  JetObligation,
  JetReserve,
} from '@jet-lab/jet-engine';
import {
  DataPackage,
  DataSourceMetadata,
  PollableDataSource,
  ResourceId,
} from '@dialectlabs/monitor';
import BN from 'bn.js';
import { MintPosition, mints } from './jet-api';

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

export class JetDataSource implements PollableDataSource<number> {
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
    // Load devnet market data from RPC
    const market = await JetMarket.load(
      this.jetClient,
      JET_MARKET_ADDRESS_DEVNET,
    );
    // Load all reserves
    const reserves = await JetReserve.loadMultiple(this.jetClient, market);

    const values = subscribers.flatMap(async (resourceId) => {
      const obligation = await JetObligation.load(
        this.jetClient,
        JET_MARKET_ADDRESS_DEVNET,
        reserves,
        resourceId,
      );
      return [
        {
          resourceId,
          parameterData: {
            parameterId: C_RATIO_PARAMETER_ID,
            data: this.getCratio(obligation),
          },
        },
      ];
    });
    return Promise.all(values).then((it) => it.flat());
  }

  private getCratio(obligation: JetObligation) {
    const positions: (MintPosition | undefined)[] = mints.map((m) => {
      const position = obligation.positions.find((p) =>
        p.reserve.tokenMint.equals(m.publicKey),
      );
      return (
        position && {
          ...m,
          depositedUsd: position.collateralBalance
            .muln(position.reserve.priceData.price || 1) // 1 to handle USDC
            .divb(new BN(m.decimals))
            .lamports.toNumber(),
          borrowedUsd: position.loanBalance
            .muln(position.reserve.priceData.price || 1) // 1 to handle USDC
            .divb(new BN(m.decimals))
            .lamports.toNumber(),
        }
      );
    });
    const totalDepositedUsd = positions
      .filter((it) => it)
      .reduce((acc, next) => acc + next!.depositedUsd, 0);
    const totalBorrowedUsd = positions
      .filter((it) => it)
      .reduce((acc, next) => acc + next!.borrowedUsd, 0);
    return totalBorrowedUsd === 0
      ? 0
      : Math.round((totalDepositedUsd / totalBorrowedUsd) * 100);
  }
}

export class FixedUserJetDataSource implements PollableDataSource<number> {
  private readonly delegate: JetDataSource;

  constructor(
    jetClient: JetClient,
    private readonly userToGetDataFrom: ResourceId,
  ) {
    this.delegate = new JetDataSource(jetClient);
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
