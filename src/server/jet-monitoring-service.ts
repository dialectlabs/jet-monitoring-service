import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { idl, programs, Wallet_ } from '@dialectlabs/web3';
import { Monitors, ResourceId } from '@dialectlabs/monitor';
import { Idl, Program, Provider } from '@project-serum/anchor';
import { JetClient } from '@jet-lab/jet-engine';
import {
  jetSubscriberStateMonitorPipelines,
  jetUnicastMonitorPipelines,
} from './jet-pipeline';
import { FixedUserJetDataSource } from './jet-data-sources';
import { Duration } from 'luxon';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const jetKeypair: Keypair = Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(PRIVATE_KEY as string)),
);
const wallet = Wallet_.embedded(jetKeypair.secretKey);

function getJetUserToGetDataFrom(): ResourceId {
  return new PublicKey(
    'GY63HBKnGanRd1K3BFwY9aauPwm1nqdiXwSuuJmTDhyB', // some account w/ meaningful data
  );
}

function getDialectProgram(): Program {
  const dialectConnection = new Connection(
    process.env.RPC_URL || 'http://localhost:8899',
    'recent',
  );
  const dialectProvider = new Provider(
    dialectConnection,
    wallet,
    Provider.defaultOptions(),
  );
  return new Program(
    idl as Idl,
    new PublicKey(programs['localnet'].programAddress),
    dialectProvider,
  );
}

function getJetClient(): Promise<JetClient> {
  const jetConnection = new Connection(
    'https://api.devnet.solana.com',
    Provider.defaultOptions(),
  );
  const jetProvider = new Provider(
    jetConnection,
    wallet,
    Provider.defaultOptions(),
  );
  return JetClient.connect(jetProvider, true);
}

async function run() {
  const monitorFactory = Monitors.factory({
    dialectProgram: getDialectProgram(),
    monitorKeypair: jetKeypair,
  });

  const unicastMonitor = monitorFactory.createUnicastMonitor(
    new FixedUserJetDataSource(await getJetClient(), getJetUserToGetDataFrom()),
    jetUnicastMonitorPipelines,
    Duration.fromObject({ seconds: 20 }),
  );
  await unicastMonitor.start();

  const subscriberEventMonitor = monitorFactory.createSubscriberEventMonitor(
    jetSubscriberStateMonitorPipelines,
  );
  await subscriberEventMonitor.start();
}

run();
