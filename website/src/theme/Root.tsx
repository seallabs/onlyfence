import type {ReactNode} from 'react';
import ScrollToTop from '@site/src/components/ScrollToTop';

export default function Root({children}: {children: ReactNode}): ReactNode {
  return (
    <>
      {children}
      <ScrollToTop />
    </>
  );
}
