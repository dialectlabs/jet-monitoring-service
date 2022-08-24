import {
  Monitor,
  Monitors,
  Pipelines,
  ResourceId,
  SourceData,
  Data,
} from '@dialectlabs/monitor';
import {riskIndicatorMonitorMax, riskIndicatorMonitorMin, UserObligationV1_5} from '../src/jetv1-5-monitoring.service';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { BN, Wallet } from '@project-serum/anchor';
import { AnchorProvider } from 'anchor-new';
import { Duration } from 'luxon';
import { MarginAccount, MarginClient, PoolManager } from '@jet-lab/margin';
import '../src/shim';


const cluster = 'mainnet-beta';

  async function testGetSubscribersMarginAccountsV1_5(
    subscribers: ResourceId[],
  ) {

    // Load JetV2 margin pools
    const config = await MarginClient.getConfig(cluster)
    const connection = new Connection(process.env.RPC_URL ?? 'https://api.devnet.solana.com', 'recent')
    const options = AnchorProvider.defaultOptions()
    const wallet = new Wallet(Keypair.generate())
    const provider = new AnchorProvider(connection, wallet, options)
    const programs = MarginClient.getPrograms(provider, config)
    const poolManager = new PoolManager(programs, provider)
    const pools = await poolManager.loadAll()
    console.log(`Jet program.config.url: ${programs.config.url}`);
    //console.log(poolManager);
    //console.log(pools);

    subscribers.map(
        async (resourceId) => {
          console.log(`Fetching v1.5 marginAccount for subscriber ${resourceId.toBase58()}.`);

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
          console.log(marginAccounts);
          if (marginAccounts) {
            console.log(marginAccounts[0].riskIndicator);
          }
        },
      );
  }

// Note: Test Only
// (async () => {
//   await testGetSubscribersMarginAccountsV1_5([new PublicKey('CxzGSruD99TtND6WotPXSEKUVWHgqnzUB8ycA2EBd6SE')]);
// })()