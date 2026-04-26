import { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  triggerLabel?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
};

export function Select(props: Props) {
  const { value, onChange, options, placeholder, name, id, className, triggerClassName, triggerStyle, triggerLabel, disabled, required, 'aria-label': ariaLabel } = props;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeaheadRef = useRef<{ buffer: string; timer: number | null }>({ buffer: '', timer: null });

  const selectedIndex = useMemo(() => options.findIndex((opt) => opt.value === value), [options, value]);
  const displayOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  function commit(index: number) {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    onChange(opt.value);
    setOpen(false);
    typeaheadRef.current.buffer = '';
    triggerRef.current?.focus();
  }

  function openMenu() {
    if (disabled) return;
    const start = selectedIndex >= 0 ? selectedIndex : options.findIndex((opt) => !opt.disabled);
    setActiveIndex(start);
    setOpen(true);
  }

  function typeahead(key: string) {
    const record = typeaheadRef.current;
    if (record.timer) window.clearTimeout(record.timer);
    record.buffer = (record.buffer + key).toLowerCase();
    const needle = record.buffer;
    const startAt = record.buffer.length === 1 ? (activeIndex + 1) % options.length : 0;
    let found = -1;
    for (let i = 0; i < options.length; i++) {
      const idx = (startAt + i) % options.length;
      if (options[idx].disabled) continue;
      if (options[idx].label.toLowerCase().startsWith(needle)) {
        found = idx;
        break;
      }
    }
    if (found >= 0) setActiveIndex(found);
    record.timer = window.setTimeout(() => {
      record.buffer = '';
      record.timer = null;
    }, 600);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openMenu();
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Open and typeahead in one step, like native selects do.
        openMenu();
        typeahead(event.key);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => {
        let next = current;
        for (let i = 0; i < options.length; i++) {
          next = (next + 1) % options.length;
          if (!options[next].disabled) return next;
        }
        return current;
      });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => {
        let next = current;
        for (let i = 0; i < options.length; i++) {
          next = (next - 1 + options.length) % options.length;
          if (!options[next].disabled) return next;
        }
        return current;
      });
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      const first = options.findIndex((opt) => !opt.disabled);
      if (first >= 0) setActiveIndex(first);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      let last = -1;
      for (let i = options.length - 1; i >= 0; i--)
        if (!options[i].disabled) {
          last = i;
          break;
        }
      if (last >= 0) setActiveIndex(last);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(activeIndex);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      typeahead(event.key);
    }
  }

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const belowSpace = window.innerHeight - rect.bottom;
    const aboveSpace = rect.top;
    const approxMenuHeight = Math.min(320, options.length * 36 + 8);
    if (belowSpace < approxMenuHeight && aboveSpace > belowSpace) setPlacement('up');
    else setPlacement('down');
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  useEffect(
    () => () => {
      if (typeaheadRef.current.timer) window.clearTimeout(typeaheadRef.current.timer);
    },
    []
  );

  const triggerContent: ReactNode = triggerLabel !== undefined ? triggerLabel : displayOption ? displayOption.label : <span className="pp-select-placeholder">{placeholder ?? 'Select…'}</span>;

  return (
    <div className={`pp-select ${open ? 'open' : ''} placement-${placement} ${className ?? ''}`} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        id={id}
        className={`pp-select-trigger ${triggerClassName ?? ''}`}
        style={triggerStyle}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={handleKeyDown}
      >
        <span className="pp-select-value">{triggerContent}</span>
        <span className="pp-select-chevron" aria-hidden="true">
          <svg width="10" height="6" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 1l5 5 5-5" />
          </svg>
        </span>
      </button>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {open ? (
        <ul ref={listRef} role="listbox" className="pp-select-menu" tabIndex={-1}>
          {options.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                aria-disabled={opt.disabled || undefined}
                data-index={index}
                className={`pp-select-option ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
                onMouseEnter={() => !opt.disabled && setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(index);
                }}
              >
                <span className="pp-select-option-main">
                  <span className="pp-select-option-label">{opt.label}</span>
                  {opt.description ? <span className="pp-select-option-description">{opt.description}</span> : null}
                </span>
                {isSelected ? (
                  <span className="pp-select-option-check" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 7.5l3.5 3.5L12 3.5" />
                    </svg>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

type ComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  name?: string;
  id?: string;
  className?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-label'?: string;
  /**
   * How suggestions are filtered as the user types. Defaults to case-insensitive substring match
   * on label + value.
   */
  filter?: (option: SelectOption, query: string) => boolean;
};

function defaultComboboxFilter(option: SelectOption, query: string): boolean {
  const needle = query.toLowerCase();
  return option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle);
}

/**
 * Typeable select: user can pick from the suggestion list or enter a freeform value. Keyboard
 * keeps parity with Select (ArrowUp/Down + Home/End + Enter + Escape); Enter with no highlighted
 * suggestion commits whatever text is in the input. Escape reverts to the last committed value
 * without closing the dialog that hosts the combobox.
 */
export function Combobox(props: ComboboxProps) {
  const { value, onChange, options, placeholder, name, id, className, disabled, required, 'aria-label': ariaLabel } = props;
  const filter = props.filter ?? defaultComboboxFilter;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<'down' | 'up'>('down');
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const skipBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const filteredOptions = useMemo(() => {
    const query = draft.trim();
    if (!query || query === value) return options.slice();
    return options.filter((opt) => filter(opt, query));
  }, [options, draft, value, filter]);

  useEffect(() => {
    if (!open) return;
    if (filteredOptions.length === 0) {
      setActiveIndex(-1);
      return;
    }
    const exactIndex = filteredOptions.findIndex((opt) => opt.value === draft);
    setActiveIndex(exactIndex >= 0 ? exactIndex : 0);
  }, [open, filteredOptions, draft]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const belowSpace = window.innerHeight - rect.bottom;
    const aboveSpace = rect.top;
    const approxMenuHeight = Math.min(320, filteredOptions.length * 36 + 8);
    if (belowSpace < approxMenuHeight && aboveSpace > belowSpace) setPlacement('up');
    else setPlacement('down');
  }, [open, filteredOptions.length]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLLIElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  function commitValue(next: string) {
    setDraft(next);
    if (next !== value) onChange(next);
    setOpen(false);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!filteredOptions.length) return;
      setActiveIndex((current) => (current + 1) % filteredOptions.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (!filteredOptions.length) return;
      setActiveIndex((current) => (current - 1 + filteredOptions.length) % filteredOptions.length);
      return;
    }
    if (event.key === 'Home' && open && filteredOptions.length) {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }
    if (event.key === 'End' && open && filteredOptions.length) {
      event.preventDefault();
      setActiveIndex(filteredOptions.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const picked = open && activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
      commitValue(picked ? picked.value : draft);
      return;
    }
    if (event.key === 'Escape') {
      if (!open && draft === value) return;
      event.preventDefault();
      setDraft(value);
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      if (draft !== value) commitValue(draft);
      else setOpen(false);
    }
  }

  return (
    <div className={`pp-select pp-combobox ${open ? 'open' : ''} placement-${placement} ${className ?? ''}`} ref={rootRef}>
      <input
        type="text"
        ref={inputRef}
        id={id}
        name={name}
        className="pp-select-trigger pp-combobox-input"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-haspopup="listbox"
        onChange={(event) => {
          setDraft(event.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled) setOpen(true);
        }}
        onClick={() => {
          if (!disabled) setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (skipBlurCommitRef.current) {
            skipBlurCommitRef.current = false;
            return;
          }
          if (draft !== value) onChange(draft);
          setOpen(false);
        }}
      />
      <span className="pp-select-chevron" aria-hidden="true">
        <svg width="10" height="6" viewBox="0 0 12 7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 1l5 5 5-5" />
        </svg>
      </span>
      {open && filteredOptions.length ? (
        <ul ref={listRef} role="listbox" className="pp-select-menu" tabIndex={-1}>
          {filteredOptions.map((opt, index) => {
            const isSelected = opt.value === value;
            const isActive = index === activeIndex;
            return (
              <li
                key={opt.value}
                role="option"
                aria-selected={isSelected}
                data-index={index}
                className={`pp-select-option ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''}`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  skipBlurCommitRef.current = true;
                  commitValue(opt.value);
                  inputRef.current?.focus();
                }}
              >
                <span className="pp-select-option-main">
                  <span className="pp-select-option-label">{opt.label}</span>
                  {opt.description ? <span className="pp-select-option-description">{opt.description}</span> : null}
                </span>
                {isSelected ? (
                  <span className="pp-select-option-check" aria-hidden="true">
                    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 7.5l3.5 3.5L12 3.5" />
                    </svg>
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
