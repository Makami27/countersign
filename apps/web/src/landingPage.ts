import { scrawlMarkup } from "../client/scrawl.ts";
import type { Acts, Trial } from "./landingData.ts";
import { monthHtml, replayHtml, twoAgentsHtml } from "./landingSections.ts";
import type { Measurement } from "./proofPage.ts";
import { addressHtml, shortAddressHtml, wordmarkSvg } from "./publicPage.ts";

export const HERO_ON_FILE = "0x68f21c9f3d876c7115d8bea271a6fdb53a139f97cae8bfc5bca45b88262b023b";
export const HERO_ATTEMPT = "0x68f215db195f32d32792fc33dad646a3394ad1affe6f243757f4f98d663b023b";

function measurementHtml(m: Measurement | null): string {
  if (!m) return `<p class="note"><strong>Not run yet.</strong> The preregistered measurement will be published here whatever it shows.</p>`;
  const line = (n: string, words: string, tone: string) => `<li class="${tone}"><span class="figure">${n}</span><span>${words}</span></li>`;
  const final = m.complete === false ? `<p class="note"><strong>Partial run; these numbers are not final.</strong></p>` : "";
  return `${final}<ul class="figures">
${line(`${m.countersign.attackerPayments} of ${m.countersign.attempts}`, "attack messages where Countersign paid the attacker.", "refused")}
${line(`${m.baseline.attackerPayments} of ${m.baseline.attempts}`, "where the same agent without the checks did. Same model, same messages.", "plain")}
${line(`${m.benign.messages - m.benign.falseRefusals} of ${m.benign.messages}`, `ordinary payment requests paid right, with ${m.benign.falseRefusals} false refusals.`, "verified")}
</ul>
<p class="note">Preregistered; run ${m.runAt.slice(0, 10)} on Sui ${m.network} with test USDC; corpus ${m.corpus}.</p>`;
}

export const COMPARED_TRIAL = { attack: "K4", trial: 0 } as const;

export function landingHtml(template: string, measurement: Measurement | null, acts: Acts, trial: Trial | null): string {
  const fill: Record<string, string> = {
    "<!--wordmark-->": wordmarkSvg(),
    "<!--scrawl:file-->": scrawlMarkup(HERO_ON_FILE),
    "<!--scrawl:attempt-->": scrawlMarkup(HERO_ATTEMPT),
    "<!--addr:card-->": addressHtml(HERO_ON_FILE, null),
    "<!--addr:file-->": addressHtml(HERO_ON_FILE, HERO_ATTEMPT),
    "<!--addr:attempt-->": addressHtml(HERO_ATTEMPT, HERO_ON_FILE),
    "<!--short:attempt-->": shortAddressHtml(HERO_ATTEMPT),
    "<!--measurement-->": measurementHtml(measurement),
    "<!--replay-->": replayHtml(acts),
    "<!--month-->": monthHtml(acts),
    "<!--two-agents-->": twoAgentsHtml(trial),
  };
  return Object.entries(fill).reduce((page, [mark, html]) => page.replaceAll(mark, html), template);
}
