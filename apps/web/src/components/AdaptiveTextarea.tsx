import React, { useLayoutEffect, useRef } from 'react';

/**
 * Auto-resizing <textarea> — grows with its content so nothing scrolls out
 * of view while the user is editing. Named the "adaptives Text-Feld" in the
 * product. Use wherever a `<TextArea>` would benefit from always showing
 * the full text without manual rows={} tuning.
 *
 * Implementation: on every value change we reset height → measure
 * scrollHeight → set that as height. useLayoutEffect (not useEffect) so
 * the resize happens in the same paint as the text change — no flicker.
 *
 * Exposes the underlying textarea via ref-forwarding so parents can still
 * imperatively focus or select.
 */

type Props = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'style'> & {
  /** Minimum rows the textarea can shrink down to. Default 2. */
  minRows?: number;
  /** Maximum pixel height before scrolling kicks in. Default unbounded. */
  maxHeightPx?: number;
  style?: React.CSSProperties;
};

export const AdaptiveTextarea = React.forwardRef<HTMLTextAreaElement, Props>(
  function AdaptiveTextarea({ value, minRows = 2, maxHeightPx, style, onChange, ...rest }, forwardedRef) {
    const innerRef = useRef<HTMLTextAreaElement>(null);

    // Merge forwarded ref with the inner ref so the resize logic still has
    // direct access to the DOM node.
    useLayoutEffect(() => {
      if (typeof forwardedRef === 'function') forwardedRef(innerRef.current);
      else if (forwardedRef) forwardedRef.current = innerRef.current;
    });

    useLayoutEffect(() => {
      const el = innerRef.current;
      if (!el) return;
      // Reset to `auto` so scrollHeight reflects the content, not the
      // previous height. Then read scrollHeight + set as explicit height.
      el.style.height = 'auto';
      const next = maxHeightPx && el.scrollHeight > maxHeightPx ? maxHeightPx : el.scrollHeight;
      el.style.height = `${next}px`;
      el.style.overflowY = maxHeightPx && el.scrollHeight > maxHeightPx ? 'auto' : 'hidden';
    }, [value, maxHeightPx]);

    return (
      <textarea
        ref={innerRef}
        value={value}
        rows={minRows}
        onChange={onChange}
        style={{ resize: 'none', ...style }}
        {...rest}
      />
    );
  },
);
