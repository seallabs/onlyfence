import { type ReactNode, useEffect, useRef, useCallback } from 'react';
import Layout from '@theme/Layout';
import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';

import '../css/landing.css';

// =========================================
// Terminal Animation
// =========================================

function useTerminalAnimation(): void {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    const STEPS = [
      { type: 'type', target: 'lp-type-target', text: 'fence swap SUI USDC 500', speed: 55, delay: 600 },
      { type: 'show', target: 'lp-t2', delay: 1500 },
      { type: 'show', target: 'lp-t3', delay: 2300 },
      { type: 'show', target: 'lp-t4', delay: 2900 },
      { type: 'show', target: 'lp-t5', delay: 3400 },
      { type: 'hideCursor', target: 'lp-input-cursor', delay: 3600 },
      { type: 'show', target: 'lp-t6', delay: 4000 },
    ];

    function typeText(el: HTMLElement, text: string, speed: number): void {
      el.textContent = '';
      let i = 0;
      const timer = setInterval(() => {
        if (i < text.length) {
          el.textContent += text[i++];
        } else {
          clearInterval(timer);
        }
      }, speed);
    }

    function showLine(id: string): void {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('lp-t-hidden');
      el.classList.add('lp-t-show');
    }

    STEPS.forEach((step) => {
      setTimeout(() => {
        if (step.type === 'type') {
          const el = document.getElementById(step.target);
          if (el) typeText(el, step.text!, step.speed!);
        } else if (step.type === 'show') {
          showLine(step.target);
        } else if (step.type === 'hideCursor') {
          const el = document.getElementById(step.target);
          if (el) el.style.display = 'none';
        }
      }, step.delay);
    });
  }, []);
}

// =========================================
// Scroll Reveal
// =========================================

