/**
 * Scramble Effect for OnlyFence - Fix Jitter & Unwanted Targets
 */
(function() {
  console.log('OnlyFence Scramble Script Loaded');
  const SCRAMBLE_CHARS = '!<>-_\\/[]{}*^?#0123456789';

  function scramble(el) {
    if (el.dataset.scrambling === 'true') return;
    el.dataset.scrambling = 'true';

    // Lock both width and height to prevent layout shift during scramble
    const rect = el.getBoundingClientRect();
    const computed = getComputedStyle(el);
    const isBlock = computed.display === 'block';

    el.style.width = rect.width + 'px';
    el.style.height = rect.height + 'px';
    el.style.overflow = 'hidden';
    el.style.lineHeight = computed.lineHeight;
    // Explicitly set display so .scrambling CSS class cannot override it
    el.style.display = isBlock ? 'block' : 'inline-block';
    el.classList.add('scrambling');

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
        el.classList.remove('scrambling');

        // Unlock all locked styles
        el.style.width = '';
        el.style.height = '';
        el.style.overflow = '';
        el.style.lineHeight = '';
        el.style.display = '';
      }
    }, 28);
  }

  function initScramble() {
    // Target h2-h3 and buttons/links
    // EXCLUDE h1 (Main Titles)
    const targets = document.querySelectorAll('h2, h3, button, .navbar-7k-link, .topbarCTA, a.btn, a.nav-cta, a[href*="github.com"], a[href*="7k.ag"], a[href*="onlyfence.xyz"]');
    
    targets.forEach(el => {
      // 1. EXCLUDE LOGO & NAV BRAND
      const isLogo = el.classList.contains('navbar__brand') || el.classList.contains('logo') || el.querySelector('img') || el.closest('.logo');
      if (isLogo) return;

      // 2. EXCLUDE LOGO & NAV BRAND AGAIN (Surgical)
      if (el.closest('.navbar__brand')) return;

      if (!el.dataset.original) {
        el.dataset.original = el.textContent;
      }
      
      if (!el._scrambleBound) {
        el._scrambleBound = true;
        el.style.cursor = 'pointer';
        el.addEventListener('mouseenter', () => scramble(el));
      }
    });

    // Cleanup logo links to point to xyz without scramble
    const logoLinks = document.querySelectorAll('header a[href="/"], a.navbar__brand, .logo-link');
    logoLinks.forEach(item => {
        item.setAttribute('href', 'https://onlyfence.xyz/');
    });
  }

  const observer = new MutationObserver(() => initScramble());
  document.addEventListener('DOMContentLoaded', () => {
    initScramble();
    observer.observe(document.body, { childList: true, subtree: true });
  });

  setTimeout(initScramble, 500);
  setInterval(initScramble, 2000); 
})();
