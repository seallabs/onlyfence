# OnlyFence — Technical Specification

**Version 3.1 | March 2026**
**Audience: Engineering Team**

---

## 1. System Overview

```mermaid
graph TB
    subgraph Agent["🤖 Agent Layer"]
        OC[OpenClaw / Custom Bot]
    end

    subgraph CLI["📦 OnlyFence CLI - Single Process"]
        direction TB
        CMD[Command Parser]
        PE["Policy Engine\n(Extensible Check Pipeline)"]
        TL[(SQLite: Trade Log)]
        CFG[/"TOML Config"/]
        KS["🔐 Encrypted Keystore"]
        ORC[Oracle Client\nSingle source MVP]
        CA[Chain Adapter Interface]
        TUI[Interactive TUI]
    end

    subgraph Adapters["Chain Adapters"]
        SUI[Sui Adapter\n7K Aggregator]
        EVM[EVM Adapter\nPost-MVP]
        SVM[SVM Adapter\nPost-MVP]
    end

    subgraph External["External Services"]
        RPC_SUI[Sui RPC]
        RPC_EVM[EVM RPC]
        RPC_SOL[Solana RPC]
        ORACLE[Price Oracle\nSingle source MVP]
        AGG[7K Aggregator API]
    end

    OC -->|"fence swap SUI USDC 100"| CMD
    TUI -->|"human config"| CFG

    CMD --> PE
    PE -->|"read rules"| CFG
    PE -->|"read/write state"| TL
    PE -->|"USD resolve"| ORC
    ORC --> ORACLE

    PE -->|"approved"| CA
    CA --> SUI
    CA -.-> EVM
    CA -.-> SVM

    SUI --> AGG
    SUI --> RPC_SUI
    EVM -.-> RPC_EVM
    SVM -.-> RPC_SOL

    CA -->|"sign tx"| KS

    style CLI fill:#1a2332,stroke:#2E86C1,stroke-width:2px,color:#fff
    style Agent fill:#1c2d1c,stroke:#27AE60,stroke-width:2px,color:#fff
    style Adapters fill:#2d2a1c,stroke:#D4AC0D,stroke-width:2px,color:#fff
    style External fill:#2d1c1c,stroke:#7F8C8D,stroke-width:1px,color:#fff
```



---

## 2. Policy Engine — Extensible Pipeline

The policy engine is the core differentiator of OnlyFence. It runs as a **pipeline of independent check functions** in sequence. MVP ships with 2 checks. The interface is designed so every future guardrail drops in as a new check without modifying existing code.

### 2.1 Check Interface and Registry

```mermaid
classDiagram
    class PolicyCheck {
        <<interface>>
        +name: string
        +description: string
        +evaluate(intent: TradeIntent, ctx: PolicyContext) CheckResult
    }

    class CheckResult {
        +status: pass or reject
        +reason?: string
        +detail?: string
        +metadata?: Record
    }

    class TradeIntent {
        +chain: string
        +action: string
        +fromToken: string
        +toToken: string
        +amount: bigint
        +protocol?: string
        +pool?: string
        +walletAddress: string
    }

    class PolicyContext {
        +config: ChainPolicyConfig
        +db: SQLiteDatabase
        +oracle: OracleClient
        +tradeValueUsd?: number
    }

    class TokenAllowlistCheck {
        +name = token_allowlist
        +evaluate(intent, ctx) CheckResult
    }

    class SpendingLimitCheck {
        +name = spending_limit
        +evaluate(intent, ctx) CheckResult
    }

    class TokenDenylistCheck {
        +name = token_denylist
    }

    class ProtocolAllowlistCheck {
        +name = protocol_allowlist
    }

    class PoolDenylistCheck {
        +name = pool_denylist
    }

    class CircuitBreakerCheck {
        +name = circuit_breaker
    }

    class FrequencyLimitCheck {
        +name = frequency_limit
    }

    class CostBasisPnLCheck {
        +name = cost_basis_pnl
    }

    class ApprovalGateCheck {
        +name = approval_gate
    }

    PolicyCheck <|.. TokenAllowlistCheck : MVP
    PolicyCheck <|.. SpendingLimitCheck : MVP
    PolicyCheck <|.. TokenDenylistCheck : Post-MVP
    PolicyCheck <|.. ProtocolAllowlistCheck : Post-MVP
    PolicyCheck <|.. PoolDenylistCheck : Post-MVP
    PolicyCheck <|.. CircuitBreakerCheck : Post-MVP
    PolicyCheck <|.. FrequencyLimitCheck : Post-MVP
    PolicyCheck <|.. CostBasisPnLCheck : Post-MVP
    PolicyCheck <|.. ApprovalGateCheck : Post-MVP
```



