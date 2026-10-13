"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ask, BY_ID, CATEGORIES, categoryOf, ENTRIES, GLOSSARY, type Entry, type Facts, type Term } from "@/lib/kennis";
import { personalBlock } from "@/lib/kennis/personal";
import { extractCandidates } from "@/lib/pasteCoin";
import { brand } from "@/lib/brand";
import { PasteCheck } from "../radar/PasteCheck";
import { Calculators } from "./Calculators";

const dim: React.CSSProperties = { color: "#8a8a8e", fontSize: 12, lineHeight: 1.5 };
const card: React.CSSProperties = { background: "#141418", border: "1px solid #2a2a2f", borderRadius: 8, padding: 14, marginBottom: 10 };
const pill: React.CSSProperties = { display: "inline-block", fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#8a8a8e", border: "1px solid #2a2a2f", borderRadius: 999, padding: "1px 8px", marginBottom: 6 };
const chipStyle: React.CSSProperties = { padding: "6px 11px", background: "#1a1a1f", color: "#d4d4de", border: "1px solid #2a2a2f", borderRadius: 999, fontSize: 12.5, cursor: "pointer", textDecoration: "none", display: "inline-block" };
const linkStyle: React.CSSProperties = { color: brand.blueText, textDecoration: "underline", textDecorationColor: brand.blueLine, textUnderlineOffset: 3 };

const QUICK = [
  "Wanneer neem ik winst?",
  "Hoeveel zet ik in per coin?",
  "Hoe herken ik een rug pull?",
  "Wat betekent 'insiders hold 84%'?",
  "Wat is slippage?",
  "Hoe beveilig ik mijn wallet?",
  "Ik wil mijn verlies goedmaken",
  "Wat doet de Check-knop?",
];

// ---------- the user's own numbers: fetched once per page load, and only when an answer needs them ----------

let factsCache: Facts | null = null;
let factsInflight: Promise<Facts | null> | null = null;
function fetchFacts(): Promise<Facts | null> {
  if (factsCache) return Promise.resolve(factsCache);
  factsInflight ??= fetch("/api/kennis-facts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      factsCache = (j?.facts as Facts) ?? null;
      return factsCache;
    })
    .catch(() => null)
    .finally(() => {
      factsInflight = null;
    });
  return factsInflight;
}
/** undefined while loading, null when there are none */
function useFacts(needed: boolean): Facts | null | undefined {
  const [f, setF] = useState<Facts | null | undefined>(factsCache ?? undefined);
  useEffect(() => {
    if (!needed || f !== undefined) return;
    let live = true;
    void fetchFacts().then((x) => live && setF(x));
    return () => {
      live = false;
    };
  }, [needed, f]);
  return f;
}

// ---------- questions that could not be answered, kept on this device so they can be added later ----------

const LOG_KEY = "auriga:kennis:onbeantwoord";
interface Logged {
  q: string;
  at: string;
}
const readLog = (): Logged[] => {
  try {
    const v = JSON.parse(window.localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => x && typeof x.q === "string").slice(0, 40) : [];
  } catch {
    return [];
  }
};
const writeLog = (l: Logged[]) => {
  try {
    window.localStorage.setItem(LOG_KEY, JSON.stringify(l.slice(0, 40)));
  } catch {
    /* storage blocked: nothing is kept */
  }
};

// ---------- text: **bold**, *italic*, and *an-entry-id* as a link to that entry ----------

function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <strong key={i} style={{ color: "#ececf4" }}>{p.slice(2, -2)}</strong>;
        if (p.length > 2 && p.startsWith("*") && p.endsWith("*")) {
          const inner = p.slice(1, -1);
          const e = BY_ID.get(inner);
          if (e)
            return (
              <Link key={i} href={`/kennis?e=${e.id}`} style={linkStyle}>
                {e.title}
              </Link>
            );
          return <em key={i}>{inner}</em>;
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </>
  );
}

function Body({ items }: { items: string[] }) {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (!bullets.length) return;
    out.push(
      <ul key={`u${out.length}`} style={{ margin: "6px 0", paddingLeft: 20, lineHeight: 1.6 }}>
        {bullets.map((b, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            <Rich text={b} />
          </li>
        ))}
      </ul>,
    );
    bullets = [];
  };
  items.forEach((it, i) => {
    if (it.startsWith("- ")) bullets.push(it.slice(2));
    else {
      flush();
      out.push(
        <p key={`p${i}`} style={{ margin: "8px 0", lineHeight: 1.65 }}>
          <Rich text={it} />
        </p>,
      );
    }
  });
  flush();
  return <>{out}</>;
}

