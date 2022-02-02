import { BN } from '@project-serum/anchor';
import { PublicKey } from '@solana/web3.js';
import {
  JET_MARKET_ADDRESS_DEVNET,
  JetClient,
  JetObligation,
} from '@jet-lab/jet-engine';

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
  user: PublicKey,
  jetClient: JetClient,
) {
  const obligation = await JetObligation.load(
    jetClient,
    JET_MARKET_ADDRESS_DEVNET,
    user,
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
          .div(new BN(m.decimals))
          .toNumber(),
        borrowedUsd: position.loanBalance
          .muln(position.reserve.priceData.price || 1) // 1 to handle USDC
          .div(new BN(m.decimals))
          .toNumber(),
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
