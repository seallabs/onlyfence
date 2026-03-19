document.addEventListener('DOMContentLoaded', () => {

    // =========================================
    // 1. TERMINAL ANIMATION
    // =========================================

    const TERMINAL_STEPS = [
        { type: 'type',       target: 't-type-target',  text: 'fence swap SUI USDC 500', speed: 55, delay: 600  },
        { type: 'show',       target: 't2',                                               delay: 1500 },
        { type: 'show',       target: 't3',                                               delay: 2300 },
        { type: 'show',       target: 't4',                                               delay: 2900 },
        { type: 'show',       target: 't5',                                               delay: 3400 },
        { type: 'hideCursor', target: 't-input-cursor',                                   delay: 3600 },
        { type: 'show',       target: 't6',                                               delay: 4000 },
    ];

    function typeText(el, text, speed) {
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

    function showLine(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.remove('t-hidden');
        el.classList.add('t-show');
    }

    TERMINAL_STEPS.forEach(step => {
        setTimeout(() => {
            if (step.type === 'type') {
                const el = document.getElementById(step.target);
                if (el) typeText(el, step.text, step.speed);
            } else if (step.type === 'show') {
                showLine(step.target);
            } else if (step.type === 'hideCursor') {
                const el = document.getElementById(step.target);
                if (el) el.style.display = 'none';
            }
        }, step.delay);
    });


    // =========================================
    // 2. SCROLL REVEAL (IntersectionObserver)
    // =========================================

    const revealEls = document.querySelectorAll('.reveal, .reveal-delay');

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -40px 0px'
    });

    revealEls.forEach(el => revealObserver.observe(el));


    // =========================================
    // 3. SCRAMBLE HOVER EFFECT
    // =========================================

    const SCRAMBLE_CHARS = '!<>-_\\/[]{}*^?#0123456789';

    function scramble(el) {
        if (el.dataset.scrambling === 'true') return;
        el.dataset.scrambling = 'true';

        const original = el.dataset.original || el.textContent;
        el.dataset.original = original;

        let iter = 0;
        clearInterval(el._scrambleTimer);

        el._scrambleTimer = setInterval(() => {
            el.textContent = original
                .split('')
                .map((ch, i) => {
                    if (ch === ' ' || ch === '.' || ch === '_' || ch === '[' || ch === ']') return ch;
                    if (i < iter) return original[i];
                    return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
                })
                .join('');

            iter += 0.5;

            if (iter >= original.length) {
                clearInterval(el._scrambleTimer);
                el.textContent = original;
                el.dataset.scrambling = 'false';
            }
        }, 28);
    }

    // Hover-triggered scramble
    document.querySelectorAll('.scramble-hover').forEach(el => {
        el.dataset.original = el.textContent;
        el.addEventListener('mouseenter', () => scramble(el));
    });

    // Span-based scramble — stable layout, no line-reflow jumping.
    // Used for .scramble-on-load elements (on load + on hover).
    document.querySelectorAll('.scramble-on-load').forEach(el => {
        const original = el.textContent;

        // Wrap each character in a span once — keeps DOM dimensions stable
        el.innerHTML = original
            .split('')
            .map(ch => `<span class="sc-ch" data-ch="${ch}">${ch}</span>`)
            .join('');

        const spans = Array.from(el.querySelectorAll('.sc-ch'));
        const SKIP  = new Set([' ', '.', '&', '-', ',', '\'']);

        function runSpanScramble() {
            if (el.dataset.scrambling === 'true') return;
            el.dataset.scrambling = 'true';

            // Lock height so surrounding layout stays put
            const lockedH = el.getBoundingClientRect().height;
            el.style.minHeight = lockedH + 'px';
            el.style.overflow  = 'hidden';

            let iter = 0;
            clearInterval(el._scrambleTimer);

            el._scrambleTimer = setInterval(() => {
                spans.forEach((span, i) => {
                    const ch = span.dataset.ch;
                    if (SKIP.has(ch)) { span.textContent = ch; return; }
                    span.textContent = i < iter
                        ? ch
                        : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
                });

                iter += 0.35;

                if (iter >= spans.length) {
                    clearInterval(el._scrambleTimer);
                    spans.forEach(span => { span.textContent = span.dataset.ch; });
                    el.style.minHeight    = '';
                    el.style.overflow     = '';
                    el.dataset.scrambling = 'false';
                }
            }, 24);
        }

        // Fire on page load
        setTimeout(runSpanScramble, 400);

        // Restart on hover
        el.addEventListener('mouseenter', runSpanScramble);
    });


    // =========================================
    // 4. COPY INSTALL COMMAND (shared helper)
    // =========================================

    function attachCopy(btnId, labelId, cmdId) {
        const btn  = document.getElementById(btnId);
        const lbl  = document.getElementById(labelId);
        const cmd  = document.getElementById(cmdId);
        if (!btn || !cmd) return;

        btn.addEventListener('click', () => {
            navigator.clipboard.writeText(cmd.textContent.trim()).then(() => {
                lbl.textContent = 'COPIED!';
                setTimeout(() => { lbl.textContent = 'COPY'; }, 2000);
            }).catch(() => {
                const range = document.createRange();
                range.selectNodeContents(cmd);
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
            });
        });
    }

    attachCopy('copy-install', 'copy-label',        'install-cmd-text');
    attachCopy('copy-deploy',  'copy-deploy-label',  'deploy-cmd-text');


    // =========================================
    // 5. GA4 EVENT HELPERS
    //    (gtag may be defined asynchronously
    //     via GA.js — guard against absence)
    // =========================================

    function trackEvent(name, params) {
        if (typeof gtag === 'function') {
            gtag('event', name, params || {});
        }
    }

    const tracked = [
        { id: 'cta-hero-install', event: 'cta_hero_install_clicked'  },
        { id: 'cta-view-source',  event: 'cta_view_source_clicked'   },
    ];

    tracked.forEach(({ id, event }) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', () => trackEvent(event));
    });

});
