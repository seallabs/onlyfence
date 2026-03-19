// Google Analytics (GA4) — OnlyFence Landing Pages
// Shared across v1–v5. Loaded with `defer`.
(function () {
    const GA_ID = 'G-FF3RM7DTHS';

    // Build a queuing gtag before the real script loads
    window.dataLayer = window.dataLayer || [];
    function gtag() { window.dataLayer.push(arguments); }
    window.gtag = gtag;

    gtag('js', new Date());
    gtag('config', GA_ID, {
        link_attribution: true,
        page_path: window.location.pathname,
    });

    // Inject the gtag.js loader async (non-blocking)
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(script);

    // -----------------------------------------------
    // Named events (v4 spec)
    // -----------------------------------------------
    const NAMED_EVENTS = {
        'cta-hero-install':  'cta_hero_install_clicked',
        'cta-view-source':   'cta_view_source_clicked',
    };

    // -----------------------------------------------
    // Auto-tracking after DOM is ready
    // -----------------------------------------------
    function attachTracking() {
        // Named CTA events
        Object.entries(NAMED_EVENTS).forEach(function ([id, eventName]) {
            var el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', function () {
                    gtag('event', eventName);
                });
            }
        });

        // Footer install button
        document.querySelectorAll('.footer-ctas .btn').forEach(function (el) {
            el.addEventListener('click', function () {
                gtag('event', 'cta_footer_install_clicked', {
                    button_text: el.textContent.trim().substring(0, 40),
                });
            });
        });

        // All external links → link_github_clicked or external_link_clicked
        document.querySelectorAll('a[href^="http"]').forEach(function (el) {
            if (el.href.includes(window.location.hostname)) return;
            el.addEventListener('click', function () {
                var eventName = el.href.includes('github.com')
                    ? 'link_github_clicked'
                    : 'external_link_clicked';
                gtag('event', eventName, {
                    link_url:  el.href,
                    link_text: el.textContent.trim().substring(0, 40),
                    source:    el.closest('section, nav, footer')?.tagName?.toLowerCase() || 'unknown',
                });
            });
        });

        // Generic .btn click fallback (for anything not caught above)
        document.querySelectorAll('.btn, .nav-btn').forEach(function (el) {
            el.addEventListener('click', function () {
                gtag('event', 'cta_clicked', {
                    button_text:     el.textContent.trim().substring(0, 40),
                    button_location: el.closest('section, nav, footer')?.className || 'unknown',
                    page_location:   window.location.pathname,
                });
            });
        });
    }

    // `defer` guarantees this runs after parsing; DOMContentLoaded
    // may have already fired, so guard both cases.
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attachTracking);
    } else {
        attachTracking();
    }
})();
