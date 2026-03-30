# Blog Contributor Guide

## File Naming

Blog posts use Docusaurus date-prefixed filenames:

```
YYYY-MM-DD-slug-name.md
```

Example: `2026-03-30-why-we-built-onlyfence.md`

## Frontmatter

Every blog post MUST have this frontmatter:

```yaml
---
title: "Short, punchy title with keywords"
description: 1-2 sentence SEO description — written for both humans and crawlers
slug: url-friendly-slug
authors: [onlyfence]
tags: [relevant, lowercase, hyphenated-tags]
image: /img/blog/<slug>.png
keywords:
  - keyword phrase one
  - keyword phrase two
---
```

- `authors` — reference keys defined in `authors.yml`, do NOT use inline author objects
- `image` — used for social cards (Twitter/Discord/Slack unfurls) and OG meta tags
- `tags` — lowercase, hyphenated, reuse existing tags when possible
- `keywords` — 5-10 SEO keyword phrases relevant to the post

## Authors

All authors are defined in `authors.yml` in this directory. Reference them by key in frontmatter:

```yaml
authors: [onlyfence]
```

To add a new author, add an entry to `authors.yml` first, then reference it. Never use inline author definitions.

## Images

- Banner image: place at `website/static/img/blog/<slug>.png`
- Set in frontmatter via `image:` field (for social/OG)
- Also add inline after the `# Title` heading (for readers):

```md
# Post Title

![Alt text](/img/blog/<slug>.png)
```

## Content Structure

1. **Title** (`# heading`) — matches frontmatter `title`, keyword-rich
2. **Banner image** — inline right after title
3. **Opening hook** — 2-3 paragraphs before the truncate marker
4. **`<!-- truncate -->`** — controls the blog list preview cutoff
5. **Body sections** — use `##` for major sections, `###` for subsections
6. **CTA** — end with install command and doc/GitHub links

## Writing Style

- Concise, direct sentences — no filler
- Friendly for non-technical readers who are interested in AI and crypto
- Still valuable for technical readers familiar with blockchain and tooling
- Use analogies to explain technical concepts (e.g., "company credit card with spending limits")
- Bold for key concepts on first mention
- Code examples use fenced blocks with language tags (`bash`, `toml`, `json`)
- Short paragraphs (2-4 sentences)
- Use `<!-- truncate -->` to control blog list preview — place after the opening hook

## SEO

- Title should contain primary keywords naturally
- Description should be compelling and keyword-rich
- Include 5-10 keyword phrases in the `keywords` array
- Use heading hierarchy (`##`, `###`) with keywords in headings

## Do NOT

- Use inline author definitions in frontmatter — always reference `authors.yml`
- Skip the `image` field — every post needs a social card image
- Forget `<!-- truncate -->` — it controls the blog listing preview
- Add images outside `website/static/img/blog/`