### 2.2 Pipeline Growth Path

```mermaid
flowchart LR
    subgraph MVP["MVP - 2 checks"]
        direction LR
        C1["① Token\nAllowlist"] --> C2["② Spending\nLimit"]
    end

    subgraph V2["Release 2"]
        direction LR
        D1["① Token\nAllowlist"] --> D1b["② Token\nDenylist"] --> D2["③ Protocol\nAllowlist"] --> D3["④ Pool\nDenylist"] --> D4["⑤ Spending\nLimit"]
    end

    subgraph V3["Release 3"]
        direction LR
        E4["①-⑤"] --> E5["⑥ Circuit\nBreaker"] --> E6["⑦ Frequency\nLimit"]
    end

    subgraph V4["Release 4+"]
        direction LR
        F1["①-⑦"] --> F8["⑧ Cost-Basis\nP&L"] --> F9["⑨ Approval\nGate"]
    end

    MVP -.->|"add checks"| V2
    V2 -.->|"add checks"| V3
    V3 -.->|"add checks"| V4

    style MVP fill:#1c2d1c,stroke:#27AE60,color:#fff
    style V2 fill:#1a2332,stroke:#2E86C1,color:#fff
    style V3 fill:#1a2332,stroke:#2E86C1,color:#fff
    style V4 fill:#2d2a1c,stroke:#D4AC0D,color:#fff
```



### 2.3 Config-Driven Check Loading

Checks are registered based on which config sections exist. No config section = check not loaded.

```mermaid
graph TD
    subgraph Registry["PolicyCheckRegistry"]
        REG["checks: PolicyCheck array"]
        ADD["register check"]
        RUN["evaluateAll intent, ctx returns CheckResult"]
    end

    subgraph LoadChecks["On CLI startup"]
        L1["Read config.toml"] --> L2{"Which sections\nexist?"}
        L2 -->|"allowlist.tokens exists"| R1["register TokenAllowlistCheck"]
        L2 -->|"limits section exists"| R2["register SpendingLimitCheck"]
        L2 -->|"denylist.tokens exists"| R3["register TokenDenylistCheck\n(when implemented)"]
        L2 -->|"circuit_breaker exists"| R4["register CircuitBreakerCheck\n(when implemented)"]
    end

    R1 --> ADD
    R2 --> ADD
    R3 -.-> ADD
    R4 -.-> ADD

    style Registry fill:#1a2332,stroke:#2E86C1,color:#fff
    style LoadChecks fill:#1c2d1c,stroke:#27AE60,color:#fff
```



Adding a new guardrail type requires: (1) implement PolicyCheck interface — one file, (2) define config schema — one TOML section, (3) register in loader — one line. Zero changes to existing checks or pipeline logic.

---

## 3. Trade Execution Flow — MVP

