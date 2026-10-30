for (const el of document.querySelectorAll("[data-addr]")) {
  const addr = el.dataset.addr.toLowerCase();
  const against = el.dataset.against?.toLowerCase();
  const short = el.hasAttribute("data-short");
  el.classList.add("addr");
  el.setAttribute("title", addr);
  el.setAttribute("aria-label", `Address ${addr.split("").join(" ")}`);
  const hex = addr.slice(2);
  const groups = ["0x", ...hex.match(/.{1,4}/g)];
  const otherGroups = against ? ["0x", ...against.slice(2).match(/.{1,4}/g)] : null;
  const shown = short ? [groups[0] + groups[1], "…", groups.at(-1)] : groups;
  el.replaceChildren(...shown.map((g, i) => {
    const span = document.createElement("span");
    span.className = "g";
    span.textContent = g;
    span.setAttribute("aria-hidden", "true");
    if (otherGroups && !short && i > 0) span.classList.add(otherGroups[i] === g ? "same" : "diff");
    return span;
  }));
  if (short) el.classList.add("short");
}
