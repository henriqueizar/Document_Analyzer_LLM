'use client';

import { useEffect, useState } from 'react';

/**
 * "." -> ".." -> "..." while something is in progress, so the screen never
 * looks frozen. Fixed width, so the text around it does not jump.
 */
export default function LoadingDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const interval = setInterval(() => setCount((c) => (c % 3) + 1), 450);
    return () => clearInterval(interval);
  }, []);
  return (
    <span className="dots" aria-hidden="true">
      {'.'.repeat(count)}
    </span>
  );
}