```mermaid
sequenceDiagram
    participant Agent
    participant CMD as Command Parser
    participant PE as Policy Engine
    participant ORC as Oracle
    participant DB as SQLite
    participant CA as Chain Adapter
    participant AGG as 7K Aggregator
    participant RPC as Sui RPC
    participant KS as Keystore

    Agent->>CMD: fence swap SUI USDC 100 --slippage 0.5%
    CMD->>PE: TradeIntent from SUI to USDC amount 100 chain sui

    rect rgb(30, 40, 55)
        Note over PE,DB: Policy Pipeline — 2 checks
        PE->>PE: ① Token allowlist: SUI in tokens? USDC in tokens?
        alt Token not allowed
            PE-->>Agent: REJECT token not in allowlist
        end
        PE->>ORC: ② GET SUI/USD price
        ORC-->>PE: $0.98
        Note over PE: trade_value = 100 x $0.98 = $98
        PE->>PE: max_single_trade: $98 le $200 pass
        PE->>DB: SELECT SUM value_usd FROM trades WHERE chain sui AND ts gt now minus 24h
        DB-->>PE: $312.60
        Note over PE: $312.60 + $98 = $410.60 le $500 pass
    end

    PE->>CA: APPROVED
    CA->>AGG: GET quote SUI to USDC 100 slippage 0.5%
    AGG-->>CA: route expectedOutput 98.12

    CA->>RPC: dryRunTransactionBlock txData
    alt Simulation fails
        CA-->>Agent: REJECT simulation failed
    end

    CA->>KS: sign txData
    KS-->>CA: signedTx
    CA->>RPC: executeTransactionBlock signedTx
    RPC-->>CA: txDigest 8Hk4...mW2p

    rect rgb(25, 45, 30)
        Note over CA,DB: Post-Trade Logging
        CA->>DB: INSERT INTO trades chain tokens amounts value_usd tx_digest gas timestamp
        Note over CA: value_usd from pre-trade oracle price in step ②
    end

    CA-->>Agent: SUCCESS txDigest 8Hk4...mW2p amountIn 100 amountOut 98.12 gas 0.0021
```



---

## 4. **Policy Decision Tree — MVP**

```mermaid
flowchart TD
    START([Trade Intent]) --> TOK{① Token allowlist\nfrom AND to tokens\nin allowlist?}
    TOK -->|No| R1[REJECT\nToken not allowed]
    TOK -->|Yes| PRICE[Fetch USD price\nfrom oracle]
    PRICE --> SINGLE{② Spending limit\ntrade value usd\nle max single trade?}
    SINGLE -->|No| R2[REJECT\nExceeds single trade limit]
    SINGLE -->|Yes| VOL{② Spending limit\nrolling 24h + trade\nle max 24h volume?}
    VOL -->|No| R3[REJECT\nExceeds 24h volume]
    VOL -->|Yes| APPROVE[APPROVED]

    APPROVE --> QUOTE[Get swap quote\nfrom 7K Aggregator]
    QUOTE --> SIM{Dry-run\nsimulation OK?}
    SIM -->|No| R4[REJECT\nSimulation failed]
    SIM -->|Yes| SIGN[Sign and Submit]
    SIGN --> LOG[Log trade to SQLite]
    LOG --> DONE([Return JSON to agent])

    style START fill:#2E86C1,color:#fff
    style APPROVE fill:#27AE60,color:#fff
    style DONE fill:#2E86C1,color:#fff
    style R1 fill:#922B21,color:#fff
    style R2 fill:#922B21,color:#fff
    style R3 fill:#922B21,color:#fff
    style R4 fill:#922B21,color:#fff
```



### Future Decision Tree — Full Guardrail Suite

