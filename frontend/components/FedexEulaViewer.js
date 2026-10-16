'use client';
import { useEffect, useRef, useState } from 'react';
import { FEDEX_EULA_PDF_URL, FEDEX_EULA_REVISION } from '@/lib/fedexCompliance';
import s from './FedexEulaViewer.module.css';

// Renders FedEx's EULA PDF page by page inside a scroll box (pdf.js), so the customer reads
// FedEx's exact document — including the revision footer on every page — and calls
// onReachedEnd() once they have scrolled to the end of the last page.
export default function FedexEulaViewer({ onReachedEnd, height = 360 }) {
  const boxRef = useRef(null);
  const pagesRef = useRef(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = '/legal/pdf.worker.min.mjs';
        const pdf = await pdfjs.getDocument(FEDEX_EULA_PDF_URL).promise;
        if (cancelled) return;
        setPageCount(pdf.numPages);
        const container = pagesRef.current;
        const width = container.clientWidth;
        const dpr = window.devicePixelRatio || 1;
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (width / base.width) * dpr });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.className = s.page;
          canvas.dataset.page = String(n);
          canvas.setAttribute('aria-label', `FedEx EULA page ${n} of ${pdf.numPages}`);
          container.appendChild(canvas);
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        }
      } catch (err) {
        console.error('[EULA] Could not render FedEx EULA:', err);
        if (!cancelled) setError('The FedEx EULA could not be displayed.');
      }
    })();
    return () => { cancelled = true; if (pagesRef.current) pagesRef.current.innerHTML = ''; };
  }, []);

  function handleScroll() {
    const el = boxRef.current;
    if (!el || !pageCount) return;
    const pages = pagesRef.current.querySelectorAll('canvas');
    const mid = el.scrollTop + el.clientHeight / 2;
    let visible = 1;
    pages.forEach((c) => { if (c.offsetTop <= mid) visible = Number(c.dataset.page); });
    setCurrentPage(visible);
    // Only the bottom of the LAST page counts — every page must have rendered first.
    if (!reachedEnd && pages.length === pageCount && el.scrollTop + el.clientHeight >= el.scrollHeight - 4) {
      setReachedEnd(true);
      onReachedEnd?.();
    }
  }

  return (
    <div className={s.wrap}>
      <div ref={boxRef} className={s.box} style={{ height }} onScroll={handleScroll} tabIndex={0} aria-label="FedEx End User License Agreement">
        <div ref={pagesRef} className={s.pages} />
        {!pageCount && !error && <div className={s.loading}>Loading the FedEx End User License Agreement…</div>}
        {error && (
          <div className={s.loading}>
            {error} <a href={FEDEX_EULA_PDF_URL} target="_blank" rel="noreferrer">Open the PDF</a>
          </div>
        )}
      </div>
      <div className={s.meta}>
        <span>{FEDEX_EULA_REVISION}</span>
        <span>
          {pageCount ? `Page ${currentPage} of ${pageCount}` : ''}
          {pageCount && !reachedEnd ? ' · scroll to the end of the last page to continue' : ''}
          {reachedEnd ? ' · end of agreement reached' : ''}
        </span>
      </div>
    </div>
  );
}
