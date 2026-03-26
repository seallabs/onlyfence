# Website Contributor Guide

Docusaurus 3.9 docs site with a custom landing page. React 19, TypeScript, deployed to https://onlyfence.xyz.

## Commands

```bash
npm start          # Dev server with hot reload
npm run build      # Generate llms-full.txt then build static site
npm run typecheck  # TypeScript check (no emit)
```

Always run `npm run typecheck` before committing website changes.

## Project Structure

```
website/
  docs/              # Markdown documentation (Docusaurus content)
  src/
    css/custom.css   # Infima variable overrides for docs theme
    css/landing.css  # Landing page design system ("The Neon Architect")
    pages/index.tsx  # Landing page (single-file, self-contained)
  static/            # Static assets (images, llms.txt, robots.txt)
  scripts/           # Build-time scripts (e.g., generate-llms-full.mjs)
  sidebars.ts        # Sidebar structure — update when adding/removing docs
  docusaurus.config.ts
```

## Documentation Conventions

### Frontmatter

Every doc MUST have this frontmatter:

```yaml
---
sidebar_position: <number>
title: <Title>
description: <SEO description, 1-2 sentences, include keywords naturally>
---
```

- `sidebar_position` controls ordering within its sidebar group
- `description` is used for `<meta>` tags and LLM context — write it for both humans and crawlers
- `slug` is only needed when the URL path should differ from the filename (e.g., `intro.md` uses `slug: /intro`)

### Writing Style

- Start with a `# Title` heading matching the frontmatter `title`
- Lead with a one-paragraph summary of what the page covers
- Use `##` for major sections, `###` for subsections — never skip heading levels
- Code examples use fenced blocks with language tags (`bash`, `toml`, `json`, `typescript`)
- CLI examples: show the command first, then explain what it does
- Use bold for key concepts on first mention, not for emphasis
- Keep paragraphs short (2-4 sentences) — this is reference documentation, not prose

### Adding a New Doc

1. Create `docs/<name>.md` (or `docs/<category>/<name>.md` for grouped docs)
2. Add frontmatter with `sidebar_position`, `title`, `description`
3. Add the doc ID to `sidebars.ts` in the correct position
4. Verify the sidebar renders correctly with `npm start`

### Sidebar Structure

Defined in `sidebars.ts`. Top-level items are strings (doc IDs). Grouped items use `type: 'category'`:

```ts
{
  type: 'category',
  label: 'Category Name',
  items: ['category/doc-one', 'category/doc-two'],
}
```

Doc IDs are relative paths from `docs/` without the `.md` extension.

## Landing Page Conventions

The landing page lives entirely in `src/pages/index.tsx` + `src/css/landing.css`.

### Design System

The landing page uses a design system called **"The Neon Architect"** — dark, terminal-inspired, monospace-heavy with blue accent tones. All design tokens are CSS custom properties in `landing.css` prefixed with `--lp-`:

| Token group | Prefix | Example |
|-------------|--------|---------|
| Surfaces | `--lp-surface` | `--lp-surface`, `--lp-surface-alt` |
| Accent | `--lp-accent` | `--lp-accent`, `--lp-accent-light` |
| Text | `--lp-text-` | `--lp-text-primary`, `--lp-text-secondary` |
| Terminal | `--lp-term-` | `--lp-term-green`, `--lp-term-red` |
| Fonts | `--lp-font-` | `--lp-font-editorial`, `--lp-font-mono` |

### CSS Class Naming

All landing page classes are prefixed with `lp-` to avoid conflicts with Docusaurus/Infima classes. Follow the existing pattern:

- Sections: `lp-<section>-section` (e.g., `lp-features-section`)
- Cards/items: `lp-<section>-card` (e.g., `lp-bento-card`, `lp-adv-card`)
- Modifiers: `lp-<element>--<modifier>` (e.g., `lp-dex-badge--coming`)

### Component Pattern

Sections are plain function components in `index.tsx`, composed in the `Home` default export:

```tsx
function NewSection(): ReactNode {
  return (
    <section className="lp-new-section" id="new">
      <div className="lp-section-header lp-reveal">
        <div className="lp-section-tag">04 / SECTION TAG</div>
        <h2 className="lp-section-headline">HEADLINE HERE.</h2>
      </div>
      {/* content */}
    </section>
  );
}
```

- Use `lp-reveal` / `lp-reveal-delay` classes for scroll-triggered fade-in
- Section tags follow the pattern `NN / LABEL` in uppercase
- Headlines are uppercase, editorial font

### Adding a New Section

1. Create a function component in `index.tsx` following the pattern above
2. Add CSS in `landing.css` under a clearly commented section block
3. Compose it into `<main>` in the `Home` component
4. If adding a nav anchor, add the `id` attribute and a link in `LandingNav`

## CSS Conventions

- `custom.css` — Only for Docusaurus/Infima theme variable overrides (docs pages)
- `landing.css` — Only for landing page styles. Never import Infima variables here
- Do NOT mix landing page styles into `custom.css` or vice versa
- Use CSS custom properties from the design system — do not hardcode colors
- `border-radius: var(--lp-radius-zero)` — the design system uses sharp corners intentionally
- Responsive breakpoints: `960px` (tablet), `640px` (mobile)

## SEO & LLM Discoverability

The site serves `llms.txt` and `llms-full.txt` for LLM crawlers:

- `static/llms.txt` — Manually maintained summary with key links
- `static/llms-full.txt` — Auto-generated by `scripts/generate-llms-full.mjs` (concatenates all docs, stripped of frontmatter)
- Generated automatically during `npm run build` — do NOT edit `llms-full.txt` manually

When adding docs, the new content is automatically included in `llms-full.txt` on next build.

Structured data (JSON-LD) and `<meta>` tags are configured in `docusaurus.config.ts` — update there when adding new schema types.

## Do NOT

- Add new npm dependencies without discussion — the site is intentionally lightweight
- Create new page routes beyond `index.tsx` and docs — use docs for all content pages
- Use inline styles in TSX — add classes to `landing.css` instead
- Import `landing.css` from anywhere other than `index.tsx`
- Edit `llms-full.txt` directly — it is generated at build time