```mermaid
flowchart TD
    START([Trade Intent]) --> TOK_A{① Token\nallowlist}
    TOK_A -->|Fail| R1[REJECT]
    TOK_A -->|Pass| TOK_D{② Token\ndenylist}
    TOK_D -->|Fail| R2[REJECT]
    TOK_D -->|Pass| PROTO{③ Protocol\nallowlist}
    PROTO -->|Fail| R3[REJECT]
    PROTO -->|Pass| POOL_D{④ Pool\ndenylist}
    POOL_D -->|Fail| R4[REJECT]
    POOL_D -->|Pass| SPEND{⑤ Spending\nlimit}
    SPEND -->|Fail| R5[REJECT]
    SPEND -->|Pass| CB{⑥ Circuit\nbreaker}
    CB -->|Halted| R6[REJECT]
    CB -->|Active| FREQ{⑦ Frequency\nlimit}
    FREQ -->|Fail| R7[REJECT]
    FREQ -->|Pass| PNL{⑧ P&L\ncheck}
    PNL -->|Fail| R8[REJECT]
    PNL -->|Pass| APPROVAL{⑨ Approval\ngate}
    APPROVAL -->|Pending| R9[PENDING]
    APPROVAL -->|Pass| OK[APPROVED]

    style START fill:#2E86C1,color:#fff
    style OK fill:#27AE60,color:#fff
    style R1 fill:#922B21,color:#fff
    style R2 fill:#922B21,color:#fff
    style R3 fill:#922B21,color:#fff
    style R4 fill:#922B21,color:#fff
    style R5 fill:#922B21,color:#fff
    style R6 fill:#922B21,color:#fff
    style R7 fill:#922B21,color:#fff
    style R8 fill:#922B21,color:#fff
    style R9 fill:#D4AC0D,color:#000
```



---

## 5. Data Model — SQLite

```mermaid
erDiagram
    WALLETS {
        int id PK
        string chain "sui or evm or solana"
        string address
        string derivation_path "null if imported"
        boolean is_primary
        datetime created_at
    }

    TRADES {
        int id PK
        string chain
        string wallet_address FK
        string action "swap or lp_deposit or lp_withdraw"
        string protocol "7k or cetus or deepbook"
        string pool "pool address or null"
        string from_token
        string to_token
        string amount_in "bigint as string"
        string amount_out "bigint as string"
        float value_usd "null if oracle failed"
        string tx_digest
        float gas_cost
        string policy_decision "approved or rejected"
        string rejection_reason
        string rejection_check "which check rejected"
        datetime created_at
    }

    WALLETS ||--o{ TRADES : "executes"
```



Schema extensibility notes:

- protocol and pool fields stored on every trade even though MVP does not enforce protocol or pool rules — historical data is ready when those checks ship
- rejection_check records which pipeline check rejected — useful for analytics and debugging
- No circuit_breaker table in MVP — added later without modifying existing tables
- No cost_basis table in MVP — added later as a holdings table with avg_cost_usd and quantity

---

## 6. CLI Command Tree

```mermaid
graph LR
    FENCE[fence] --> SETUP[setup]
    FENCE --> SWAP[swap]
    FENCE --> QUERY[query]
    FENCE --> CONFIG[config]
    FENCE --> WALLET[wallet]
    FENCE --> LP["lp\npost-MVP"]
    FENCE --> TUI_CMD[tui]

    SETUP --> S1["Generate new wallet BIP-39"]
    SETUP --> S2["Import existing key or mnemonic"]

    SWAP --> SW1["fence swap SUI USDC 100\n--slippage 0.5%\n--chain sui\n--output json"]

    QUERY --> Q1["price SUI USDC DEEP"]
    QUERY --> Q2["balance --chain sui"]

    CONFIG --> C1["set key value"]
    CONFIG --> C2["show key"]
    CONFIG --> C3["init default config"]

    WALLET --> W1["list"]
    WALLET --> W2["link add chain"]
    WALLET --> W3["export show address"]

    LP --> LP1["pools"]
    LP --> LP2["positions"]
    LP --> LP3["deposit"]
    LP --> LP4["withdraw"]
    LP --> LP5["compound"]
    LP --> LP6["rebalance"]

    TUI_CMD --> T1["Opens interactive\nterminal UI"]

    style FENCE fill:#1A5276,color:#fff
    style LP fill:#2d2a1c,stroke:#D4AC0D,color:#fff
```



---

## 7. Wallet Setup Flow

