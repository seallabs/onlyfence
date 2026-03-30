import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OnlyFence',
  tagline: 'Safe, full-featured DeFi toolkit for AI agents',
  favicon: 'img/favicon.png',

  future: {
    v4: true,
  },

  url: 'https://onlyfence.xyz',
  baseUrl: '/',

  organizationName: 'seallabs',
  projectName: 'onlyfence',

  onBrokenLinks: 'throw',

  scripts: [
    {
      src: '/js/scramble.js',
      defer: true,
    },
  ],

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  themes: ['@docusaurus/theme-mermaid'],

  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'alternate',
        type: 'text/plain',
        href: 'https://onlyfence.xyz/llms.txt',
        title: 'LLM-readable site description',
      },
    },
    {
      tagName: 'script',
      attributes: {
        type: 'application/ld+json',
      },
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'Organization',
            '@id': 'https://onlyfence.xyz/#organization',
            name: 'Seal Labs',
            url: 'https://github.com/seallabs',
            logo: {
              '@type': 'ImageObject',
              url: 'https://onlyfence.xyz/img/landing/logo-512.png',
            },
            sameAs: ['https://github.com/seallabs'],
          },
          {
            '@type': 'WebSite',
            '@id': 'https://onlyfence.xyz/#website',
            url: 'https://onlyfence.xyz',
            name: 'OnlyFence',
            description: 'Safe, full-featured DeFi toolkit for AI agents',
            publisher: { '@id': 'https://onlyfence.xyz/#organization' },
          },
          {
            '@type': 'SoftwareApplication',
            '@id': 'https://onlyfence.xyz/#software',
            name: 'OnlyFence',
            description: 'Free, open-source DeFi toolkit that gives AI agents safe onchain capabilities with spending limits, token allowlists, and security guardrails.',
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'macOS, Linux',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
            },
            license: 'https://www.gnu.org/licenses/gpl-3.0.html',
            url: 'https://onlyfence.xyz',
            downloadUrl: 'https://github.com/seallabs/onlyfence',
            author: { '@id': 'https://onlyfence.xyz/#organization' },
          },
        ],
      }),
    },
    {
      tagName: 'script',
      attributes: {
        async: 'true',
        src: 'https://www.googletagmanager.com/gtag/js?id=G-FF3RM7DTHS',
      },
    },
    {
      tagName: 'script',
      attributes: {},
      innerHTML: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-FF3RM7DTHS',{anonymize_ip:true});`,
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/seallabs/onlyfence/tree/main/website/',
          showLastUpdateTime: true,
        },
        blog: {
          showReadingTime: true,
          routeBasePath: 'blog',
          path: 'blog',
          blogTitle: 'OnlyFence Blog',
          blogDescription: 'DeFi security, AI agent trading, and blockchain guardrails — from the OnlyFence team',
          postsPerPage: 'ALL',
          exclude: ['CLAUDE.md'],
        },
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          lastmod: 'date',
          changefreq: null,
          priority: null,
          createSitemapItems: async (params) => {
            const { defaultCreateSitemapItems, ...rest } = params;
            const items = await defaultCreateSitemapItems(rest);
            return items.map((item) => {
              if (item.url.match(/\/$/) || item.url.includes('/intro')) {
                return { ...item, priority: 1.0, changefreq: 'weekly' };
              }
              if (item.url.match(/\/(installation|getting-started|cli-reference|agent-integration|actions\/)/)) {
                return { ...item, priority: 0.8, changefreq: 'weekly' };
              }
              if (item.url.match(/\/(changelog|contributing)/)) {
                return { ...item, priority: 0.3, changefreq: 'monthly' };
              }
              return { ...item, priority: 0.5, changefreq: 'weekly' };
            });
          },
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/hero.png',
    metadata: [
      { name: 'author', content: 'Seal Labs' },
      { property: 'og:site_name', content: 'OnlyFence' },
      { property: 'og:locale', content: 'en_US' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:site', content: '@seallabs' },
    ],
    colorMode: {
      defaultMode: 'dark',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'OnlyFence',
      logo: {
        alt: 'OnlyFence Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/blog',
          label: 'Blog',
          position: 'left',
        },
        {
          to: '/docs/installation',
          label: 'Install',
          position: 'left',
        },
        {
          href: 'https://github.com/seallabs/onlyfence',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            { label: 'Getting Started', to: '/docs/getting-started' },
            { label: 'CLI Reference', to: '/docs/cli-reference' },
            { label: 'Agent Integration', to: '/docs/agent-integration' },
          ],
        },
        {
          title: 'Deploy',
          items: [
            { label: 'Docker', to: '/docs/deployment/docker' },
            { label: 'Kubernetes', to: '/docs/deployment/kubernetes' },
          ],
        },
        {
          title: 'More',
          items: [
            { label: 'GitHub', href: 'https://github.com/seallabs/onlyfence' },
            { label: 'Changelog', to: '/docs/changelog' },
            { label: 'Contributing', to: '/docs/contributing' },
          ],
        },
      ],
      copyright: `Copyright \u00a9 ${new Date().getFullYear()} Seal Labs. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'toml', 'json', 'yaml'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
