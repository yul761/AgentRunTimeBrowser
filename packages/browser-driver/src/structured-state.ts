import type { StructuredState, Target } from "@arb/schemas";

export interface StructuredStateMeta {
  sessionId: string;
  pageId: string;
}

export function buildStructuredStateFromDocument(document: Document, meta: StructuredStateMeta): StructuredState {
  const maxItems = 30;
  const maxTextLength = 160;

  const truncate = (value: string, maxLength = maxTextLength) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
  };

  const cssEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/#/g, "\\#");

  const isVisible = (element: Element) => {
    const htmlElement = element as HTMLElement;
    const style = document.defaultView?.getComputedStyle(htmlElement);
    if (element.getAttribute("aria-hidden") === "true" || htmlElement.hidden) {
      return false;
    }
    if (!style) {
      return true;
    }
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };

  const textOf = (element: Element | null | undefined) => {
    if (!element) {
      return "";
    }
    const htmlElement = element as HTMLInputElement;
    return (
      truncate(element.getAttribute("aria-label") ?? "") ||
      truncate(element.getAttribute("title") ?? "") ||
      truncate(htmlElement.value ?? "") ||
      truncate(element.textContent ?? "")
    );
  };

  const labelledBy = (element: Element) => {
    const idRefs = element.getAttribute("aria-labelledby");
    if (!idRefs) {
      return "";
    }
    return idRefs
      .split(/\s+/)
      .map((id) => textOf(document.getElementById(id)))
      .filter(Boolean)
      .join(" ");
  };

  const controlLabel = (element: Element) => {
    const htmlElement = element as HTMLInputElement;
    const id = element.getAttribute("id");
    const explicitLabel = id ? textOf(document.querySelector(`label[for="${cssEscape(id)}"]`)) : "";
    const parentLabel = textOf(element.closest("label"));
    return (
      truncate(element.getAttribute("aria-label") ?? "") ||
      truncate(labelledBy(element)) ||
      explicitLabel ||
      parentLabel ||
      truncate(element.getAttribute("placeholder") ?? "") ||
      truncate(htmlElement.name ?? "") ||
      truncate(id ?? "")
    );
  };

  const stableCssTarget = (element: Element): Target => {
    const testId = element.getAttribute("data-testid");
    if (testId) {
      return { kind: "testId", value: testId };
    }
    const id = element.getAttribute("id");
    if (id) {
      return { kind: "css", selector: `#${cssEscape(id)}`, internal: true };
    }
    const name = element.getAttribute("name");
    if (name) {
      return { kind: "css", selector: `[name="${cssEscape(name)}"]`, internal: true };
    }
    return { kind: "css", selector: element.tagName.toLowerCase(), internal: true };
  };

  const buttonNodes = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
    .filter(isVisible)
    .slice(0, maxItems);

  const buttons = buttonNodes.map((button, index) => {
    const name = textOf(button) || `Button ${index + 1}`;
    return {
      id: `button-${index}`,
      role: button.getAttribute("role") ?? "button",
      name
    };
  });

  const inputNodes = [...document.querySelectorAll("input:not([type='hidden']), textarea, select")]
    .filter(isVisible)
    .slice(0, maxItems);

  const inputs = inputNodes.map((input, index) => ({
    id: `input-${index}`,
    label: controlLabel(input) || `Input ${index + 1}`,
    type: input.getAttribute("type") ?? input.tagName.toLowerCase()
  }));

  const linkNodes = [...document.querySelectorAll("a[href]")]
    .filter(isVisible)
    .slice(0, maxItems);

  const links = linkNodes.map((link, index) => ({
    id: `link-${index}`,
    name: textOf(link) || link.getAttribute("href") || `Link ${index + 1}`,
    href: link.getAttribute("href") ?? undefined
  }));

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter(isVisible)
    .slice(0, maxItems)
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      text: textOf(heading)
    }))
    .filter((heading) => heading.text.length > 0);

  const forms = [...document.querySelectorAll("form")]
    .filter(isVisible)
    .slice(0, maxItems)
    .map((form, index) => ({
      id: form.getAttribute("id") || `form-${index}`,
      name:
        truncate(form.getAttribute("aria-label") ?? "") ||
        truncate(form.getAttribute("name") ?? "") ||
        truncate(form.getAttribute("id") ?? "") ||
        `Form ${index + 1}`
    }));

  const bodyText = ((document.body as HTMLElement | null)?.innerText ?? document.body?.textContent ?? "")
    .split(/\n+/)
    .map((line) => truncate(line))
    .filter(Boolean)
    .filter((line, index, lines) => lines.indexOf(line) === index)
    .slice(0, 12);

  const availableActions = [
    ...buttonNodes.map((button, index) => {
      const name = buttons[index]?.name ?? `Button ${index + 1}`;
      return {
        id: `action-click-button-${index}`,
        action: "click" as const,
        target: name ? ({ kind: "role", role: "button", name } as Target) : stableCssTarget(button),
        description: `Click ${name}`
      };
    }),
    ...inputNodes.map((input, index) => {
      const label = inputs[index]?.label ?? `Input ${index + 1}`;
      return {
        id: `action-fill-input-${index}`,
        action: "fill" as const,
        target: label ? ({ kind: "label", value: label } as Target) : stableCssTarget(input),
        description: `Fill ${label}`
      };
    }),
    ...linkNodes.map((link, index) => {
      const name = links[index]?.name ?? `Link ${index + 1}`;
      return {
        id: `action-click-link-${index}`,
        action: "click" as const,
        target: name ? ({ kind: "role", role: "link", name } as Target) : stableCssTarget(link),
        description: `Open ${name}`
      };
    })
  ].slice(0, maxItems);

  return {
    sessionId: meta.sessionId,
    pageId: meta.pageId,
    url: document.location.href,
    title: document.title,
    buttons,
    inputs,
    links,
    headings,
    forms,
    visibleTextSummary: bodyText,
    availableActions,
    timestamp: new Date().toISOString()
  };
}
