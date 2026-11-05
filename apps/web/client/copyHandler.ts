import { plainCopy } from "./plainCopy.ts";

export function installPlainCopy(): void {
  document.addEventListener("copy", (event) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !event.clipboardData) return;
    const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    const short = anchor?.closest<HTMLElement>(".addr.short");
    const selected = selection.toString();
    const plain = short?.contains(selection.focusNode) && short.title ? short.title : plainCopy(selected);
    if (plain === selected) return;
    event.clipboardData.setData("text/plain", plain);
    event.preventDefault();
  });
}
