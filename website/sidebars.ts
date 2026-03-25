import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    'installation',
    'getting-started',
    'configuration',
    'cli-reference',
    'agent-integration',
    {
      type: 'category',
      label: 'DeFi Actions',
      items: ['actions/swap', 'actions/lending'],
    },
    'daemon',
    {
      type: 'category',
      label: 'Deployment',
      items: ['deployment/docker', 'deployment/kubernetes'],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: ['architecture/overview', 'architecture/policy-engine', 'architecture/chain-adapters'],
    },
    'security',
    'faq',
    'contributing',
    'changelog',
  ],
};

export default sidebars;
