import type {ReactNode} from 'react';
import clsx from 'clsx';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import {
  PageMetadata,
  HtmlClassNameProvider,
  ThemeClassNames,
} from '@docusaurus/theme-common';
import BlogLayout from '@theme/BlogLayout';
import BlogListPaginator from '@theme/BlogListPaginator';
import SearchMetadata from '@theme/SearchMetadata';
import Link from '@docusaurus/Link';
import BlogListPageStructuredData from '@theme/BlogListPage/StructuredData';
import type {Props} from '@theme/BlogListPage';
import type {Content} from '@theme/BlogPostPage';

type FrontMatterWithExtras = Record<string, unknown> & {
  image?: string;
  'og:image'?: string;
  featured?: boolean;
  description?: string;
};

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function getImageUrl(frontMatter: FrontMatterWithExtras): string {
  return frontMatter.image
    || frontMatter['og:image']
    || '/img/placeholder-blog.png';
}

interface BlogPostCardProps {
  readonly item: {readonly content: Content};
}

function BlogListPageMetadata({metadata}: Props): ReactNode {
  const {
    siteConfig: {title: siteTitle},
  } = useDocusaurusContext();
  const {blogDescription, blogTitle, permalink} = metadata;
  const isBlogOnlyMode = permalink === '/';
  const title = isBlogOnlyMode ? siteTitle : blogTitle;
  return (
    <>
      <PageMetadata title={title} description={blogDescription} />
      <SearchMetadata tag="blog_posts_list" />
    </>
  );
}

function BlogPostCard({item}: BlogPostCardProps): ReactNode {
  const {content} = item;
  const frontMatter = content.frontMatter as FrontMatterWithExtras;
  const {metadata} = content;
  const {title, description, date} = metadata;
  const imageUrl = getImageUrl(frontMatter);

  return (
    <div className="of-blog-card">
      <Link to={metadata.permalink} className="of-blog-card-image-wrapper">
        <img src={imageUrl} alt={title} className="of-blog-card-image" />
      </Link>
      <div className="of-blog-card-content">
        <div className="of-blog-date">{formatDate(date)}</div>
        <Link to={metadata.permalink}>
          <h3 className="of-blog-card-title scramble-hover">{title}</h3>
        </Link>
        <p className="of-blog-card-desc">{description || frontMatter.description}</p>
        <Link to={metadata.permalink} className="of-blog-view-more">
            VIEW MORE <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
        </Link>
      </div>
    </div>
  );
}

function BlogListPageContent(props: Props): ReactNode {
  const {metadata, items} = props;

  const featuredPost = items.find(
    item => (item.content.frontMatter as FrontMatterWithExtras).featured === true,
  ) || items[0];
  const otherPosts = items.filter(
    item => item.content.metadata.permalink !== featuredPost.content.metadata.permalink,
  );

  const renderFeatured = (item: {readonly content: Content}): ReactNode => {
    const {content} = item;
    const frontMatter = content.frontMatter as FrontMatterWithExtras;
    const {metadata: postMeta} = content;
    const {title, description, date} = postMeta;
    const imageUrl = getImageUrl(frontMatter);

    return (
      <div className="of-blog-featured-section">
          <div className="of-blog-section-title">FEATURED</div>
          <div className="of-blog-featured-card">
              <Link to={postMeta.permalink} className="of-blog-featured-image-wrapper">
                  <img src={imageUrl} alt={title} className="of-blog-featured-image" />
              </Link>
              <div className="of-blog-featured-content">
                  <div className="of-blog-date">{formatDate(date)}</div>
                  <Link to={postMeta.permalink}>
                    <h2 className="of-blog-featured-title scramble-hover">{title}</h2>
                  </Link>
                  <p className="of-blog-featured-desc">{description || frontMatter.description}</p>
                  <Link to={postMeta.permalink} className="of-blog-view-more" style={{fontSize: '1rem'}}>
                    READ ARTICLE <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                  </Link>
              </div>
          </div>
      </div>
    );
  };

  return (
    <BlogLayout sidebar={undefined}>
      <div className="of-blog-container">
        {featuredPost && renderFeatured(featuredPost)}

        {otherPosts.length > 0 && (
          <div className="of-blog-latest-section">
              <div className="of-blog-section-title">LATEST</div>
              <div className="of-blog-grid">
                  {otherPosts.map((item) => (
                    <BlogPostCard key={item.content.metadata.permalink} item={item} />
                  ))}
              </div>
          </div>
        )}
      </div>
      <BlogListPaginator metadata={metadata} />
    </BlogLayout>
  );
}

export default function BlogListPage(props: Props): ReactNode {
  return (
    <HtmlClassNameProvider
      className={clsx(
        ThemeClassNames.wrapper.blogPages,
        ThemeClassNames.page.blogListPage,
      )}>
      <BlogListPageMetadata {...props} />
      <BlogListPageStructuredData {...props} />
      <BlogListPageContent {...props} />
    </HtmlClassNameProvider>
  );
}
