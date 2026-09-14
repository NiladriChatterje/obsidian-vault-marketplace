'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ErrorBox, Loading, VaultTile } from '@/components/ui';
import type { Vault } from '@/types';

interface Props {
  vaults: Vault[];
  /** Whether more pages exist; when true a trailing row shows the loader and asks for them. */
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  onLoadMore: () => void;
}

/**
 * The browse grid, windowed so the page holds only the rows near the viewport however long the
 * list grows. Rows are virtualised rather than tiles: each row is a normal `.grid`, so the CSS keeps
 * deciding how many columns fit, and a hidden probe grid is read to learn that count for chunking.
 * Scrolling near the end asks for the next page, and the loader row reports fetch errors with a retry.
 */
export function VaultGrid({ vaults, hasMore, loading, error, onLoadMore }: Props) {
  const probeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [gap, setGap] = useState(16);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    const list = listRef.current;
    if (!probe || !list) return;
    const measure = () => {
      const cs = getComputedStyle(probe);
      setCols(Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length));
      setGap(parseFloat(cs.rowGap) || 16);
      setScrollMargin(list.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(probe);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const rows = Math.ceil(vaults.length / cols);
  const count = rows + (hasMore ? 1 : 0);
  const virtualizer = useWindowVirtualizer({
    count,
    estimateSize: () => 280,
    overscan: 2,
    gap,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const lastIndex = virtualRows[virtualRows.length - 1]?.index ?? -1;

  useEffect(() => {
    if (hasMore && !loading && !error && lastIndex >= rows - 2) onLoadMore();
  }, [hasMore, loading, error, lastIndex, rows, onLoadMore]);

  return (
    <div>
      <div ref={probeRef} className="grid" aria-hidden="true" style={{ height: 0, overflow: 'hidden' }} />
      <div ref={listRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {virtualRows.map((row) => (
          <div
            key={row.key}
            data-index={row.index}
            ref={virtualizer.measureElement}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${row.start - scrollMargin}px)` }}
          >
            {row.index >= rows ? (
              error ? (
                <ErrorBox message={error} onRetry={onLoadMore} />
              ) : (
                <Loading label="Loading more…" />
              )
            ) : (
              <div className="grid">
                {vaults.slice(row.index * cols, (row.index + 1) * cols).map((v) => (
                  <VaultTile key={v.id} vault={v} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
