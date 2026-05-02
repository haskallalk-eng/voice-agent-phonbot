import React, { useState, forwardRef } from 'react';
import { IconEye, IconEyeOff } from './PhonbotIcons.js';

/**
 * Drop-in replacement for `<input type="password">` with a persistent
 * show/hide toggle. The eye stays visible whether the field is empty,
 * focused, or filled — users keep the option to verify their typing
 * even after they finished. Pass `className` to style the input itself
 * (we add right-padding to make room for the eye); the wrapper sits
 * relative around it.
 *
 * Default: hidden (type="password"). Click eye → toggles to type="text".
 * Re-renders preserve focus + caret position because we're toggling
 * an attribute, not unmounting the element.
 */
export type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** Override the visible-toggle button's accessible label. */
  showLabel?: string;
  hideLabel?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className = '', showLabel = 'Passwort anzeigen', hideLabel = 'Passwort verbergen', ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  // Append right-padding so the eye doesn't overlap the typed value.
  // Caller's className wins for everything else (border, bg, focus ring, etc.)
  // — we only ensure pr-* is set if not already.
  const paddedClass = /\bpr-\d/.test(className) ? className : `${className} pr-11`;
  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? 'text' : 'password'}
        className={paddedClass}
        {...rest}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={visible ? hideLabel : showLabel}
        title={visible ? hideLabel : showLabel}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-0 top-0 h-full px-3 flex items-center justify-center text-white/40 hover:text-white/85 transition-colors cursor-pointer focus:outline-none focus-visible:text-white/85"
      >
        {visible ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>
    </div>
  );
});
