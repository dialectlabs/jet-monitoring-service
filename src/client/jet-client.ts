import * as web3 from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import { programs, sleep, Wallet_ } from '@dialectlabs/web3';
import { createDialect, deleteDialect, idl } from '@dialectlabs/web3';
import { Duration } from 'luxon';

const JET_PUBLIC_KEY = process.env.JET_PUBLIC_KEY as string;

const NETWORK_NAME = 'localnet';
const connection = new web3.Connection(
  programs[NETWORK_NAME].clusterAddress,
  'recent',
);

const createClients = async (n: number): Promise<void> => {
  const clients = Array(n)
    .fill(0)
    .map((it) => web3.Keypair.generate());
  const wallet = Wallet_.embedded(clients[0].secretKey);
  // configure anchor
  anchor.setProvider(
    new anchor.Provider(connection, wallet, anchor.Provider.defaultOptions()),
  );
  const program = new anchor.Program(
    idl as anchor.Idl,
    new anchor.web3.PublicKey(programs[NETWORK_NAME].programAddress),
  );

  await fundKeypairs(program, clients);

  clients.map(async (it) => {
    const dialect = await createDialect(program, it, [
      {
        publicKey: new PublicKey(JET_PUBLIC_KEY),
        scopes: [false, true],
      },
      {
        publicKey: it.publicKey,
        scopes: [true, true],
      },
    ]);
    process.on('SIGINT', async () => {
      console.log('Deleting dialect');
      deleteDialect(program, dialect, it);
    });
  });
  console.log(`Started ${n} jet clients`);

  await sleep(Duration.fromObject({ weeks: 1 }).toMillis());
};

const fundKeypairs = async (
  program: anchor.Program,
  keypairs: web3.Keypair[],
  amount: number | undefined = 10 * web3.LAMPORTS_PER_SOL,
): Promise<void> => {
  await Promise.all(
    keypairs.map(async (keypair) => {
      const fromAirdropSignature =
        await program.provider.connection.requestAirdrop(
          keypair.publicKey,
          amount,
        );
      await program.provider.connection.confirmTransaction(
        fromAirdropSignature,
      );
    }),
  );
};

const main = async (): Promise<void> => {
  await createClients(1);
};

main();
