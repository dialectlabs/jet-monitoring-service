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

export const mints: Mint[] = [
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
