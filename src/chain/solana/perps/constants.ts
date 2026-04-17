import { PublicKey } from '@solana/web3.js';

export const JUPITER_PERPETUALS_PROGRAM_ID = new PublicKey(
  'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu',
);

export const JLP_POOL_ACCOUNT_PUBKEY = new PublicKey(
  '5BUwFW4nRbftYTDMbgxykoFWqWHPzahFSNAaaaJtVKsq',
);

/** Custody accounts for each supported market token. */
export interface CustodyDetail {
  readonly name: string;
  readonly mint: PublicKey;
  readonly pythnetOracle: PublicKey;
  readonly dovesOracle: PublicKey;
  readonly chainlinkOracle: PublicKey;
  readonly dovesAgOracle: PublicKey;
  readonly tokenAccount: PublicKey;
}

export const CUSTODY_DETAILS: Readonly<Record<string, CustodyDetail>> = {
  // SOL
  '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz': {
    name: 'SOL',
    mint: new PublicKey('So11111111111111111111111111111111111111112'),
    pythnetOracle: new PublicKey('7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE'),
    dovesOracle: new PublicKey('39cWjvHrpHNz2SbXv6ME4NPhqBDBd4KsjUYv5JkHEAJU'),
    chainlinkOracle: new PublicKey('FWLXDDgW2Qm2VuX8MdV99VYpo6X1HLEykUjfAsjz2G78'),
    dovesAgOracle: new PublicKey('FYq2BWQ1V5P1WFBqr3qB2Kb5yHVvSv7upzKodgQE5zXh'),
    tokenAccount: new PublicKey('BUvduFTd2sWFagCunBPLupG8fBTJqweLw9DuhruNFSCm'),
  },
  // ETH
  AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn: {
    name: 'ETH',
    mint: new PublicKey('7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs'),
    pythnetOracle: new PublicKey('42amVS4KgzR9rA28tkVYqVXjq9Qa8dcZQMbH5EYFX6XC'),
    dovesOracle: new PublicKey('5URYohbPy32nxK1t3jAHVNfdWY2xTubHiFvLrE3VhXEp'),
    chainlinkOracle: new PublicKey('BNQzYvnidN8vVVn78xh6wgLo5ozmV8Dx8AE8rndqeLEe'),
    dovesAgOracle: new PublicKey('AFZnHPzy4mvVCffrVwhewHbFc93uTHvDSFrVH7GtfXF1'),
    tokenAccount: new PublicKey('Bgarxg65CEjN3kosjCW5Du3wEqvV3dpCGDR3a2HRQsYJ'),
  },
  // BTC
  '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm': {
    name: 'BTC',
    mint: new PublicKey('3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh'),
    pythnetOracle: new PublicKey('4cSM2e6rvbGQUFiJbqytoVMi5GgghSMr8LwVrT9VPSPo'),
    dovesOracle: new PublicKey('4HBbPx9QJdjJ7GUe6bsiJjGybvfpDhQMMPXP1UEa7VT5'),
    chainlinkOracle: new PublicKey('A6F8mvoM8Qc9wTaKjrD1B5Fgpp6NhPQyJLWXeafWrbsV'),
    dovesAgOracle: new PublicKey('hUqAT1KQ7eW1i6Csp9CXYtpPfSAvi835V7wKi5fRfmC'),
    tokenAccount: new PublicKey('FgpXg2J3TzSs7w3WGYYE7aWePdrxBVLCXSxmAKnCZNtZ'),
  },
  // USDC
  G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa: {
    name: 'USDC',
    mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
    pythnetOracle: new PublicKey('Dpw1EAVrSB1ibxiDQyTAW6Zip3J4Btk2x4SgApQCeFbX'),
    dovesOracle: new PublicKey('A28T5pKtscnhDo6C1Sz786Tup88aTjt8uyKewjVvPrGk'),
    chainlinkOracle: new PublicKey('3Z4gQ5ujXZSYeVyPhkakVcrmyMxhAk6VT2NYSVV3RGGU'),
    dovesAgOracle: new PublicKey('6Jp2xZUTWdDD2ZyUPRzeMdc6AFQ5K3pFgZxk2EijfjnM'),
    tokenAccount: new PublicKey('WzWUoCmtVv7eqAbU3BfKPU3fhLP6CXR8NCJH78UK9VS'),
  },
  // USDT
  '4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk': {
    name: 'USDT',
    mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
    pythnetOracle: new PublicKey('HT2PLQBcG5EiCcNSaMHAjSgd9F98ecpATbk4Sk5oYuM'),
    dovesOracle: new PublicKey('AGW7q2a3WxCzh5TB2Q6yNde1Nf41g3HLaaXdybz7cbBU'),
    chainlinkOracle: new PublicKey('5KQxzQ4xQGPUiJGYbujLjygm6Frin9zE5h996hxxfyqe'),
    dovesAgOracle: new PublicKey('Fgc93D641F8N2d1xLjQ4jmShuD3GE3BsCXA56KBQbF5u'),
    tokenAccount: new PublicKey('Gex24YznvguMad1mBzTQ7a64U1CJy59gvsStQmNnnwAd'),
  },
};

/** Map market base asset to custody pubkey. */
export const MARKET_TO_CUSTODY: Readonly<Record<string, string>> = {
  SOL: '7xS2gz2bTp3fwCC7knJvUWTEU9Tycczu6VhJYKgi1wdz',
  ETH: 'AQCGyheWPLeo6Qp9WpYS9m3Qj479t7R636N9ey1rEjEn',
  BTC: '5Pv3gM9JrFFH883SWAhvJC9RPYmo8UNxuFtv5bMMALkm',
};

/** USDC custody pubkey (used as collateral for short positions). */
export const USDC_CUSTODY = 'G18jKKXQwBbrHeiK3C9MRXhkHsLHf7XgCSisykV46EZa';

/** USDT custody pubkey. */
export const USDT_CUSTODY = '4vkNeXiYEUizLdrpdPS1eC2mccyM4NUPRtERrk6ZETkk';
