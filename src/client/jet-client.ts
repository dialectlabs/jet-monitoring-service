import * as web3 from '@solana/web3.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@project-serum/anchor';
import {
  createDialect,
  deleteDialect,
  getDialectForMembers,
  idl,
  Member,
  programs,
  sleep,
  Wallet_,
} from '@dialectlabs/web3';
import { DialectAccount } from '@dialectlabs/web3/lib/es';

const JET_PUBLIC_KEY = process.env.JET_PUBLIC_KEY as string;
const USER_PRIVATE_KEY = process.env.USER_PRIVATE_KEY ? Keypair.fromSecretKey(
  new Uint8Array(JSON.parse(process.env.USER_PRIVATE_KEY as string)),
) : Keypair.generate();

const NETWORK_NAME = 'localnet';
const connection = new web3.Connection(
  programs[NETWORK_NAME].clusterAddress,
  'recent',
);

const createClients = async (): Promise<void> => {
  console.log(`Creating dialect client for user wallet ${USER_PRIVATE_KEY.publicKey.toBase58()} with target ${JET_PUBLIC_KEY}`);

  const clients = [USER_PRIVATE_KEY];
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

  let dialectAccountsByPk: Record<
    string,
    { owner: Keypair; dialectAccount: DialectAccount }
  > = Object.fromEntries(
    await Promise.all(
      clients.map(async (owner) => {
        const members: Member[] = [
          {
            publicKey: new PublicKey(JET_PUBLIC_KEY),
            scopes: [false, true],
          },
          {
            publicKey: owner.publicKey,
            scopes: [true, true],
          },
        ];
        const dialectAccount = await createDialect(program, owner, members);
        return [dialectAccount.publicKey.toString(), { owner, dialectAccount }];
      }),
    ),
  );

  process.on('SIGINT', async () => {
    const dialectAccounts = Object.values(dialectAccountsByPk);
    console.log(`Deleting dialects for ${dialectAccounts.length} clients`);
    await Promise.all(
      dialectAccounts.map(({ owner, dialectAccount }) =>
        deleteDialect(program, dialectAccount, owner),
      ),
    );
    console.log(`Deleted dialects for ${dialectAccounts.length} clients`);
    process.exit(0);
  });

  Object.values(dialectAccountsByPk).forEach(
    ({
      owner,
      dialectAccount: {
        dialect: { messages },
      },
    }) => {
      if (messages.length > 0) {
        console.log(
          `Got ${
            messages.length
          } new messages for '${owner.publicKey.toBase58()}: ${JSON.stringify(
            messages.map((it) => it.text),
          )}`,
        );
      }
    },
  );
  while (true) {
    const dialectAccounts = Object.values(dialectAccountsByPk);
    const dialectAccountsUpd: Record<
      string,
      { owner: Keypair; dialectAccount: DialectAccount }
    > = Object.fromEntries(
      await Promise.all(
        dialectAccounts.map(
          async ({
            owner,
            dialectAccount: {
              dialect: { members },
            },
          }) => {
            const dialectAccount = await getDialectForMembers(
              program,
              members,
              owner,
            );
            return [
              dialectAccount.publicKey.toString(),
              { owner, dialectAccount },
            ];
          },
        ),
      ),
    );
    Object.values(dialectAccountsUpd).forEach(
      ({ owner, dialectAccount: { publicKey, dialect: newDialect } }) => {
        const {
          dialectAccount: { dialect: oldDialect },
        } = dialectAccountsByPk[publicKey.toString()];
        const newMessages = newDialect.messages.filter(
          ({ timestamp }) => timestamp > oldDialect.lastMessageTimestamp,
        );
        if (newMessages.length > 0) {
          console.log(
            `Got ${
              newMessages.length
            } new messages for '${owner.publicKey.toBase58()}: ${JSON.stringify(
              newMessages.map((it) => it.text),
            )}`,
          );
        }
      },
    );
    dialectAccountsByPk = dialectAccountsUpd;
    await sleep(1000);
  }
};

const fundKeypairs = async (
  program: anchor.Program,
  keypairs: Keypair[],
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
  await createClients();
};

main();
