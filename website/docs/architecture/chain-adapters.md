---
sidebar_position: 3
title: Chain Adapters
---

# Chain Adapters

OnlyFence uses a chain adapter pattern to support multiple blockchains. Each adapter implements a common interface, making the core code chain-agnostic.

## Interface

```typescript
interface ChainAdapter {
  chain: string;
  getBalance(address: string): Promise<BalanceResult>;
  getTokenPrice(token: string): Promise<PriceResult>;
  getSwapQuote(params: SwapParams): Promise<SwapQuote>;
  buildSwapTx(quote: SwapQuote): Promise<TransactionData>;
  simulateTx(txData: TransactionData): Promise<SimulationResult>;
  signAndSubmit(txData: TransactionData, signer: Signer): Promise<TxResult>;
}
```

## Sui Adapter

The Sui adapter is the current production adapter. It integrates with:

| Component | Provider |
|-----------|----------|
| **Swap routing** | 7K Aggregator (best price across Cetus, DeepBook, Bluefin, FlowX, Turbos) |
| **Lending** | AlphaLend SDK |
| **Price data** | LP Pro |
| **RPC** | Sui fullnode |
| **Key derivation** | Ed25519 via `m/44'/784'/0'/0'/0'` |

## Planned Adapters

| Chain | Key Derivation | DEX Integration |
|-------|---------------|-----------------|
| **EVM** (Ethereum, Base, Arbitrum) | secp256k1 `m/44'/60'/0'/0/0` | 1inch, 0x |
| **Solana** | Ed25519 `m/44'/501'/0'/0'` | Jupiter |

## Design Principles

All code outside `src/chain/` is chain-agnostic. This means:

- The policy engine, config system, CLI, TUI, and database work identically regardless of chain
- Adding a new chain requires implementing the `ChainAdapter` interface — no changes to core code
- Each adapter lives in its own directory under `src/chain/`

```
src/
  chain/
    sui/       # Sui adapter implementation
    evm/       # Future EVM adapter
    solana/    # Future Solana adapter
  core/        # Chain-agnostic pipeline
  policy/      # Chain-agnostic policy engine
  ...
```
