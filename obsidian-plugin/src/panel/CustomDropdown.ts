import { Menu } from "obsidian";

/**
 * A dropdown that, when opened, renders a native Obsidian `Menu` — the exact
 * same widget used by the "+" command list — so the choices share the same
 * styling (checkmarks, separators, fonts) as the rest of the app.
 */
export interface DropdownOption {
  label: string;
  value: string;
  /** Optional group heading shown when grouping is enabled. */
  group?: string;
}

export interface CustomDropdownOptions {
  placeholder?: string;
  options?: DropdownOption[];
  value?: string;
  /** Width hint, e.g. "150px" (controls the trigger button's max width). */
  maxWidth?: string;
  onChange?: (value: string, label: string) => void | Promise<void>;
  onOpen?: () => void;
}

export class CustomDropdown {
  private host: HTMLDivElement;
  private btn: HTMLButtonElement;
  private value: string | null;
  private options: DropdownOption[];
  private onChange?: (value: string, label: string) => void | Promise<void>;
  private onOpen?: () => void;
  private placeholder: string;
  private isOpen = false;

  constructor(
    root: HTMLElement,
    opts: CustomDropdownOptions
  ) {
    this.placeholder = opts.placeholder ?? "…";
    this.options = opts.options ?? [];
    this.value = opts.value ?? null;
    this.onChange = opts.onChange;
    this.onOpen = opts.onOpen;

    this.host = root.createDiv({ cls: "obdsh-dd" });
    if (opts.maxWidth) this.host.style.maxWidth = opts.maxWidth;

    this.btn = this.host.createEl("button", { cls: "obdsh-dd-btn", type: "button" });
    this.btn.appendChild(document.createTextNode(this.labelFor(this.value)));
    this.btn.appendChild(this.buildCaret());
    this.btn.addEventListener("click", () => this.toggle());
  }

  get valueNow(): string | null {
    return this.value;
  }

  setOptions(options: DropdownOption[], value?: string | null): void {
    this.options = options;
    if (value !== undefined) this.value = value;
    this.refreshBtn();
  }

  setHidden(hidden: boolean): void {
    this.host.style.display = hidden ? "none" : "";
  }

  setValue(value: string | null): void {
    this.value = value;
    this.refreshBtn();
  }

  destroy(): void {
    this.host.remove();
  }

  private refreshBtn(): void {
    this.btn.textContent = "";
    this.btn.appendChild(document.createTextNode(this.labelFor(this.value)));
    this.btn.appendChild(this.buildCaret());
  }

  private buildCaret(): HTMLSpanElement {
    const c = document.createElement("span");
    c.className = "obdsh-dd-caret";
    c.textContent = "▾";
    return c;
  }

  private labelFor(value: string | null): string {
    if (value == null) return this.placeholder;
    const hit = this.options.find((o) => o.value === value);
    return hit ? hit.label : value;
  }

  private toggle(): void {
    if (this.isOpen) return;
    if (this.options.length === 0) return;
    this.openMenu();
  }

  /** Open a native Obsidian Menu below the trigger button. */
  private openMenu(): void {
    const menu = new Menu();
    // No icon gutter on the left — keeps option labels flush left.
    menu.setNoIcon();
    this.isOpen = true;

    let lastGroup: string | undefined;
    for (const o of this.options) {
      const g = o.group ?? "__";
      if (o.group && lastGroup !== undefined && lastGroup !== g) {
        menu.addSeparator();
      }
      lastGroup = g;
      menu.addItem((item) => {
        item.setTitle(o.label);
        item.onClick(() => this.select(o, menu));
      });
    }

    menu.onHide(() => {
      this.isOpen = false;
    });

    const rect = this.btn.getBoundingClientRect();
    if (rect && rect.width > 0) {
      menu.showAtPosition({ x: rect.left, y: rect.bottom, overlap: false });
      // Re-position ABOVE the button, aligned to its right edge, matching its
      // width. A dedicated class lets the CSS shrink the font / allow wrapping
      // so the content fits the narrowed width instead of truncating.
      requestAnimationFrame(() => {
        const dom = (menu as unknown as { dom?: HTMLElement }).dom;
        if (dom && dom.isConnected) {
          const el = dom;
          el.classList.add("obdsh-dd-open");
          el.style.position = "fixed";
          el.style.width = `${rect.width}px`;
          el.style.right = `${Math.max(0, window.innerWidth - rect.right)}px`;
          el.style.top = `${Math.max(0, rect.top - el.offsetHeight - 6)}px`;
          el.style.bottom = "auto";
          el.style.left = "auto";
        }
      });
    } else {
      const h = this.host.getBoundingClientRect();
      menu.showAtPosition({ x: h.left, y: h.bottom });
    }
    this.onOpen?.();
  }

  private select(o: DropdownOption, menu: Menu): void {
    this.value = o.value;
    this.refreshBtn();
    menu.close();
    void this.onChange?.(o.value, o.label);
  }
}