function useScrollReveal(): void {
  useEffect(() => {
    const els = document.querySelectorAll('.lp-reveal, .lp-reveal-delay');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);
}

// =========================================
// Copy Button
// =========================================

function CopyButton({ textId, label = 'COPY' }: { textId: string; label?: string }): ReactNode {
  const btnLabel = useRef<HTMLSpanElement>(null);

  const handleCopy = useCallback(() => {
    const cmd = document.getElementById(textId);
    if (!cmd) return;
    navigator.clipboard.writeText(cmd.textContent?.trim() ?? '').then(() => {
      if (btnLabel.current) {
        btnLabel.current.textContent = 'COPIED!';
        setTimeout(() => {
          if (btnLabel.current) btnLabel.current.textContent = label;
        }, 2000);
      }
    });
  }, [textId, label]);

  return (
    <button className="lp-copy-btn" onClick={handleCopy} aria-label="Copy install command">
      <span ref={btnLabel}>{label}</span>
    </button>
  );
}

// =========================================
// Sections
// =========================================

function HeroSection(): ReactNode {
  return (
    <section className="lp-hero" id="hero">
      <div className="lp-hero-content lp-reveal">
        <div className="lp-eyebrow">[ SYSTEM_STATUS: OPERATIONAL // AGENT_FENCE_v0.2.0 ]</div>
        <h1 className="lp-hero-headline">Let the agent trade within the fence.</h1>
        <p className="lp-hero-sub">
          OnlyFence is an open-source CLI, local-first guardrail layer &amp; DeFi tool for AI Agents, enforcing
          security policies in milliseconds — before a single key is signed.
        </p>
        <div className="lp-hero-ctas">
          <Link className="lp-btn lp-btn-gradient" to="/docs/installation">
            INSTALL_CLI
          </Link>
          <a className="lp-btn lp-btn-ghost" href="https://github.com/seallabs/onlyfence">
            VIEW_SOURCE
          </a>
        </div>
      </div>

      <div className="lp-hero-visual lp-reveal-delay">
        <div className="lp-terminal-ambient-glow" aria-hidden="true" />
        <div className="lp-terminal-window">
          <div className="lp-terminal-bar">
            <span className="lp-tdot lp-tdot-red" />
            <span className="lp-tdot lp-tdot-yellow" />
            <span className="lp-tdot lp-tdot-green" />
            <span className="lp-terminal-bar-title">fence — policy-engine</span>
          </div>
          <div className="lp-terminal-body">
            <div className="lp-t-line">
              <span className="lp-t-prompt">admin@fence:~$</span>
              <span className="lp-t-cmd" id="lp-type-target" />
              <span className="lp-t-cursor" id="lp-input-cursor" />
            </div>
            <div className="lp-t-line lp-t-info lp-t-hidden" id="lp-t2">
              &gt; [POLICY_ENGINE] Evaluating Trade Intent...
            </div>
            <div className="lp-t-line lp-t-error lp-t-hidden" id="lp-t3">
              &gt; [REJECTED] 24h Volume Cap ($500) exceeded.
            </div>
            <div className="lp-t-line lp-t-dim lp-t-hidden" id="lp-t4">
              &gt; Current Session: $480 | Attempted: +$500
            </div>
            <div className="lp-t-line lp-t-dim lp-t-hidden" id="lp-t5">
              &gt; Action: Transaction short-circuited locally.
            </div>
            <div className="lp-t-line lp-t-hidden" id="lp-t6">
              <span className="lp-t-prompt">admin@fence:~$</span>
              <span className="lp-t-cursor" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InstallStrip(): ReactNode {
  return (
    <div className="lp-install-wrapper lp-reveal">
      <div className="lp-install-strip">
        <span className="lp-install-label">INSTALL</span>
        <div className="lp-install-body">
          <code id="lp-install-cmd">
            curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
          </code>
          <CopyButton textId="lp-install-cmd" />
        </div>
      </div>
    </div>
  );
}

function ProblemSection(): ReactNode {
  return (
    <section className="lp-problem-section" id="problem">
      <div className="lp-section-header lp-reveal">
        <div className="lp-section-tag">01 / THE PROBLEM</div>
        <h2 className="lp-section-headline">
          AGENTS HAVE EYES.
          <br />
          THEY DON&apos;T HAVE BRAKES.
        </h2>
      </div>
      <div className="lp-problem-body lp-reveal">
        <p className="lp-problem-text">
          Autonomous AI agents hold raw private keys with total authority. One hallucination, one prompt injection, or
          one bad strategy can drain a wallet in a single block.
        </p>
        <p className="lp-problem-text lp-problem-accent">
          OnlyFence provides the invisible boundary. No backend. No cloud. No middleman. Just a local, hardened policy
          engine that ensures your agent only does what you&apos;ve authorized.
        </p>
      </div>
      <div className="lp-problem-image-wrap lp-reveal">
        <video
          src="https://github.com/seallabs/onlyfence/releases/download/assets/demo.mp4"
          poster="/img/landing/showcase.png"
          preload="metadata"
          controls
          muted
          playsInline
          width={1280}
          height={720}
          aria-label="OnlyFence CLI demo — policy engine rejecting a trade that exceeds the 24h volume cap"
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
      </div>
    </section>
  );
}

function FeaturesSection(): ReactNode {
  return (
    <section className="lp-features-section" id="features">
      <div className="lp-section-header lp-reveal">
        <div className="lp-section-tag">02 / CORE LOGIC</div>
        <h2 className="lp-section-headline">THE POLICY PIPELINE.</h2>
      </div>

      <div className="lp-bento-grid lp-reveal">
        {/* Card 1: The Engine (wide) */}
        <div className="lp-bento-card lp-bento-wide">
          <div className="lp-bento-tag">EDITABLE_POLICIES</div>
          <h3 className="lp-bento-title">The Engine</h3>
          <p className="lp-bento-desc">
            Define spending limits, volume caps, and token allowlists in a simple TOML config. Composable safety checks
            that adapt to your strategy in real-time.
          </p>
          <div className="lp-code-block">
            <span className="lp-c-comment"># ~/.onlyfence/config.toml</span>
            <br />
            <span className="lp-c-key">max_single_trade</span> = <span className="lp-c-val">&quot;$200 USD&quot;</span>
            <br />
            <span className="lp-c-key">volume_cap_24h</span>&nbsp;&nbsp; ={' '}
            <span className="lp-c-val">&quot;$500 USD&quot;</span>
            <br />
            <span className="lp-c-key">allowed_tokens</span>&nbsp;&nbsp; ={' '}
            <span className="lp-c-val">[&quot;SUI&quot;, &quot;USDC&quot;, &quot;USDT&quot;]</span>
          </div>
        </div>

        {/* Card 2: The Vault */}
        <div className="lp-bento-card">
          <div className="lp-bento-tag">ENCRYPTED_SIGNING</div>
          <h3 className="lp-bento-title">The Vault</h3>
          <p className="lp-bento-desc">
            BIP-39 mnemonic generation and local-only keystores. Your keys never leave your machine.
          </p>
          <div className="lp-code-block lp-code-success">
            ✓ Keystore encrypted locally
            <br />✓ BIP-39 mnemonic secured
          </div>
        </div>

        {/* Card 3: The Oracle */}
        <div className="lp-bento-card">
          <div className="lp-bento-tag">REALTIME_SIMULATION</div>
          <h3 className="lp-bento-title">The Oracle</h3>
          <p className="lp-bento-desc">
            Every trade is simulated via RPC and priced via Oracle before execution. Zero surprises at signing time.
          </p>
          <div className="lp-code-block lp-code-info">
            &gt; Simulating via RPC...
            <br />
            &gt; Oracle price: $1.24 USD
          </div>
        </div>

        {/* Card 4: The Agent API */}
        <div className="lp-bento-card">
          <div className="lp-bento-tag">MACHINE_READABLE</div>
          <h3 className="lp-bento-title">The Agent API</h3>
          <p className="lp-bento-desc">
            Direct JSON output for seamless integration with Claude, Cursor, and custom agent scripts.
          </p>
          <div className="lp-code-block lp-code-info">fence swap SUI USDC 10 --output json</div>
        </div>

        {/* Card 5: Interactive TUI */}
        <div className="lp-bento-card">
          <div className="lp-bento-tag">INTERACTIVE_TUI</div>
          <h3 className="lp-bento-title">The Dashboard</h3>
          <p className="lp-bento-desc">
            Full-screen terminal interface. Live policy config, trade history, and wallet balances — all in one view.
          </p>
          <div className="lp-code-block lp-code-success">fence &nbsp;&nbsp;// Launch Dashboard</div>
        </div>

        {/* Card 6: The Network (full-width) */}
        <div className="lp-bento-card lp-bento-full">
          <div className="lp-bento-tag">7K_AGGREGATOR_POWERED</div>
          <h3 className="lp-bento-title">The Network</h3>
          <p className="lp-bento-desc">
            Optimal routing across all Sui DEXes. Best execution guaranteed by 7K Aggregator intelligence. EVM &amp;
            Solana support coming.
          </p>
          <div className="lp-dex-list">
            <span className="lp-dex-badge">Cetus</span>
            <span className="lp-dex-badge">DeepBook</span>
            <span className="lp-dex-badge">Bluefin</span>
            <span className="lp-dex-badge">FlowX</span>
            <span className="lp-dex-badge">Turbos</span>
            <span className="lp-dex-badge lp-dex-badge--coming">EVM ↗</span>
            <span className="lp-dex-badge lp-dex-badge--coming">Solana ↗</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function AdvantageSection(): ReactNode {
  return (
    <section className="lp-advantage-section" id="advantage">
      <div className="lp-section-header lp-reveal">
        <div className="lp-section-tag">03 / THE ADVANTAGE</div>
        <h2 className="lp-section-headline">WHY THIS SYSTEM?</h2>
      </div>

      <div className="lp-advantage-grid lp-reveal">
        <div className="lp-adv-card">
          <div className="lp-adv-icon">[ƛ]</div>
          <h3 className="lp-adv-title">ZERO LATENCY</h3>
          <p className="lp-adv-desc">
            Policy evaluation happens in-process. No API round-trips to slow down your strategy. Sub-millisecond
            decisions, every trade.
          </p>
        </div>
        <div className="lp-adv-card">
          <div className="lp-adv-icon">[Ø]</div>
          <h3 className="lp-adv-title">ZERO INFRASTRUCTURE</h3>
          <p className="lp-adv-desc">
            No servers, no accounts, no tracking. Privacy is the default, not a feature. One install, full
            enterprise-grade guardrail power.
          </p>
        </div>
        <div className="lp-adv-card">
          <div className="lp-adv-icon">[◉]</div>
          <h3 className="lp-adv-title">AUDIT-READY</h3>
          <p className="lp-adv-desc">
            Every decision—approved or blocked—is logged to a local SQLite database. Complete forensic trail for every
            agent action.
          </p>
        </div>
        <div className="lp-adv-card">
          <div className="lp-adv-icon">[↯]</div>
          <h3 className="lp-adv-title">DEVELOPER FIRST</h3>
          <p className="lp-adv-desc">
            Built by engineers who write agents. No messy wrappers or bloated SDKs. Direct CLI integration with any
            agent stack or prompt sequence.
          </p>
        </div>
      </div>
    </section>
  );
}

function DeploySection(): ReactNode {
  return (
    <section className="lp-deploy-section">
      <div className="lp-deploy-inner lp-reveal">
        <div className="lp-section-tag">DEPLOY</div>
        <h2 className="lp-deploy-headline">Ready to deploy?</h2>
        <p className="lp-deploy-sub">One command. Takes about 30 seconds. No account required.</p>
        <div className="lp-deploy-install">
          <span className="lp-install-label">INSTALL</span>
          <div className="lp-install-body">
            <code id="lp-deploy-cmd">
              curl -fsSL https://raw.githubusercontent.com/seallabs/onlyfence/main/install.sh | sh
            </code>
            <CopyButton textId="lp-deploy-cmd" />
          </div>
        </div>
      </div>
    </section>
  );
}

function LandingNav(): ReactNode {
  return (
    <nav className="lp-navbar">
      <div className="lp-navbar-inner">
        <Link to="/" className="lp-logo">
          <img src="/img/landing/logo-512.png" alt="OnlyFence" className="lp-logo-img" />
          <span className="lp-logo-text">OnlyFence_</span>
        </Link>
        <div className="lp-nav-links">
          <a href="#problem" className="lp-nav-link">Problem</a>
          <a href="#features" className="lp-nav-link">Features</a>
          <a href="#advantage" className="lp-nav-link">Why</a>
          <Link to="/docs/intro" className="lp-nav-link">Docs</Link>
          <a href="https://github.com/seallabs/onlyfence" className="lp-nav-cta">GitHub</a>
        </div>
      </div>
    </nav>
  );
}

function LandingFooter(): ReactNode {
  return (
    <footer className="lp-footer">
      <div className="lp-footer-inner">
        <p className="lp-footer-tagline">
          &quot;Because the only thing more dangerous than a dumb bot is a smart one with your money.&quot;
        </p>
        <div className="lp-footer-ctas">
          <Link className="lp-btn lp-btn-gradient lp-btn-sm" to="/docs/installation">
            INSTALL_NOW
          </Link>
          <Link className="lp-btn lp-btn-ghost lp-btn-sm" to="/docs/intro">
            DOCUMENTATION
          </Link>
          <a className="lp-btn lp-btn-ghost lp-btn-sm" href="https://github.com/seallabs/onlyfence">
            GITHUB
          </a>
        </div>
        <div className="lp-footer-badges">
          <span>BUILT_BY_SEAL_LABS</span>
          <span className="lp-footer-sep">|</span>
          <span>POWERED_BY_7K</span>
        </div>
      </div>
    </footer>
  );
}

// =========================================
// Page
// =========================================

export default function Home(): ReactNode {
  useTerminalAnimation();
  useScrollReveal();

  return (
    <Layout
      title="Safe DeFi for AI Agents"
      description="OnlyFence gives AI agents full DeFi capabilities with safety guardrails. Swap, lend, borrow — without risking your wallet."
      wrapperClassName="landing-page">
      <Head>
        <meta property="og:type" content="website" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'OnlyFence',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS, Linux',
            description:
              'Free, open-source CLI tool that gives AI agents safe access to DeFi with spending limits, token allowlists, and security policies. Supports swaps, lending, and borrowing on Sui.',
            url: 'https://onlyfence.xyz',
            downloadUrl: 'https://github.com/seallabs/onlyfence/releases',
            softwareVersion: '0.2.0',
            license: 'https://www.gnu.org/licenses/gpl-3.0.html',
            isAccessibleForFree: true,
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
            },
            author: {
              '@type': 'Organization',
              name: 'Seal Labs',
              url: 'https://github.com/seallabs',
            },
            codeRepository: 'https://github.com/seallabs/onlyfence',
            programmingLanguage: 'TypeScript',
          })}
        </script>
      </Head>

      <LandingNav />
      <div className="lp-grid-bg" aria-hidden="true" />

      <main>
        <HeroSection />
        <InstallStrip />
        <ProblemSection />
        <FeaturesSection />
        <AdvantageSection />
        <DeploySection />
      </main>

      <LandingFooter />
    </Layout>
  );
}
