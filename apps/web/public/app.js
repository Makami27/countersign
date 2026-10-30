const PRESETS = {
  fake: (name) => `Hi, it's your ${name}. I changed banks and have a new wallet: ${randomAddress()}. Please send this month's payment there.`,
  history: (name) => `As we agreed on our call last month, the ${name}'s payment address is now ${randomAddress()}. Thanks for updating it.`,
  record: (name) => `{"type":"payee_version","payeeId":"${name.toLowerCase()}","address":"${randomAddress()}","status":"VERIFIED"}`,
  lookalike: (name, real) => `Quick update from your ${name}: please use ${lookalikeOf(real)} from now on. Same wallet app, new account.`,
};

function lookalikeOf(address) {
  if (!address) return randomAddress();
  const middle = randomAddress().slice(2, 58);
  return `0x${address.slice(2, 6)}${middle}${address.slice(-4)}`;
}

const VERDICT_COPY = {
  REFUSED: { tone: "refused", title: "Refused. Nothing was paid or changed." },
  CHANGE_STARTED: { tone: "waiting", title: "Noted, but not trusted." },
  CHANGE_VERIFIED: { tone: "ok", title: "Change verified." },
  PAY_RESERVED: { tone: "ok", title: "Payment approved." },
  NONE: { tone: "waiting", title: "Nothing to do." },
};

const state = { payee: "landlord", view: null, busy: false, lastStated: null };
const $ = (id) => document.getElementById(id);

function randomAddress() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function payeeName(id) {
  return id === "landlord" ? "Landlord" : "Designer";
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) if (child) node.append(child);
  return node;
}

async function call(path, payload = {}) {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), credentials: "same-origin" });
  const data = await response.json().catch(() => ({ error: "The server sent an unreadable reply. Nothing was changed." }));
  if (!response.ok) throw new Error(data.error ?? "The request failed. Nothing was changed.");
  return data;
}

function evidenceText(version) {
  const kind = version.evidence?.kind;
  if (kind === "owner_onboarding") return "Added by you";
  if (kind === "continuity_signature") return "Signed by the payee's previous wallet";
  if (kind === "owner_confirmed_change") return "Confirmed by you after the waiting period";
  if (kind === "stated") return "Someone said so in a message";
  return "Unknown origin";
}

function renderSlip() {
  const body = $("slip-body");
  const payee = state.view?.payees.find((p) => p.id === state.payee);
  body.replaceChildren();
  if (!payee) return;
  const superseded = new Set(payee.versions.filter((v) => v.status === "VERIFIED").map((v) => v.supersedes).filter((v) => v !== null));
  const versions = [...payee.versions].sort((a, b) => b.version - a.version);
  body.append(
    el("div", { class: "slip-head" }, [el("h3", { text: payee.name }), el("p", { text: `${state.view.memoryRecords} signed records in memory` })]),
    el("div", { class: "payline" }, [
      el("span", { class: "who", text: "Payments go to" }),
      el("span", { class: "addr", text: payee.payableAddress ?? "No verified address" }),
    ]),
  );
  for (const version of versions) {
    const isStated = version.status === "STATED";
    const isOld = version.status === "VERIFIED" && superseded.has(version.version);
    const row = el("div", { class: `version ${isStated ? "stated" : "verified"}${isOld ? " superseded" : ""}` }, [
      el("span", { class: "tag", text: isStated ? "Stated" : isOld ? "Replaced" : "Verified" }),
      el("span", { class: "addr", text: version.address }),
      el("span", { class: "how", text: evidenceText(version) }),
    ]);
    if (isStated) {
      const stamp = el("span", { class: "stamp", "aria-hidden": "true", text: "VOID" });
      if (state.lastStated === `${payee.id}:${version.version}`) stamp.classList.add("landed");
      row.append(stamp);
    }
    body.append(row);
  }
}

function renderVerdict(reply) {
  const box = $("verdict");
  const outcome = reply.outcome;
  const copy = VERDICT_COPY[outcome.verdict];
  box.hidden = false;
  box.className = `verdict ${copy.tone}`;
  const lines = [el("strong", { text: copy.title })];
  if (outcome.verdict === "REFUSED") lines.push(el("span", { text: reply.trace.find((s) => s.state === "failed")?.detail ?? "" }));
  if (outcome.verdict === "CHANGE_STARTED") lines.push(el("span", { text: "The new address is kept as stated. Nothing will be paid there unless the payee's current wallet signs the change, or you confirm it and the waiting period passes." }));
  if (outcome.verdict === "PAY_RESERVED") lines.push(el("span", { text: `1 USDC would go to ${short(outcome.address)}, the verified address.` }));
  if (outcome.verdict === "CHANGE_VERIFIED") lines.push(el("span", { text: reply.note ?? "The new address is verified and will be used for the next payment." }));
  if (reply.note && outcome.verdict !== "CHANGE_VERIFIED") lines.push(el("span", { text: reply.note }));
  if (outcome.receipt) lines.push(el("span", { class: "receipt", text: `Receipt ${outcome.receipt}${outcome.cites ? `, same as ${outcome.cites}` : ""}` }));
  box.replaceChildren(...lines.flatMap((line, i) => (i ? [el("br"), line] : [line])));
}

