import { PublicKey } from '@solana/web3.js';
import {
  JET_MARKET_ADDRESS_DEVNET,
  JetClient,
  JetMarket,
  JetObligation,
  JetReserve,
  JetUser,
} from '@jet-lab/jet-engine';
import BN from 'bn.js';

export type Mint = {
  asset: 'USDC' | 'Solana' | 'Bitcoin' | 'Ether';
  publicKey: PublicKey;
  decimals: number;
};

export type MintPosition = {
  asset: 'USDC' | 'Solana' | 'Bitcoin' | 'Ether';
  publicKey: PublicKey;
  depositedUsd: number;
  borrowedUsd: number;
};

export async function getCollateralizationRatio(
  userPublicKey: PublicKey,
  jetClient: JetClient,
) {
  // Load devnet market data from RPC
  const market = await JetMarket.load(jetClient, JET_MARKET_ADDRESS_DEVNET);
  // Load all reserves
  const reserves = await JetReserve.loadMultiple(jetClient, market);
  // Load user data
  const user = await JetUser.load(jetClient, market, reserves, userPublicKey);
  // create obligation
  const obligation = JetObligation.create(
    market,
    user,
    reserves.map((reserve) => reserve.data),
  );

  // All these can be condensed to
  const userObligation = await JetObligation.load(
    jetClient,
    JET_MARKET_ADDRESS_DEVNET,
    reserves,
    userPublicKey,
  );

  const mints: Mint[] = [
    {
      asset: 'USDC',
      decimals: 1e6,
      publicKey: new PublicKey('DNmMghqjvHPuW7DLJkTF6QnTN3xgqDqL6VRXEQdF3KjK'),
    },
    {
      asset: 'Bitcoin',
      decimals: 1e6,
      publicKey: new PublicKey('5ym2kCTCcqCHutbQXnPdsGAGFMEVQBQzTQ1CPun9W5A5'),
    },
    {
      asset: 'Solana',
      decimals: 1e9,
      publicKey: new PublicKey('So11111111111111111111111111111111111111112'),
    },
    {
      asset: 'Ether',
      decimals: 1e6,
      publicKey: new PublicKey('AZU7JDGEKNrKS53FrLKBukvWzd6d9pFYnPmahTuYodSn'),
    },
  ];

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
        // .toNumber(),
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
