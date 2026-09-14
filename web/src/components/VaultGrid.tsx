'use client';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ErrorBox, Loading, VaultTile } from '@/components/ui';
import type { PagedVaults } from '@/hooks/usePagedVaults';

/**
 * The browse grid, windowed two ways: the DOM holds only the rows near the viewport, and the page
 * store behind `list` holds only the vaults near it, refetching a dropped page if the user scrolls
 * back. Rows are virtualised rather than tiles: each row is a normal `.grid`, so the CSS keeps
 * deciding how many columns fit, and a hidden probe grid is read to learn that count for chunking.
 * A position whose page is not in memory shows a skeleton tile until it arrives. A trailing row
 * carries the loader while more pages exist, or the error and a retry when a fetch failed.
 */
export function VaultGrid({ list }: { list: PagedVaults }) {
  const probeRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(1);
  const [gap, setGap] = useState(16);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const probe = probeRef.current;
    const el = listRef.current;
    if (!probe || !el) return;
    const measure = () => {
      const cs = getComputedStyle(probe);
      setCols(Math.max(1, cs.gridTemplateColumns.split(' ').filter(Boolean).length));
      setGap(parseFloat(cs.rowGap) || 16);
      setScrollMargin(el.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(probe);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);

  const rows = Math.ceil(list.total / cols);
  const tail = !list.done || list.error ? 1 : 0;
  const virtualizer = useWindowVirtualizer({
    count: rows + tail,
    estimateSize: () => 280,
    overscan: 2,
    gap,
    scrollMargin,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const firstIndex = (virtualRows[0]?.index ?? 0) * cols;
  const lastIndex = ((virtualRows[virtualRows.length - 1]?.index ?? 0) + 1) * cols - 1;

  // Tell the store what is on screen; it fetches what those rows need and drops what is far away.
  // Runs again when the total grows so the next page is requested as soon as the frontier is near.
  const { setViewport, total } = list;
  useEffect(() => setViewport(firstIndex, lastIndex), [setViewport, firstIndex, lastIndex, total]);

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
              list.error ? (
                <ErrorBox message={list.error} onRetry={list.retry} />
              ) : (
                <Loading label="Loading more…" />
              )
            ) : (
              <div className="grid">
                {Array.from({ length: Math.min(cols, list.total - row.index * cols) }, (_, i) => {
                  const index = row.index * cols + i;
                  const vault = list.itemAt(index);
                  return vault ? <VaultTile key={vault.id} vault={vault} /> : <SkeletonTile key={index} />;
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Holds a tile's place while its page is fetched, so rows keep their height and nothing jumps. */
function SkeletonTile() {
  return (
    <div className="tile skeleton" aria-hidden="true">
      <div className="cover" />
      <div>
        <div className="skeleton-line" style={{ width: '70%' }} />
        <div className="skeleton-line" style={{ width: '40%' }} />
      </div>
      <div className="tile-meta">
        <div className="skeleton-line" style={{ width: '35%' }} />
        <div className="skeleton-line" style={{ width: '20%' }} />
      </div>
    </div>
  );
}
