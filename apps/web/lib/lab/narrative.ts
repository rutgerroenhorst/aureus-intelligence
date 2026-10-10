/**
 * What a coin is about, read from what is known at the first look: its name and symbol, and the website the launch
 * platform or the team put on its profile at that moment. Tags are crude on purpose (keywords, no model), so that
 * anybody can see why a coin got one, and so that a hypothesis about them can be written down before it is tested.
 */

const AI_AGENT = /\b(ai|agi|agent|agents|agentic|gpt|llm|grok|claw|clawd|clawpump|bot|bots|robot|neural|intelligence|skynet|t-?800|terminator|algo|autonomous|assistant|copilot|openai|claude)\b/i;
const TOOL =
  /\b(swap|dex|defi|pay|paid|payments?|market|markets|protocol|labs?|app|apps|finance|capital|fund|yield|vault|bridge|chain|zk|privacy|private|dark|quantum|pqc|terminal|miner|miners|mining|hash|node|stake|staking|lending|exchange|wallet|launch|launchpad|pad|studio|platform|network|analytics|oracle|index|strategy)\b/i;
const ANIMAL =
  /(dog|doge|inu|shib|cat|kitty|kitten|frog|pepe|bonk|wif|cow|monkey|ape|bear|bull|pig|fish|bird|duck|penguin|hamster|bunny|rabbit|wolf|lion|tiger|jaguar|leopard|fox|panda|sloth|turtle|snail|whale|llama|goat|cheems|bobo|moo|meow|woof|hippo|gorilla|chimp|squirrel|raccoon|otter|capybara|seal|crab|shrimp|octopus|dragon|unicorn)/i;
const PERSON = /\b(trump|biden|elon|musk|maga|kamala|vance|putin|obama|melania|barron|kanye|drake|taylor|messi|ronaldo|cz|sbf|vitalik|satoshi|tate|jesus|buddha)\b/i;

/** Launch ecosystems whose pages are generated for every token they launch (so the site is known at the first look). */
const ECOSYSTEMS: Array<[string, RegExp]> = [
  ["clawpump", /clawpump\.tech$/],
  ["usepaid", /usepaid\.app$/],
  ["agencypad", /agencypad\.fun$/],
  ["pad", /pad\.(fun|io)$/],
  ["otcdesks", /otcdesks\.cash$/],
];

export type NarrativeTag = "ai_agent" | "tool" | "animal" | "person" | "product";

export function siteFamily(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url.includes("//") ? url : `https://${url}`).hostname.toLowerCase().replace(/^www\./, "");
    return host.split(".").slice(-2).join(".");
  } catch {
    return null;
  }
}

/** Tags for a coin. `product` = it looks like an AI/agent/bot or a tool/app/finance/tech project rather than a plain meme. */
export function tagsFor(name: string | null | undefined, symbol: string | null | undefined, siteUrl?: string | null): string[] {
  const text = `${symbol ?? ""} ${name ?? ""}`;
  const tags = new Set<string>();
  if (AI_AGENT.test(text)) tags.add("ai_agent");
  if (TOOL.test(text)) tags.add("tool");
  if (ANIMAL.test(text)) tags.add("animal");
  if (PERSON.test(text)) tags.add("person");
  if (tags.has("ai_agent") || tags.has("tool")) tags.add("product");
  const fam = siteFamily(siteUrl);
  if (fam) {
    for (const [eco, re] of ECOSYSTEMS) if (re.test(fam)) tags.add(`eco:${eco}`);
  }
  return [...tags];
}

/**
 * A wider reading of "AI / agent / bot name" than the `ai_agent` tag, for the runner lane's own hypothesis (H6): a word that
 * ends in bot (hotbot, chatbot), contains agent, agency, gpt, claw, claude, grok, neural or llm, or the word ai on its own. It
 * is separate on purpose. H1 was written down with the narrower tag before HOTBOT was looked at; widening that tag afterwards
 * would change what an earlier hypothesis means.
 */
const AI_WIDE = /(\w*bot\b|agen(t|cy)|gpt|claw|claude|grok|neural|llm|copilot|autonom)|\bai\b/i;
export const aiNameWide = (name: string | null | undefined, symbol: string | null | undefined): boolean => AI_WIDE.test(`${symbol ?? ""} ${name ?? ""}`);

/** The tag that decides a coin's single narrative bucket in tables (priority order). */
export function primaryTag(tags: string[]): "ai_agent" | "tool" | "animal" | "person" | "other" {
  for (const t of ["ai_agent", "tool", "animal", "person"] as const) if (tags.includes(t)) return t;
  return "other";
}