```mermaid
flowchart TD
    START([fence setup]) --> CHOICE{Generate new\nor import?}

    CHOICE -->|Generate| GEN[Generate BIP-39\nmnemonic]
    GEN --> DERIVE[Derive keypairs per chain]
    DERIVE --> SUI_KEY["Sui ed25519\nm/44'/784'/0'/0'/0'"]
    DERIVE --> EVM_KEY["EVM secp256k1\nm/44'/60'/0'/0/0"]
    DERIVE --> SOL_KEY["Solana ed25519\nm/44'/501'/0'/0'"]
    SUI_KEY & EVM_KEY & SOL_KEY --> SHOW[Display mnemonic\nand all addresses]
    SHOW --> ENCRYPT

    CHOICE -->|Import| IMPORT[User provides\nkey or mnemonic]
    IMPORT --> DETECT{Detect or specify\nchain}
    DETECT --> SINGLE[Single chain\naddress stored]
    SINGLE --> ENCRYPT

    ENCRYPT["Encrypt keystore\npassword protected"] --> SAVE["Save to\n~/.onlyfence/keystore"]
    SAVE --> INITCFG["Generate default\nconfig.toml"]
    INITCFG --> INITDB["Init SQLite\ntrades.db"]
    INITDB --> DONE([Setup complete])

    style START fill:#2E86C1,color:#fff
    style DONE fill:#27AE60,color:#fff
```



---

## 8. Chain Adapter Interface

```mermaid
classDiagram
    class ChainAdapter {
        <<interface>>
        +chain: string
        +getBalance(address) BalanceResult
        +getTokenPrice(token) PriceResult
        +getSwapQuote(params) SwapQuote
        +buildSwapTx(quote) TransactionData
        +simulateTx(txData) SimulationResult
        +signAndSubmit(txData signer) TxResult
    }

    class SuiAdapter {
        +chain = sui
        -aggregator: SevenKClient
        -suiClient: SuiClient
    }

    class EvmAdapter {
        +chain = evm
        -aggregator: OneInchClient
        -provider: ViemClient
    }

    class SvmAdapter {
        +chain = svm
        -jupiter: JupiterClient
        -connection: SolanaConnection
    }

    class SwapParams {
        +fromToken: string
        +toToken: string
        +amount: bigint
        +slippage: number
        +walletAddress: string
    }

    class SwapQuote {
        +route: string
        +expectedOutput: bigint
        +priceImpact: number
        +protocol: string
    }

    class TxResult {
        +txDigest: string
        +status: string
        +gasUsed: number
    }

    ChainAdapter <|.. SuiAdapter : MVP
    ChainAdapter <|.. EvmAdapter : Post-MVP
    ChainAdapter <|.. SvmAdapter : Post-MVP

    ChainAdapter ..> SwapParams : input
    ChainAdapter ..> SwapQuote : output
    ChainAdapter ..> TxResult : output
```



---

## 9. Policy Config Schema