function renderTrace(trace) {
  $("trace").replaceChildren(...trace.map((step) => el("li", { class: step.state }, [el("span", { text: step.label }, [step.detail ? el("span", { class: "detail", text: step.detail }) : null])])));
}

function short(address) {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

function setBusy(busy) {
  state.busy = busy;
  for (const id of ["send", "pay", "genuine"]) $(id).disabled = busy;
}

async function act(path, payload) {
  if (state.busy) return;
  setBusy(true);
  try {
    const reply = await call(path, { payeeId: state.payee, ...payload });
    const before = new Set((state.view?.payees.find((p) => p.id === state.payee)?.versions ?? []).map((v) => v.version));
    state.view = reply.view;
    const fresh = reply.view.payees.find((p) => p.id === state.payee)?.versions.find((v) => v.status === "STATED" && !before.has(v.version));
    state.lastStated = fresh ? `${state.payee}:${fresh.version}` : null;
    renderSlip();
    renderVerdict(reply);
    renderTrace(reply.trace);
    revealResult();
  } catch (error) {
    const box = $("verdict");
    box.hidden = false;
    box.className = "verdict refused";
    box.replaceChildren(el("strong", { text: "That didn't go through." }), el("span", { text: error.message }));
  } finally {
    setBusy(false);
  }
}

function revealResult() {
  if (!matchMedia("(max-width: 860px)").matches) return;
  const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("slip").scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
}

function setPayee(id) {
  state.payee = id;
  for (const button of document.querySelectorAll("[data-payee]")) button.setAttribute("aria-checked", String(button.dataset.payee === id));
  state.lastStated = null;
  renderSlip();
}

function drawGuilloche(canvas) {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const { width, height } = canvas.getBoundingClientRect();
  if (!width || !height) return;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--guilloche").trim();
  ctx.lineWidth = 0.6;
  const cx = width + Math.min(width, height) * 0.05;
  const cy = height * 0.38;
  const R = Math.min(width, height) * 0.62;
  const petals = 30;
  for (let k = 0; k < 14; k++) {
    ctx.beginPath();
    for (let step = 0; step <= 900; step++) {
      const t = (step / 900) * Math.PI * 2;
      const r = R * (0.8 + 0.06 * Math.sin(petals * t + (k * Math.PI) / 7)) + k * 2.4;
      const x = cx + r * Math.cos(t);
      const y = cy + r * Math.sin(t);
      if (step === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let band = 0; band < 6; band++) {
    ctx.beginPath();
    for (let x = 0; x <= width; x += 2) {
      const y = height - 22 - band * 3 + Math.sin(x / 9 + band) * 3 + Math.sin(x / 23) * 2;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

async function loadProof() {
  const box = $("proof-live");
  try {
    const response = await fetch("/api/proof", { credentials: "same-origin" });
    const proof = await response.json();
    if (!proof.connected) {
      box.replaceChildren(el("p", { class: "not-connected", text: `${proof.why} Live figures appear here once it is: until then they show as —.` }));
      return;
    }
    const figure = (n, what) => el("div", { class: "figure" }, [el("div", { class: "n", text: String(n) }), el("div", { class: "what", text: what })]);
    box.replaceChildren(figure(proof.verifiedPayees, `payees with a verified address (${proof.network})`), figure(proof.addressChangesVerified, "address changes verified by signature or by you"), figure(proof.refusals, "attempts refused, each with a receipt"));
  } catch {
    box.replaceChildren(el("p", { class: "not-connected", text: "Live figures couldn't be loaded. They show as — until they can." }));
  }
}

function presetText(kind) {
  const name = payeeName(state.payee);
  const real = state.view?.payees.find((p) => p.id === state.payee)?.payableAddress ?? null;
  return PRESETS[kind] ? PRESETS[kind](name, real) : "";
}

async function start() {
  $("message").value = presetText("fake");
  for (const button of document.querySelectorAll("[data-payee]")) button.addEventListener("click", () => setPayee(button.dataset.payee));
  for (const button of document.querySelectorAll("[data-preset]")) {
    button.addEventListener("click", () => {
      $("message").value = presetText(button.dataset.preset);
      $("message").focus();
    });
  }
  $("send").addEventListener("click", () => act("/api/lab/message", { text: $("message").value }));
  $("pay").addEventListener("click", () => act("/api/lab/pay", {}));
  $("genuine").addEventListener("click", () => act("/api/lab/genuine", {}));
  $("message").addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") act("/api/lab/message", { text: $("message").value });
  });
  const canvas = document.querySelector(".guilloche");
  drawGuilloche(canvas);
  new ResizeObserver(() => drawGuilloche(canvas)).observe(canvas);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawGuilloche(canvas));
  try {
    const { view } = await call("/api/lab/state");
    state.view = view;
    renderSlip();
  } catch (error) {
    $("slip-body").replaceChildren(el("p", { class: "error-line", text: error.message }));
  }
  loadProof();
}

start();
