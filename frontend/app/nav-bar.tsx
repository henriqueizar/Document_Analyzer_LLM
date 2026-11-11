'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

/** Top bar with a back button, shown on every page except the home page. */
export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === '/') return null;

  function goBack() {
    // Opened directly (new tab, bookmark): there is no in-app page to go back to.
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  }

  return (
    <nav className="nav">
      <button type="button" onClick={goBack} aria-label="Go back">
        ← Back
      </button>
      <Link href="/">Document LLM Analyzer</Link>
    </nav>
  );
}
