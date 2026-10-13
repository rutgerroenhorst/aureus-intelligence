import type { Facts, PersonalKey } from "./types";

/** Under an answer: the user's own numbers (or the lab's), as plain sentences. Pure: the page fetches the facts, this only words them. */
export interface Block {
  title: string;
  lines: string[];
  /** a one-line note about what these numbers are not */
  note?: string;
}

const usd = (n: number) => `$${Math.round(n).toLocaleString("nl-NL")}`;
const pct = (k: number, n: number) => (n > 0 ? `${Math.round((100 * k) / n)}%` : "-");
const pctP = (p: number) => `${(p * 100).toFixed(p < 0.1 ? 1 : 0).replace(".", ",")}%`;

export function personalBlock(key: PersonalKey, f: Facts | null): Block | null {
  const j = f?.journal ?? null;
  const lab = f?.lab ?? null;
  switch (key) {
    case "journaal": {
      if (!j || j.coins === 0) return null;
      const total = j.outUsd + j.heldUsd;
      const lines = [
        `Je journaal telt ${j.coins} coins: ${usd(j.putUsd)} erin, ${usd(j.outUsd)} eruit, en wat je nog houdt is nu ongeveer ${usd(j.heldUsd)} waard.`,
      ];
      if (j.putUsd > 0) lines.push(`Per saldo is dat ${(total / j.putUsd).toFixed(2).replace(".", ",")}× je inleg (${total >= j.putUsd ? "+" : "−"}${usd(Math.abs(total - j.putUsd))}).`);
      lines.push(`${j.lostHalf} van de ${j.coins} coins (${pct(j.lostHalf, j.coins)}) staan nu op de helft of minder van je instap. ${j.touched2x} raakten ooit de 2×; bij ${j.gaveBack} daarvan staat de koers nu onder je instap.`);
      if (lab) lines.push(`Ter vergelijking: van de coins die het lab drie dagen volgde, hield ${pctP(lab.held.x2)} de 2×.`);
      return { title: "Jouw cijfers", lines, note: "Gebaseerd op je journaal (Enter-knop en je gevolgde wallet). Waarde nu is een schatting uit de huidige koersen." };
    }
    case "winst": {
      if (!j || j.coins === 0) return null;
      const lines = [
        `Van je ${j.coins} coins raakten er ${j.touched2x} (${pct(j.touched2x, j.coins)}) ooit de 2×. Bij ${j.gaveBack} daarvan staat de koers nu onder je instap: winst die je hebt teruggegeven.`,
        `Bij elke coin die de 2× raakte, had een verkoop van de helft op dat moment je inleg van die coin terugbetaald, wat er daarna ook gebeurde (fees en een dunne pool buiten beschouwing gelaten).`,
      ];
      if (lab) lines.push(`Ter vergelijking: in het lab hield ${pctP(lab.held.x2)} van de coins de 2×, ${pctP(lab.held.x5)} de 5× en ${pctP(lab.held.x10)} de 10×.`);
      return { title: "Jouw cijfers", lines, note: j.sources.wallet > 0 ? "Bij aankopen uit je wallet-geschiedenis is het hoogste punt niet altijd bekend: lees dit als ondergrens." : undefined };
    }
    case "positie": {
      if (!j || j.medianSizeUsd == null || j.medianSizeUsd <= 0) return null;
      const m = j.medianSizeUsd;
      const lines = [
        `Je gebruikelijke inleg is ongeveer ${usd(m)} per coin (de middelste van je coins met een bekende inleg).`,
        `Met een regel van 2% per coin hoort daar een bankroll van ongeveer ${usd(m / 0.02)} bij; met 1% ${usd(m / 0.01)}. In totaal heb je ${usd(j.putUsd)} ingelegd.`,
      ];
      return { title: "Jouw cijfers", lines, note: "Een vuistregel om mee te spelen, geen advies: kies zelf een bedrag dat je kunt missen." };
    }
    case "buiten-radar": {
      if (!j || (j.viaRadar.n === 0 && j.outsideRadar.n === 0)) return null;
      const lines: string[] = [];
      if (j.viaRadar.n > 0) lines.push(`Coins die je via een tab pakte (of plakte): ${j.viaRadar.n}, waarvan ${j.viaRadar.lostHalf} (${pct(j.viaRadar.lostHalf, j.viaRadar.n)}) nu op de helft of minder van je instap staan.`);
      if (j.outsideRadar.n > 0) lines.push(`Coins buiten de Radar om (uit je wallet, zonder tab en zonder Check): ${j.outsideRadar.n}, waarvan ${j.outsideRadar.lostHalf} (${pct(j.outsideRadar.lostHalf, j.outsideRadar.n)}).`);
      return { title: "Jouw cijfers", lines, note: "Het verschil kan ook komen door wanneer je kocht, hoeveel en welke soort coin: het is een aanwijzing, geen bewijs." };
    }
    case "basisrates": {
      if (!lab) return null;
      const lines = [`Het lab volgde ${lab.followed} coins drie dagen: ${pctP(lab.held.x2)} hield de 2×, ${pctP(lab.held.x3)} de 3×, ${pctP(lab.held.x5)} de 5× en ${pctP(lab.held.x10)} de 10× (de koers bleef daar ongeveer een half uur).`];
      if (j && j.coins > 0) lines.push(`Bij jou: ${j.touched2x} van de ${j.coins} coins raakten ooit de 2× (${pct(j.touched2x, j.coins)}).`);
      return { title: "Wat het lab zag", lines, note: "Beschrijving van de coins die het lab zag, geen voorspelling." };
    }
    case "pumpswap": {
      const hit = lab?.headlines.find((h) => /PumpSwap/.test(h));
      return hit ? { title: "Wat het lab nu zegt", lines: [hit], note: "De zin komt letterlijk van het lab (Engels) en verandert mee met de data." } : null;
    }
    case "druk": {
      const hits = (lab?.headlines ?? []).filter((h) => /^Losing half within a day at \+0 h, (trades|volume)/.test(h)).slice(0, 3);
      return hits.length ? { title: "Wat het lab nu zegt", lines: hits, note: "Letterlijk van het lab (Engels): de percentages zijn het aandeel coins dat binnen een dag de helft verloor, per groep." } : null;
    }
    case "lab-vondsten": {
      const hs = (lab?.headlines ?? []).slice(0, 6);
      return hs.length ? { title: "Wat het lab nu zegt", lines: hs, note: "Letterlijk van het lab (Engels); meer, met de onzekerheid erbij, staat op Learning." } : null;
    }
  }
}
