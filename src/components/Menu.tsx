"use client";

import clsx from "clsx";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

const MenuContext = createContext<{ close: (restoreFocus?: boolean) => void } | null>(null);

const items = (menu: HTMLElement | null) => [
  ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
];

/**
 * Button-triggered menu with menu/menuitem roles. Closes on outside click, Esc, Tab and after
 * choosing an item; Esc and choosing return focus to the trigger. Arrow keys, Home and End move
 * between items.
 */
export function Menu({
  label,
  children,
  triggerClassName,
  menuClassName,
  disabled = false,
  "aria-label": ariaLabel,
}: {
  label: ReactNode;
  children: ReactNode;
  triggerClassName?: string;
  menuClassName?: string;
  /** Keeps the trigger focusable (focus can return to it) but stops it from opening. */
  disabled?: boolean;
  "aria-label"?: string;
}) {
  // Which item to focus when the menu opens; null while closed.
  const [openAt, setOpenAt] = useState<"first" | "last" | null>(null);
  const open = openAt !== null;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const triggerId = useId();

  const close = (restoreFocus = true) => {
    setOpenAt(null);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!openAt) return;
    const list = items(menuRef.current);
    (openAt === "first" ? list[0] : list.at(-1))?.focus();

    // An outside click moves focus wherever the user clicked, so don't pull it back.
    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpenAt(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [openAt]);

  const onMenuKeyDown = (e: KeyboardEvent) => {
    const list = items(menuRef.current);
    const index = list.indexOf(document.activeElement as HTMLElement);
    const move = (to: number) => {
      e.preventDefault();
      list[(to + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") move(index + 1);
    else if (e.key === "ArrowUp") move(index < 0 ? -1 : index - 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(-1);
    else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") close(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={triggerClassName}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (open) close(false);
          else if (!disabled) setOpenAt("first");
        }}
        onKeyDown={(e) => {
          if (disabled || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          setOpenAt(e.key === "ArrowDown" ? "first" : "last");
        }}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
          className={clsx(
            "absolute right-0 z-10 mt-1 rounded-xl border border-line bg-surface p-1 shadow-lg",
            menuClassName,
          )}
        >
          <MenuContext value={{ close }}>{children}</MenuContext>
        </div>
      )}
    </div>
  );
}

/** A menu entry. Choosing it closes the menu and returns focus to the trigger before `onSelect` runs. */
export function MenuItem({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: ReactNode;
  onSelect: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const menu = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      disabled={disabled}
      className={clsx("btn-ghost w-full justify-start", className)}
      onClick={() => {
        menu?.close();
        onSelect();
      }}
    >
      {children}
    </button>
  );
}
