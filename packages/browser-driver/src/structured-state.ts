import type { StructuredState, Target } from "@arb/schemas";

export interface StructuredStateMeta {
  sessionId: string;
  pageId: string;
}

export function buildStructuredStateFromDocument(document: Document, meta: StructuredStateMeta): StructuredState {
  const maxItems = 30;
  const maxTextLength = 160;
  const elementIdentity = new Map<Element, ReturnType<typeof identityFor>>();

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

  const hash = (value: string) => {
    let hashValue = 0;
    for (let index = 0; index < value.length; index += 1) {
      hashValue = (hashValue << 5) - hashValue + value.charCodeAt(index);
      hashValue |= 0;
    }
    return Math.abs(hashValue).toString(36);
  };

  const lineageFor = (element: Element) => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current !== document.body && parts.length < 5) {
      const tag = current.tagName.toLowerCase();
      const role = current.getAttribute("role");
      const id = current.getAttribute("id");
      parts.unshift([tag, role ? `role=${role}` : "", id ? `id=${id}` : ""].filter(Boolean).join("#"));
      current = current.parentElement;
    }
    return parts;
  };

  function identityFor(element: Element, kind: string, label: string, index: number) {
    const lineage = lineageFor(element);
    const testId = element.getAttribute("data-testid") ?? "";
    const id = element.getAttribute("id") ?? "";
    const name = element.getAttribute("name") ?? "";
    const role = element.getAttribute("role") ?? kind;
    const locatorFingerprint =
      testId ||
      id ||
      name ||
      `${role}:${truncate(label, 80).toLowerCase()}:${lineage.join(">")}`;
    const semanticElementId = `sem-${kind}-${hash(`${locatorFingerprint}:${lineage.join(">")}`)}`;
    return {
      elementInstanceId: `inst-${meta.pageId}-${kind}-${index}-${hash(lineage.join(">"))}`,
      semanticElementId,
      locatorFingerprint,
      lineage
    };
  }

  const assignIdentity = (element: Element, kind: string, label: string, index: number) => {
    const existing = elementIdentity.get(element);
    if (existing) {
      return existing;
    }
    const identity = identityFor(element, kind, label, index);
    elementIdentity.set(element, identity);
    return identity;
  };

  const buttonNodes = [...document.querySelectorAll("button, [role='button'], input[type='button'], input[type='submit']")]
    .filter(isVisible)
    .slice(0, maxItems);

  const buttons = buttonNodes.map((button, index) => {
    const name = textOf(button) || `Button ${index + 1}`;
    return {
      id: `button-${index}`,
      ...assignIdentity(button, "button", name, index),
      role: button.getAttribute("role") ?? "button",
      name
    };
  });

  const inputNodes = [...document.querySelectorAll("input:not([type='hidden']), textarea, select")]
    .filter(isVisible)
    .slice(0, maxItems);

  const inputs = inputNodes.map((input, index) => ({
    id: `input-${index}`,
    ...assignIdentity(input, "input", controlLabel(input) || `Input ${index + 1}`, index),
    label: controlLabel(input) || `Input ${index + 1}`,
    type: input.getAttribute("type") ?? input.tagName.toLowerCase()
  }));

  const linkNodes = [...document.querySelectorAll("a[href]")]
    .filter(isVisible)
    .slice(0, maxItems);

  const links = linkNodes.map((link, index) => ({
    id: `link-${index}`,
    ...assignIdentity(link, "link", textOf(link) || link.getAttribute("href") || `Link ${index + 1}`, index),
    name: textOf(link) || link.getAttribute("href") || `Link ${index + 1}`,
    href: link.getAttribute("href") ?? undefined
  }));

  const headings = [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter(isVisible)
    .slice(0, maxItems)
    .map((heading, index) => ({
      id: `heading-${index}`,
      ...assignIdentity(heading, "heading", textOf(heading) || `Heading ${index + 1}`, index),
      level: Number(heading.tagName.slice(1)),
      text: textOf(heading)
    }))
    .filter((heading) => heading.text.length > 0);

  const forms = [...document.querySelectorAll("form")]
    .filter(isVisible)
    .slice(0, maxItems)
    .map((form, index) => ({
      id: form.getAttribute("id") || `form-${index}`,
      ...assignIdentity(form, "form", textOf(form) || form.getAttribute("aria-label") || `Form ${index + 1}`, index),
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

  const actionGraph = {
    actions: [
      ...buttonNodes.map((button, index) => {
        const name = buttons[index]?.name ?? `Button ${index + 1}`;
        const inDialog = Boolean(button.closest("dialog, [role='dialog'], [aria-modal='true']"));
        const isDismiss = /close|dismiss|cancel|esc/i.test(name);
        const isSubmit = (button as HTMLButtonElement).type === "submit" || button.getAttribute("type") === "submit";
        return {
          actionId: `ag-button-${buttons[index]?.semanticElementId ?? index}`,
          kind: inDialog && isDismiss ? ("dismiss_dialog" as const) : isSubmit ? ("submit_form" as const) : ("click" as const),
          label: name,
          targetElementId: buttons[index]?.semanticElementId,
          preconditions: ["target_visible"],
          effects: isSubmit ? ["form_may_submit", "page_may_navigate"] : ["element_activated"],
          confidence: isSubmit || isDismiss ? 0.84 : 0.78
        };
      }),
      ...inputNodes.map((input, index) => {
        const label = inputs[index]?.label ?? `Input ${index + 1}`;
        const type = input.getAttribute("type") ?? input.tagName.toLowerCase();
        return {
          actionId: `ag-input-${inputs[index]?.semanticElementId ?? index}`,
          kind: type === "checkbox" || type === "radio" ? ("toggle" as const) : ("focus" as const),
          label,
          targetElementId: inputs[index]?.semanticElementId,
          preconditions: ["target_visible", "target_enabled"],
          effects: type === "checkbox" || type === "radio" ? ["input_checked_state_may_change"] : ["input_ready_for_text"],
          confidence: 0.82
        };
      }),
      ...linkNodes.map((link, index) => {
        const name = links[index]?.name ?? `Link ${index + 1}`;
        const isDownload = link.hasAttribute("download");
        return {
          actionId: `ag-link-${links[index]?.semanticElementId ?? index}`,
          kind: isDownload ? ("download" as const) : ("open_link" as const),
          label: name,
          targetElementId: links[index]?.semanticElementId,
          preconditions: ["target_visible"],
          effects: isDownload ? ["download_may_start"] : ["url_may_change", "page_may_navigate"],
          confidence: 0.86
        };
      })
    ].slice(0, maxItems * 2)
  };

  const regionFromElement = (
    regionElement: Element,
    kind: StructuredState["regions"][number]["kind"],
    index: number,
    fallbackTitle: string
  ) => {
    const regionDescendants = [regionElement, ...regionElement.querySelectorAll("*")];
    const elementIds = [
      ...new Set(
        regionDescendants
          .map((element) => elementIdentity.get(element)?.semanticElementId)
          .filter((value): value is string => Boolean(value))
      )
    ].slice(0, maxItems);
    const primaryActions = actionGraph.actions
      .filter((action) => action.targetElementId && elementIds.includes(action.targetElementId))
      .map((action) => action.actionId)
      .slice(0, 8);
    return {
      regionId: `region-${kind}-${index}-${hash(textOf(regionElement) || fallbackTitle)}`,
      kind,
      title: textOf(regionElement) || fallbackTitle,
      primaryActions,
      elements: elementIds
    };
  };

  const formRegions = [...document.querySelectorAll("form")]
    .filter(isVisible)
    .slice(0, 10)
    .map((form, index) => {
      const lower = `${textOf(form)} ${form.innerHTML}`.toLowerCase();
      const kind = lower.includes("password") || lower.includes("email") || lower.includes("sign in")
        ? ("auth_form" as const)
        : lower.includes("search") || lower.includes('type="search"')
          ? ("search_interface" as const)
          : ("primary_content" as const);
      return regionFromElement(form, kind, index, kind === "auth_form" ? "Authentication form" : "Form");
    });

  const navRegions = [...document.querySelectorAll("nav, [role='navigation']")]
    .filter(isVisible)
    .slice(0, 5)
    .map((nav, index) => regionFromElement(nav, "navigation_bar", index, "Navigation"));

  const dialogRegions = [...document.querySelectorAll("dialog, [role='dialog'], [aria-modal='true']")]
    .filter(isVisible)
    .slice(0, 5)
    .map((dialog, index) => regionFromElement(dialog, "modal_dialog", index, "Dialog"));

  const resultsRegions = [...document.querySelectorAll("[role='list'], ol, ul, [data-testid*='result'], [class*='result']")]
    .filter(isVisible)
    .slice(0, 5)
    .map((results, index) => regionFromElement(results, "results_list", index, "Results"));

  const mainElement = document.querySelector("main, [role='main']") ?? document.body;
  const primaryRegion = mainElement ? [regionFromElement(mainElement, "primary_content", 0, document.title || "Primary content")] : [];

  const regions = [...formRegions, ...navRegions, ...dialogRegions, ...resultsRegions, ...primaryRegion].slice(0, maxItems);

  const stateFingerprint = hash(
    [
      document.location.href,
      document.title,
      buttons.map((button) => button.semanticElementId).join(","),
      inputs.map((input) => input.semanticElementId).join(","),
      links.map((link) => link.semanticElementId).join(","),
      bodyText.join("|")
    ].join("::")
  );

  return {
    stateId: `state-${stateFingerprint}-${Date.now()}`,
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
    actionGraph,
    regions,
    timestamp: new Date().toISOString()
  };
}
