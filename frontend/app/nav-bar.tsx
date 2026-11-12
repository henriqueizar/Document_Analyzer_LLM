'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';

/** Top bar with a back button, shown on every page except the home page. */
export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();

  // No back button on the home page or on the screens shown before signing in.
  if (pathname === '/' || pathname === '/login' || pathname === '/setup') return null;

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
      <button type="button" onClick={goBack} aria-label={t('common.goBack')}>
        {t('common.back')}
      </button>
      <Link href="/">Document LLM Analyzer</Link>
    </nav>
  );
}
