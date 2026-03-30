import type {ReactNode} from 'react';
import clsx from 'clsx';
import {HtmlClassNameProvider, ThemeClassNames} from '@docusaurus/theme-common';
import {
  BlogPostProvider,
  useBlogPost,
} from '@docusaurus/plugin-content-blog/client';
import BlogLayout from '@theme/BlogLayout';
import BlogPostItem from '@theme/BlogPostItem';
import BlogPostPageMetadata from '@theme/BlogPostPage/Metadata';
import BlogPostPageStructuredData from '@theme/BlogPostPage/StructuredData';
import TOC from '@theme/TOC';
import ContentVisibility from '@theme/ContentVisibility';
import Link from '@docusaurus/Link';
import type {Props} from '@theme/BlogPostPage';
import type {BlogSidebar} from '@docusaurus/plugin-content-blog';

interface BlogPostPageContentProps {
  readonly sidebar: BlogSidebar;
  readonly children: ReactNode;
}

function BlogPostPageContent({children}: BlogPostPageContentProps): ReactNode {
  const {metadata, toc} = useBlogPost();
  const {nextItem, prevItem, frontMatter} = metadata;
  const {
    hide_table_of_contents: hideTableOfContents,
    toc_min_heading_level: tocMinHeadingLevel,
    toc_max_heading_level: tocMaxHeadingLevel,
  } = frontMatter;
  return (
    <BlogLayout
      sidebar={undefined}
      toc={
        !hideTableOfContents && toc.length > 0 ? (
          <TOC
            toc={toc}
            minHeadingLevel={tocMinHeadingLevel}
            maxHeadingLevel={tocMaxHeadingLevel}
          />
        ) : undefined
      }>
      <Link to="/blog" className="of-blog-back-link">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
          BACK TO BLOG
      </Link>

      <ContentVisibility metadata={metadata} />

      <BlogPostItem>{children}</BlogPostItem>

      <div className="of-blog-read-next-section">
          <div className="of-blog-section-title">READ NEXT</div>
          <div className="of-blog-grid">
              {prevItem && (
                 <Link to={prevItem.permalink} className="of-blog-card">
                    <div className="of-blog-card-content">
                        <div className="of-blog-date">PREVIOUS</div>
                        <h3 className="of-blog-card-title">{prevItem.title}</h3>
                        <div className="of-blog-view-more">VIEW POST <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></div>
                    </div>
                 </Link>
              )}
              {nextItem && (
                 <Link to={nextItem.permalink} className="of-blog-card">
                    <div className="of-blog-card-content">
                        <div className="of-blog-date">NEXT</div>
                        <h3 className="of-blog-card-title">{nextItem.title}</h3>
                        <div className="of-blog-view-more">VIEW POST <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></div>
                    </div>
                 </Link>
              )}
          </div>
      </div>
    </BlogLayout>
  );
}

export default function BlogPostPage(props: Props): ReactNode {
  const BlogPostContent = props.content;
  return (
    <BlogPostProvider content={props.content} isBlogPostPage>
      <HtmlClassNameProvider
        className={clsx(
          ThemeClassNames.wrapper.blogPages,
          ThemeClassNames.page.blogPostPage,
        )}>
        <BlogPostPageMetadata />
        <BlogPostPageStructuredData />
        <BlogPostPageContent sidebar={props.sidebar}>
          <BlogPostContent />
        </BlogPostPageContent>
      </HtmlClassNameProvider>
    </BlogPostProvider>
  );
}