```mermaid
graph TD
    subgraph TOML["~/.onlyfence/config.toml"]
        direction TB
        subgraph SUI["chain.sui"]
            RPC1["rpc = fullnode.mainnet.sui.io"]
            subgraph ALLOW["chain.sui.allowlist — MVP"]
                A1["tokens = SUI USDC USDT\nDEEP BLUE WAL"]
            end
            subgraph LIMITS["chain.sui.limits — MVP"]
                L1["max_single_trade = 200 USDC"]
                L2["max_24h_volume = 500 USDC"]
            end
            subgraph DENY["chain.sui.denylist — Post-MVP"]
                D1["tokens = SCAM RUG"]
                D2["pools = 0xabc..."]
            end
            subgraph PROTO["chain.sui.protocol_allowlist — Post-MVP"]
                P1["protocols = cetus deepbook 7k"]
            end
            subgraph CB["chain.sui.circuit_breaker — Post-MVP"]
                C1["max_loss_24h = 100 USDC"]
                C2["max_consecutive_losses = 5"]
                C3["cooldown = 1h"]
            end
            subgraph FREQ["chain.sui.frequency_limit — Post-MVP"]
                FR1["max_trades_per_hour = 30"]
            end
        end
        subgraph GLOBAL["global — Post-MVP"]
            G1["max_24h_volume_all_chains = 2000 USDC"]
        end
    end

    style SUI fill:#1a2332,stroke:#2E86C1,color:#fff
    style ALLOW fill:#1c2d1c,stroke:#27AE60,color:#fff
    style LIMITS fill:#1c2d1c,stroke:#27AE60,color:#fff
    style DENY fill:#2d2a1c,stroke:#D4AC0D,color:#fff
    style PROTO fill:#2d2a1c,stroke:#D4AC0D,color:#fff
    style CB fill:#2d2a1c,stroke:#D4AC0D,color:#fff
    style FREQ fill:#2d2a1c,stroke:#D4AC0D,color:#fff
    style GLOBAL fill:#2d1c2d,stroke:#8E44AD,color:#fff
```



---

## 10. Oracle Failure Handling

```mermaid
flowchart TD
    START([Need USD price]) --> FETCH[Fetch from oracle API]

    FETCH --> OK{Success?}
    OK -->|Yes| RETURN[Return price]
    OK -->|No| RETRY{Retries under 3?}
    RETRY -->|Yes| WAIT["Wait 500ms"] --> FETCH
    RETRY -->|No| SKIP["Skip USD limit checks\nEnforce token allowlist only\nLog trade with value_usd = null\nLog warning"]

    RETURN --> DONE([Price available])
    SKIP --> DONE_SKIP([Trade proceeds\nUSD limits unenforced])

    style START fill:#2E86C1,color:#fff
    style DONE fill:#27AE60,color:#fff
    style DONE_SKIP fill:#D4AC0D,color:#000
    style SKIP fill:#D4AC0D,color:#000
```



MVP uses a single oracle source. Multiple sources with fallback chain is a post-MVP enhancement. When the oracle is unreachable after 3 retries, the trade still proceeds but only the token allowlist is enforced — USD-based spending limits are temporarily bypassed and the trade is logged with null value_usd.

---

## 11. File System Layout

```mermaid
graph TD
    HOME["~/.onlyfence/"] --> CFG["config.toml\nPolicy rules and chain settings"]
    HOME --> KS["keystore\nEncrypted BIP-39 seed\nor imported keys"]
    HOME --> DB["trades.db\nSQLite database"]
    HOME --> LOG["logs/\nDebug logs optional"]

    DB --> T_TRADES["trades table"]
    DB --> T_WALLETS["wallets table"]

    style HOME fill:#1A5276,color:#fff
    style DB fill:#2C3E50,color:#fff
```



---

## 12. Module Dependencies

```mermaid
graph BT
    subgraph Core["Core"]
        PE[policy-engine]
        CHECKS["checks/\ntoken-allowlist\nspending-limit"]
        TL[trade-log]
        WM[wallet-manager]
        ORC[oracle-client]
    end

    subgraph Adapters["Chain Adapters"]
        CA_IF[chain-adapter-interface]
        SUI_A[sui-adapter]
        EVM_A["evm-adapter post-MVP"]
        SVM_A["svm-adapter post-MVP"]
    end

    subgraph Interface["Interface"]
        CMD[cli-commands]
        TUI[tui-screens]
    end

    subgraph Ext["External SDKs"]
        SUI_SDK["@mysten/sui"]
        SEVK["7K Aggregator SDK"]
        SQLITE["better-sqlite3"]
        BIP39["bip39 + ed25519-hd-key"]
    end

    CMD --> PE
    CMD --> CA_IF
    CMD --> WM
    CMD --> TL
    TUI --> PE
    TUI --> TL
    TUI --> WM

    PE --> CHECKS
    PE --> TL
    PE --> ORC

    CA_IF --> SUI_A
    CA_IF -.-> EVM_A
    CA_IF -.-> SVM_A

    SUI_A --> SUI_SDK
    SUI_A --> SEVK

    TL --> SQLITE
    WM --> BIP39

    style Core fill:#1a2332,stroke:#2E86C1,color:#fff
    style Adapters fill:#2d2a1c,stroke:#D4AC0D,color:#fff
    style Interface fill:#1c2d1c,stroke:#27AE60,color:#fff
```



