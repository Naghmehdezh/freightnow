'use client';
import { useState } from 'react';

// Renders a carrier's official logo from /public/carrier-logos/<id>.svg.
// Drop each carrier's real brand asset there — never hand-draw or trace one.
// Falls back to a plain text label (no broken-image icon) until the file exists.
//
// Pass `chip` ({ bg, color, borderColor }) to render inside a padded, colored
// box — the color only shows behind the text fallback. Once a real logo loads,
// the box goes transparent so the logo isn't boxed in by a mismatched color card.
export default function CarrierLogo({ id, label, chip, className, style, fallbackStyle }) {
  const [failed, setFailed] = useState(false);

  if (!chip) {
    if (failed) {
      return (
        <span className={className} style={{ fontWeight: 600, ...fallbackStyle }}>
          {label}
        </span>
      );
    }
    return (
      <img
        src={`/carrier-logos/${id}.svg`}
        alt={label}
        className={className}
        style={style}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: failed ? chip.bg : 'transparent',
        border: failed ? `1.5px solid ${chip.borderColor}` : 'none',
        ...style,
      }}
    >
      {failed ? (
        <span style={{ fontWeight: 600, color: chip.color, ...fallbackStyle }}>{label}</span>
      ) : (
        <img
          src={`/carrier-logos/${id}.svg`}
          alt={label}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '6%', boxSizing: 'border-box' }}
        />
      )}
    </div>
  );
}
