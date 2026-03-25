import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OnlyFence',
  tagline: 'Safe, full-featured DeFi toolkit for AI agents',
  favicon: 'img/favicon.png',

  future: {
    v4: true,
  },

  url: 'https://onlyfence.dev',
  baseUrl: '/',

  organizationName: 'seallabs',
  projectName: 'onlyfence',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
  },

  themes: ['@docusaurus/theme-mermaid'],

  headTags: [
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
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
        googleTagManager: false,
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/hero.png',
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
            {label: 'Getting Started', to: '/docs/getting-started'},
            {label: 'CLI Reference', to: '/docs/cli-reference'},
            {label: 'Agent Integration', to: '/docs/agent-integration'},
          ],
        },
        {
          title: 'Deploy',
          items: [
            {label: 'Docker', to: '/docs/deployment/docker'},
            {label: 'Kubernetes', to: '/docs/deployment/kubernetes'},
          ],
        },
        {
          title: 'More',
          items: [
            {label: 'GitHub', href: 'https://github.com/seallabs/onlyfence'},
            {label: 'Changelog', to: '/docs/changelog'},
            {label: 'Contributing', to: '/docs/contributing'},
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
