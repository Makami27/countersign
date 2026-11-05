import { h, scrawlEl } from "./dom.ts";
import { STAMP_NOTES, readMuted, writeMuted, type StoreLike } from "./momentFacts.ts";

const SHOWN_MS = 3_200;

function store(): StoreLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let context: AudioContext | null = null;

function play(): void {
  if (!context || readMuted(store())) return;
  try {
    const now = context.currentTime;
    for (const note of STAMP_NOTES) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = note.wave;
      oscillator.frequency.setValueAtTime(note.from, now + note.at);
      oscillator.frequency.exponentialRampToValueAtTime(note.to, now + note.at + note.length);
      gain.gain.setValueAtTime(note.volume, now + note.at);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.length);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now + note.at);
      oscillator.stop(now + note.at + note.length);
    }
  } catch {
    context = null;
  }
}

function armSound(): void {
  const arm = () => {
    try {
      context ??= new AudioContext();
      void context.resume();
    } catch {
      context = null;
    }
  };
  document.addEventListener("pointerdown", arm, { capture: true });
  document.addEventListener("keydown", arm, { capture: true });
}

export function soundToggle(): HTMLElement {
  const button = h("button", { class: "sound-toggle", type: "button" });
  const draw = () => {
    const muted = readMuted(store());
    button.textContent = muted ? "Sound off" : "Sound on";
    button.setAttribute("aria-pressed", muted ? "false" : "true");
  };
  button.addEventListener("click", () => {
    writeMuted(store(), !readMuted(store()));
    draw();
  });
  draw();
  return button;
}

export function startMoments(header: Element | null): void {
  armSound();
  header?.append(soundToggle());
}

export type Moment = { readonly title: string; readonly detail?: string; readonly address?: string };

export function showMoment(moment: Moment): void {
  document.querySelector(".moment")?.remove();
  const slip = h("div", { class: "moment", role: "status" },
    h("span", { class: "moment-stamp", "aria-hidden": "true" }, "SIGNED"),
    h("div", { class: "moment-words" },
      h("p", { class: "money" }, moment.title),
      moment.detail ? h("p", { class: "note" }, moment.detail) : null),
    moment.address ? h("div", { class: "moment-sig", "aria-hidden": "true" }, scrawlEl(moment.address, { draw: true })) : null);
  const dismiss = () => slip.remove();
  slip.addEventListener("click", dismiss);
  (document.querySelector("dialog[open]") ?? document.querySelector(".app") ?? document.body).append(slip);
  play();
  window.setTimeout(dismiss, SHOWN_MS);
}