---

## 13. JSON Output Schema

```mermaid
graph LR
    subgraph Success["Success Response"]
        direction TB
        S1["status: success"]
        S2["chain: sui"]
        S3["action: swap"]
        S4["txDigest: 8Hk4...mW2p"]
        S5["fromToken: SUI"]
        S6["toToken: USDC"]
        S7["amountIn: 100"]
        S8["amountOut: 98.12"]
        S9["valueUsd: 98.0"]
        S10["gasCost: 0.0021"]
        S11["route: SUI to USDC via Cetus"]
    end

    subgraph Rejection["Rejection Response"]
        direction TB
        R1["status: rejected"]
        R2["chain: sui"]
        R3["action: swap"]
        R4["check: spending_limit"]
        R5["reason: exceeds_24h_volume"]
        R6["detail: 24h $480 + $98 = $578 over $500"]
        R7["limit: 500"]
        R8["current: 480"]
        R9["requested: 98"]
    end

    style Success fill:#1c2d1c,stroke:#27AE60,color:#fff
    style Rejection fill:#2d1c1c,stroke:#C0392B,color:#fff
```



---

## 14. Security Model

```mermaid
flowchart LR
    subgraph Threats["Threats"]
        T1["Prompt injection\nAgent drains wallet"]
        T2["Compromised machine\nKeystore extracted"]
        T3["Oracle manipulation\nFake price bypasses limits"]
        T4["Smart contract exploit"]
        T5["Unknown token swap"]
    end

    subgraph MVP_Mit["MVP Mitigations"]
        M1["Token allowlist\nOnly approved tokens"]
        M2["Spending limits\nPer-trade + 24h cap"]
        M3["Encrypted keystore\nPassword required"]
        M4["Dry-run simulation"]
        M5["Single oracle source\nRetry on failure\nSkip USD if unreachable\nMultiple sources post-MVP"]
    end

    subgraph Future["Post-MVP Guardrails"]
        F1["Protocol allowlist"]
        F2["Pool denylist"]
        F3["Circuit breaker"]
        F4["Frequency limiter"]
        F5["P&L based halt"]
        F6["Telegram approval"]
    end

    T1 --> M1
    T1 --> M2
    T2 --> M3
    T3 --> M5
    T4 --> M4
    T5 --> M1

    M1 -.->|"extended by"| F1
    M1 -.->|"extended by"| F2
    M2 -.->|"extended by"| F3
    M2 -.->|"extended by"| F4
    M2 -.->|"extended by"| F5
    M2 -.->|"extended by"| F6

    style Threats fill:#2d1c1c,stroke:#C0392B,color:#fff
    style MVP_Mit fill:#1c2d1c,stroke:#27AE60,color:#fff
    style Future fill:#2d2a1c,stroke:#D4AC0D,color:#fff
```



---

## 15. MVP Sprint Plan