function PersonalBox({ entry }: { entry: Entry }) {
  const f = useFacts(Boolean(entry.personal));
  if (!entry.personal) return null;
  const block = f === undefined ? null : personalBlock(entry.personal, f);
  if (f === undefined) return <div style={{ ...dim, margin: "8px 0" }}>Jouw cijfers worden geladen…</div>;
  if (!block) return null;
  return (
    <div style={{ margin: "10px 0", padding: "10px 12px", background: "rgba(47, 91, 255, 0.10)", borderLeft: `3px solid ${brand.blue}`, borderRadius: 4, fontSize: 13, lineHeight: 1.6, color: "#d4d4de" }}>
      <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: brand.blueText, marginBottom: 4, fontWeight: 700 }}>{block.title}</div>
      {block.lines.map((l, i) => (
        <div key={i} style={{ marginBottom: 3 }}>
          {l}
        </div>
      ))}
      {block.note && <div style={{ ...dim, marginTop: 4 }}>{block.note}</div>}
    </div>
  );
}

function EntryCard({ entry, expanded, start }: { entry: Entry; expanded?: boolean; start?: boolean }) {
  const [open, setOpen] = useState(Boolean(expanded));
  useEffect(() => setOpen(Boolean(expanded)), [expanded, entry.id]);
  const see = (entry.see ?? []).map((id) => BY_ID.get(id)).filter((x): x is Entry => Boolean(x));
  return (
    <div style={{ ...card, borderColor: start ? brand.blueLine : "#2a2a2f" }}>
      <span style={pill}>{categoryOf(entry.cat).title}</span>
      <h3 style={{ margin: "0 0 6px", fontSize: start ? 18 : 15, color: "#fff", lineHeight: 1.3 }}>
        <Link href={`/kennis?e=${entry.id}`} style={{ color: "inherit", textDecoration: "none" }}>
          {entry.title}
        </Link>
      </h3>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#d4d4de" }}>
        <Rich text={entry.short} />
      </div>
      <PersonalBox entry={entry} />
      {open && (
        <div style={{ fontSize: 13.5, color: "#b4b4c6", marginTop: 4 }}>
          <Body items={entry.body} />
          {entry.todo && entry.todo.length > 0 && (
            <div style={{ margin: "10px 0", padding: "8px 12px", background: "#0f1116", border: "1px solid #2a2a2f", borderRadius: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: "#8a8a8e", marginBottom: 4, fontWeight: 700 }}>Wat je kunt doen</div>
              {entry.todo.map((t, i) => (
                <div key={i} style={{ marginBottom: 3 }}>
                  ☐ <Rich text={t} />
                </div>
              ))}
            </div>
          )}
          {entry.id === "positiegrootte" || entry.id === "drawdown-herstel" || entry.id === "inleg-terug" || entry.id === "price-impact" ? (
            <div style={{ margin: "8px 0" }}>
              <Link href="/kennis?v=rekenen" style={linkStyle}>
                Open de rekenmachines →
              </Link>
            </div>
          ) : null}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
        <button onClick={() => setOpen((v) => !v)} style={{ background: "none", border: "none", color: brand.blueText, cursor: "pointer", padding: 0, fontSize: 13 }}>
          {open ? "Minder" : "Lees de uitleg"}
        </button>
      </div>
      {open && see.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...dim, marginBottom: 6 }}>Lees ook:</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {see.map((e) => (
              <Link key={e.id} href={`/kennis?e=${e.id}`} style={{ ...chipStyle, fontSize: 12, padding: "5px 10px" }}>
                {e.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TermCard({ term }: { term: Term }) {
  const e = term.see ? BY_ID.get(term.see) : undefined;
  return (
    <div style={{ ...card, padding: 12 }}>
      <span style={pill}>Woordenlijst</span>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: "#d4d4de" }}>
        <b style={{ color: "#fff" }}>{term.term}</b>
        {term.aka && term.aka.length > 0 && <span style={{ ...dim, marginLeft: 6 }}>({term.aka.slice(0, 3).join(", ")})</span>}
        <br />
        {term.def}
      </div>
      {e && (
        <div style={{ marginTop: 6 }}>
          <Link href={`/kennis?e=${e.id}`} style={{ ...linkStyle, fontSize: 13 }}>
            Uitleg: {e.title} →
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------- the views ----------

function Results({ q }: { q: string }) {
  const r = useMemo(() => ask(q, 8), [q]);
  const coinKey = useMemo(() => extractCandidates(q)[0]?.value ?? null, [q]);
  const coin = coinKey != null;
  const entries = r.hits.filter((h) => h.kind === "entry" && h.entry);
  const terms = r.hits.filter((h) => h.kind === "term" && h.term);
  const top = r.confident ? r.hits[0] : null;
  const rest = (top ? r.hits.slice(1) : r.hits).slice(0, 5);
  const long = q.trim().split(/\s+/).length >= 8;
  return (
    <div>
      {coin && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...dim, marginBottom: 6 }}>Dit lijkt een coin: ik zoek hem op en draai de Check.</div>
          <PasteCheck key={coinKey} initial={q} autoRun hideForm />
        </div>
      )}
      {!coin && (!r.hits.length || !r.confident) ? (
        <div style={{ ...card, borderColor: "#6a4a1a" }}>
          <div style={{ fontWeight: 700, color: "#e5c07b", marginBottom: 4 }}>Daar heb ik geen goed antwoord op.</div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: "#d4d4de" }}>
            Ik verzin liever niets. Probeer de vraag met andere woorden, of blader hieronder door de onderwerpen. Ik heb je vraag onthouden op dit toestel, zodat hij later kan worden toegevoegd.
            {r.hits.length > 0 && " Het dichtstbijzijnde:"}
          </div>
        </div>
      ) : null}
      {top && top.kind === "entry" && top.entry && <EntryCard entry={top.entry} start />}
      {top && top.kind === "term" && top.term && <TermCard term={top.term} />}
      {rest.length > 0 && (
        <>
          <div style={{ ...dim, margin: "14px 0 6px" }}>{top ? "Ook relevant" : "Het dichtstbijzijnde"}</div>
          {rest.map((h) => (h.kind === "entry" && h.entry ? <EntryCard key={h.id} entry={h.entry} /> : h.term ? <TermCard key={h.id} term={h.term} /> : null))}
        </>
      )}
      {!coin && long && r.hits.length > 0 && (
        <div style={{ ...dim, marginTop: 14 }}>Lange vragen begrijp ik minder goed dan korte. Past dit niet bij wat je zocht? Probeer de kernwoorden, bijvoorbeeld 'coin gedaald verkopen'.</div>
      )}
      {!coin && entries.length + terms.length === 0 && r.unknown.length > 0 && <div style={dim}>Onbekende woorden: {r.unknown.join(", ")}</div>}
    </div>
  );
}

function Home() {
  const f = useFacts(true);
  const [log, setLog] = useState<Logged[]>([]);
  useEffect(() => setLog(readLog()), []);
  const mine = f === undefined || f === null ? null : personalBlock("journaal", f);
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {QUICK.map((s) => (
          <Link key={s} href={`/kennis?q=${encodeURIComponent(s)}`} style={chipStyle}>
            {s}
          </Link>
        ))}
      </div>
      {mine && (
        <div style={{ margin: "0 0 14px", padding: "10px 12px", background: "rgba(47, 91, 255, 0.10)", borderLeft: `3px solid ${brand.blue}`, borderRadius: 4, fontSize: 13, lineHeight: 1.6, color: "#d4d4de" }}>
          <div style={{ fontSize: 10, letterSpacing: 0.8, textTransform: "uppercase", color: brand.blueText, marginBottom: 4, fontWeight: 700 }}>{mine.title}</div>
          {mine.lines.map((l, i) => (
            <div key={i} style={{ marginBottom: 3 }}>
              {l}
            </div>
          ))}
          <div style={{ marginTop: 6 }}>
            <Link href="/kennis?e=jouw-cijfers" style={linkStyle}>
              Wat zeggen deze cijfers? →
            </Link>
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10, marginBottom: 14 }}>
        {CATEGORIES.map((c) => (
          <Link key={c.id} href={`/kennis?c=${c.id}`} style={{ ...card, marginBottom: 0, textDecoration: "none", display: "block" }}>
            <div style={{ color: "#fff", fontWeight: 700, fontSize: 15 }}>{c.title}</div>
            <div style={{ ...dim, margin: "3px 0 6px" }}>{c.blurb}</div>
            <div style={{ fontSize: 12, color: brand.blueText }}>{ENTRIES.filter((e) => e.cat === c.id).length} onderwerpen →</div>
          </Link>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <Link href="/kennis?v=woordenlijst" style={chipStyle}>
          Woordenlijst A–Z ({GLOSSARY.length})
        </Link>
        <Link href="/kennis?v=rekenen" style={chipStyle}>
          Rekenmachines
        </Link>
      </div>
      {log.length > 0 && (
        <div style={{ ...card, borderColor: "#3a3a46" }}>
          <div style={{ fontWeight: 700, color: "#fff", fontSize: 14, marginBottom: 4 }}>Vragen waar ik geen antwoord op had ({log.length})</div>
          <div style={{ ...dim, marginBottom: 6 }}>Alleen op dit toestel bewaard. Kopieer ze en stuur ze naar Claude, dan komen ze erin.</div>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18, fontSize: 13, color: "#d4d4de" }}>
            {log.slice(0, 8).map((l, i) => (
              <li key={i}>{l.q}</li>
            ))}
          </ul>
          <button
            onClick={() => void navigator.clipboard?.writeText(log.map((l) => l.q).join("\n")).catch(() => undefined)}
            style={{ ...chipStyle, fontSize: 12, padding: "5px 10px", marginRight: 8 }}
          >
            Kopieer
          </button>
          <button
            onClick={() => {
              writeLog([]);
              setLog([]);
            }}
            style={{ ...chipStyle, fontSize: 12, padding: "5px 10px" }}
          >
            Wis
          </button>
        </div>
      )}
      <div style={{ ...dim, marginTop: 16 }}>
        Dit is uitleg en informatie, geen financieel advies. De uitleg is met de hand geschreven en kan fouten bevatten of verouderen (platforms, fees en regels veranderen): controleer iets belangrijks ook bij de bron.
      </div>
    </div>
  );
}

function CategoryView({ id }: { id: string }) {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) return <div style={dim}>Dit onderwerp bestaat niet.</div>;
  const list = ENTRIES.filter((e) => e.cat === c.id);
  return (
    <div>
      <Link href="/kennis" style={{ ...linkStyle, fontSize: 13 }}>
        ← Alle onderwerpen
      </Link>
      <h2 style={{ margin: "10px 0 2px", fontSize: 20, color: "#fff" }}>{c.title}</h2>
      <div style={{ ...dim, marginBottom: 12 }}>{c.blurb}</div>
      {list.map((e) => (
        <Link key={e.id} href={`/kennis?e=${e.id}`} style={{ ...card, display: "block", textDecoration: "none", padding: 12 }}>
          <div style={{ color: "#fff", fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{e.title}</div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#b4b4c6" }}>{e.short.length > 170 ? `${e.short.slice(0, 167).replace(/\s+\S*$/, "")}…` : e.short}</div>
        </Link>
      ))}
    </div>
  );
}

function Glossary() {
  const [f, setF] = useState("");
  const sorted = useMemo(() => [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term, "nl")), []);
  const shown = f.trim() ? sorted.filter((t) => `${t.term} ${(t.aka ?? []).join(" ")} ${t.def}`.toLowerCase().includes(f.trim().toLowerCase())) : sorted;
  let last = "";
  return (
    <div>
      <Link href="/kennis" style={{ ...linkStyle, fontSize: 13 }}>
        ← Alle onderwerpen
      </Link>
      <h2 style={{ margin: "10px 0 8px", fontSize: 20, color: "#fff" }}>Woordenlijst</h2>
      <input value={f} onChange={(e) => setF(e.target.value)} placeholder="Zoek een woord" aria-label="Zoek in de woordenlijst" style={{ width: "100%", height: 40, padding: "0 12px", background: "#141418", color: brand.fg, border: "1px solid #2a2a2f", borderRadius: 8, fontSize: 16, marginBottom: 12, boxSizing: "border-box" }} />
      {shown.map((t) => {
        const l = t.term[0]!.toUpperCase();
        const head = l !== last ? ((last = l), true) : false;
        return (
          <Fragment key={t.term}>
            {head && !f.trim() && <div style={{ fontSize: 13, color: brand.blueText, fontWeight: 700, margin: "14px 0 6px" }}>{l}</div>}
            <TermCard term={t} />
          </Fragment>
        );
      })}
      {shown.length === 0 && <div style={dim}>Niets gevonden. Probeer het hierboven bij de vraag: daar zoek ik ook in de uitleg.</div>}
    </div>
  );
}

function EntryPage({ entry }: { entry: Entry }) {
  const router = useRouter();
  return (
    <div>
      <button onClick={() => (window.history.length > 1 ? router.back() : router.push("/kennis"))} style={{ background: "none", border: "none", color: brand.blueText, cursor: "pointer", padding: 0, fontSize: 13, marginBottom: 8 }}>
        ← Terug
      </button>
      <EntryCard entry={entry} expanded start />
    </div>
  );
}

// ---------- the page ----------

export default function KennisClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const e = sp.get("e");
  const c = sp.get("c");
  const v = sp.get("v");
  const qp = sp.get("q") ?? "";
  const [q, setQ] = useState(qp);
  const logged = useRef(new Set<string>());

  // the address bar is the truth: a link, the back button or a chip changes the question
  useEffect(() => setQ(qp), [qp]);
  // typing follows into the address bar after a short pause (so a refresh or a shared link keeps the question)
  useEffect(() => {
    if (q.trim() === qp.trim()) return;
    const t = setTimeout(() => router.replace(q.trim() ? `/kennis?q=${encodeURIComponent(q.trim())}` : "/kennis", { scroll: false }), 400);
    return () => clearTimeout(t);
  }, [q, qp, router]);
  // a question nobody could answer is kept on this device, once
  useEffect(() => {
    const t = qp.trim();
    if (t.length < 4 || logged.current.has(t) || extractCandidates(t).length) return;
    if (ask(t, 3).confident) return;
    logged.current.add(t);
    const l = readLog().filter((x) => x.q !== t);
    writeLog([{ q: t, at: new Date().toISOString() }, ...l]);
  }, [qp]);

  const entry = e ? BY_ID.get(e) ?? null : null;
  const searching = q.trim().length > 0 && !e && !c && !v;

  return (
    <div style={{ padding: "18px 16px 90px", color: "#ececf4", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 24, fontWeight: 700 }}>Kennis</h1>
      <p style={{ ...dim, fontSize: 13, margin: "0 0 12px" }}>Stel een vraag, of blader. Alles over coins, holders, scams, risico en winst nemen, met jouw eigen cijfers erbij. Informatie, geen advies.</p>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          router.push(q.trim() ? `/kennis?q=${encodeURIComponent(q.trim())}` : "/kennis", { scroll: false });
        }}
        style={{ display: "flex", gap: 8, marginBottom: 6 }}
      >
        <input
          value={q}
          onChange={(ev) => setQ(ev.target.value)}
          placeholder="Stel je vraag…"
          aria-label="Stel je vraag"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ flex: 1, minWidth: 0, height: 44, padding: "0 12px", background: "#141418", color: brand.fg, border: "1px solid #2a2a2f", borderRadius: 8, fontSize: 16 }}
        />
        <button type="submit" style={{ height: 44, padding: "0 16px", background: brand.blue, color: brand.fg, border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
          Zoek
        </button>
      </form>
      <div style={{ ...dim, marginBottom: 14 }}>Je kunt hier ook een coin-adres of een link plakken: dan draai ik de Check.</div>

      {searching ? <Results q={q} /> : entry ? <EntryPage entry={entry} /> : e ? <div style={dim}>Dit onderwerp bestaat niet (meer). <Link href="/kennis" style={linkStyle}>Naar alle onderwerpen</Link></div> : c ? <CategoryView id={c} /> : v === "woordenlijst" ? <Glossary /> : v === "rekenen" ? (
        <div>
          <Link href="/kennis" style={{ ...linkStyle, fontSize: 13 }}>
            ← Alle onderwerpen
          </Link>
          <h2 style={{ margin: "10px 0 12px", fontSize: 20, color: "#fff" }}>Rekenmachines</h2>
          <Calculators />
        </div>
      ) : <Home />}
    </div>
  );
}