```mermaid
gantt
    title OnlyFence MVP — 2 Week Sprint
    dateFormat  YYYY-MM-DD
    axisFormat  %b %d

    section Foundation
    Project scaffolding deps          :f1, 2026-03-17, 1d
    TOML config parser schema         :f2, after f1, 1d
    SQLite schema migrations          :f3, after f1, 1d
    BIP-39 wallet gen import          :f4, after f2, 2d
    Encrypted keystore                :f5, after f4, 1d

    section Policy Engine
    PolicyCheck interface registry    :p0, after f3, 1d
    TokenAllowlistCheck               :p1, after p0, 1d
    SpendingLimitCheck                 :p2, after p0, 1d
    Oracle client fetch + retry         :p3, after f3, 1d
    Pipeline integration tests         :p4, after p2, 1d

    section Swap Execution
    Chain adapter interface            :s0, after f2, 1d
    Sui adapter 7K integration         :s1, after s0, 2d
    PTB build dry-run simulation       :s2, after s1, 1d
    Sign submit trade logging          :s3, after s2, 1d

    section CLI
    Command parser swap query config   :c1, after p1, 2d
    JSON output formatting             :c2, after c1, 1d
    Interactive TUI basic              :c3, after c2, 2d
    fence setup wizard                 :c4, after f5, 1d

    section Launch
    OpenClaw skill package             :l1, after c2, 1d
    Documentation                      :l2, after c3, 2d
    End-to-end testing mainnet         :l3, after s3, 2d
    Community launch                   :milestone, after l3, 0d
```



---

## 16. Tech Stack

```mermaid
mindmap
  root((OnlyFence))
    Language
      TypeScript
      Node.js
    CLI
      Commander.js or yargs
      Ink for TUI
    Blockchain
      @mysten/sui
      7K Aggregator SDK
      viem post-MVP
      @solana/web3.js post-MVP
    Storage
      better-sqlite3
      smol-toml
    Crypto
      bip39
      ed25519-hd-key
      tweetnacl
      secp256k1
    Oracle
      7K price API or CoinGecko
      Multiple sources post-MVP
    Distribution
      npm registry
      npx onlyfence
```



---

## 17. Post-MVP Full Pipeline

```mermaid
graph TB
    subgraph Agent["Agent"]
        OC[OpenClaw]
    end

    subgraph CLI["OnlyFence CLI"]
        CMD[Commands]
        subgraph Pipeline["Policy Pipeline"]
            direction LR
            CK1["Token\nAllowlist"]
            CK2["Token\nDenylist"]
            CK3["Protocol\nAllowlist"]
            CK4["Pool\nDenylist"]
            CK5["Spending\nLimit"]
            CK6["Circuit\nBreaker"]
            CK7["Frequency\nLimit"]
            CK8["P&L\nCheck"]
            CK9["Approval\nGate"]
            CK1 --> CK2 --> CK3 --> CK4 --> CK5 --> CK6 --> CK7 --> CK8 --> CK9
        end
        DB[(SQLite)]
        KS[Keystore]
        TG[Telegram]
    end

    subgraph Adapters["Chain Adapters"]
        SUI_A["Sui\n7K Aggregator\n7K LP Pro"]
        EVM_A["EVM\n1inch/0x"]
        SVM_A["SVM\nJupiter"]
    end

    OC --> CMD
    CMD --> Pipeline
    Pipeline --> SUI_A
    Pipeline --> EVM_A
    Pipeline --> SVM_A
    Pipeline --> DB
    CK9 -.-> TG

    style CLI fill:#1a2332,stroke:#2E86C1,stroke-width:2px,color:#fff
    style Pipeline fill:#0d1520,stroke:#2E86C1,color:#fff
    style Adapters fill:#2d2a1c,stroke:#D4AC0D,color:#fff
```



---

## 18. Guardrail Roadmap

```mermaid
timeline
    title OnlyFence Guardrail Evolution
    MVP Week 1-2
        : Token Allowlist
        : Spending Limits — single trade + 24h volume
    Release 2
        : Token Denylist
        : Protocol Allowlist
        : Pool Denylist
    Release 3
        : Circuit Breaker — volume + frequency
        : Trade Frequency Limit
    Release 4
        : Cost-Basis P&L Tracking
        : P&L-Based Circuit Breaker
    Release 5
        : Telegram Notifications
        : Telegram Approval Gate
    Release 6
        : Global Cross-Chain Policy
        : Unified Spending Across Chains
```



