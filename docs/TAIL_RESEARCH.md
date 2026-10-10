# Waarom het systeem de grote winnaars mist: onderzoek en plan

*10 oktober 2026. Data: de 1.398 coins die het systeem zag tussen 12 september en 9 oktober 2026; 933 daarvan zijn minstens 5 keer gevolgd en vormen de basis voor de cijfers ("gevolgde coins"). Alle scripts en exports staan in `research/tail/`. Dit is onderzoek naar wat de data zeggen, geen financieel advies.*

## 1. In het kort

1. **De 1.194× en de 1.471× bestonden niet.** Het zijn drie "spookprijzen": DexScreener gaf een paar scans lang een absurde prijs en een absurde liquiditeit (bij HODL $27,6 miljoen terwijl de pool $48.000 had), daarna weer normaal. Ik had dat moeten controleren voordat ik "1 op 200" noemde. Zonder spookprijzen: 0,4% van de gevolgde coins houdt ≥50× vast (4 van 933), 2,3% houdt ≥10× vast (21), de grootste is 85×. De beste coin is 8% van alle piekwinst (was 34%).
2. **De winnaars zijn met de huidige data niet vooraf te herkennen.** Op het moment van listing zit geen kenmerk met een sterk, herhaalbaar verband (beste AUC 0,63 bij 21 winnaars, niet significant na correctie; met 21 winnaars kun je pas bij AUC ≥ 0,70 iets aantonen). Dat is geen bewijs dat het niet kan, wel dat deze data het niet laten zien.
3. **Wat het systeem aantoonbaar tegenhoudt is geen slim filter maar drie dingen eromheen:**
   - Het gooit coins bij de eerste blik weg met regels die we nergens hebben gevalideerd (één wallet ≥20%; een daling van >70% in het afgelopen uur of 6 uur), en kijkt daarna niet meer. 12 van de 21 coins die nu ≥5× hun eerste waarde staan, waren afgewezen. Een bug in `scan.ts` zorgt dat de bedoelde "leerstaart" voor afgewezen coins nooit draait: van de 633 coins in de status REJECTED zijn er 2 langer dan een uur na het oordeel nog gemeten.
   - Het mist de informatie die winnaars zou kunnen onderscheiden: 12 van de 24 gedefinieerde features hebben nog nooit een waarde gehad, 8 tabellen zijn leeg.
   - Het meet verkeerd: spookprijzen, een 24-uurs venster terwijl 38% van de ≥10×-winnaars er meer dan 24 uur over deed, en afgewezen coins worden niet beoordeeld.
4. **Wat het geld kost:** een coin kopen en met een ladder verkopen levert gemiddeld **−27%** op (mediaan −56%). Een filter moet ongeveer **AUC 0,70 tot 0,75** halen op de bovenste 10% om break-even te komen. Met de zwakke effecten die ik nu zie (AUC 0,60 tot 0,65) wordt het verlies een derde tot de helft kleiner (−9% tot −19%), niet positief.
5. **Aanbevolen aanpak:** eerst meetfouten en blinde vlekken repareren (dagen), dan niets meer weggooien bij de eerste blik, dan nieuwe gratis informatie verzamelen in schaduwmodus (Jupiter, GeckoTerminal, RugCheck leveren precies de ontbrekende gegevens), en pas na 4 tot 6 weken beslissen met een vooraf vastgelegde toets of er een filter bestaat.

## 2. Correctie op eerdere cijfers

| | oude cijfers (met spookprijzen) | gecorrigeerd |
|---|---|---|
| raakt ≥2× | 22,9% | 22,6% |
| raakt ≥5× | 6,6% | 6,3% |
| raakt ≥10× | 3,2% | 2,8% |
| raakt ≥50× | 1,0% (9 coins) | 0,6% (6) |
| raakt ≥100× | 0,4% (4) | 0,1% (1: OMNI, 117×) |
| grootste coin als aandeel van alle piekwinst | 34% | 8% |
| beste 1% als aandeel van alle piekwinst | 75% | 37% |

Strenger (de prijs moest minstens 30 minuten gehouden worden, dus verkoopbaar): ≥1,5× 22,2%, ≥2× 14,0%, ≥3× 7,9%, ≥5× 4,1%, ≥10× 2,3% (21 coins), ≥20× 1,2% (11), ≥50× 0,4% (4: OMNI, GO, DARK, SI).

De drie spookprijzen: **HODL** (liquiditeit $27,6M in 3 scans binnen een minuut, daarvoor en daarna $48K), **BONKCAT** (Raydium-paar met BONK als quote-token, $191M liquiditeit gedurende minstens 45 minuten, daarvoor en daarna $11K), **XFUN** ($547K in 2 scans, daarvoor en daarna $5K). De detector (`research/tail/common.py: flag_glitches`) markeert een meting als spook zolang de liquiditeit >20× de mediaan van de voorgaande 8 metingen is én de prijs >5×, en alleen als die daarna weer terugvalt. Hij vindt 5 coins: de drie hierboven, een coin met één spookmeting op 16× (VeilPay) en een coin met 28 gemarkeerde metingen zonder effect op de piek.

De tabel "het 5×-moment" uit het vorige antwoord blijft vrijwel gelijk (alles verkopen op 5×: 4,8×; helft op 5× plus stop 40% onder de piek: 5,7× in plaats van 5,6×). Alleen "niets verkopen" zakt van 4,4× naar 3,7×. Die tabel gaat over de 59 coins die 5× raakten, achteraf geselecteerd: hij zegt hoe je uitstapt als het gebeurt, niet of je moet instappen.

## 3. De echte staart: 21 coins die ≥10× vasthielden

| coin | piek | 2× na | 10× na | listing-mcap | liq | h1 / h6 bij listing | eindstatus |
|---|---|---|---|---|---|---|---|
| OMNI | 85× | 0,9 u | 0,9 u | $7.779 | $7K | −91% / −86% | UNRESOLVED |
| GO | 77× | 1,1 u | 20 u | $124K | $32K | +108% / +162% | UNRESOLVED |
| DARK | 58× | 10 u | 22 u | $142K | $34K | +237% / +207% | STRUCTURE_WATCH |
| SI | 50× | 1,0 u | 15 u | $149K | $38K | −40% / +213% | UNRESOLVED |
| pill | 49× | 87 u | 87 u | $77K | $25K | +57% / +65% | STRUCTURE_WATCH |
| DRMR | 37× | 1,9 u | 113 u | $14K | $9K | −22% / −64% | EXPIRED |
| GOMO | 36× | 13 u | 18 u | $67K | $23K | +205% / +66% | UNRESOLVED |
| LinkedInu | 26× | 0,9 u | 0,9 u | $105K | $30K | +2% / +19% | STRUCTURE_WATCH |
| shoggoth | 25× | 5,6 u | 9 u | $19K | $11K | −72% / −57% | STRUCTURE_WATCH |
| parafactua | 23× | 10 u | 34 u | $126K | $34K | −30% / +337% | STRUCTURE_WATCH |
| Tilcayo | 23× | 2,1 u | 2,7 u | $131K | $32K | −57% / +225% | STRUCTURE_WATCH |
| SI276 | 16× | 3,2 u | 52 u | $112K | $30K | +20% / +128% | STRUCTURE_WATCH |
| MONARK | 16× | 2,0 u | 123 u | $11K | $7K | +39% / −70% | UNRESOLVED |
| SDOG | 16× | 25 u | 59 u | $120K | $31K | −15% / +168% | UNRESOLVED |
| PQC | 16× | 6,0 u | 25 u | $116K | $32K | −4% / −37% | STRUCTURE_WATCH |
| GOUR | 15× | 1,2 u | 2,3 u | $21K | $11K | −51% / −56% | UNRESOLVED |
| KURA | 14× | 0,4 u | 1,1 u | $31K | $14K | −53% / −26% | REJECTED |
| $T800 | 13× | 89 u | 101 u | $8K | $7K | +52% / −37% | EXPIRED |
| MINER | 12× | 0,3 u | 1,3 u | $20K | $12K | −46% / −48% | STRUCTURE_WATCH |
| BSI | 11× | 3,7 u | 3,7 u | $23K | $12K | −58% / −50% | REJECTED |
| TIGRINO | 10× | 2,8 u | 3,2 u | $11K | $7K | −58% / −74% | UNRESOLVED |

Wat opvalt: 13 van de 21 haalden 2× binnen 4 uur na de eerste meting, 18 binnen 13 uur, 3 deden er meer dan een dag over. Naar 10× deed 38% (8 van 21) er meer dan 24 uur over. 10 coins stonden onder $31K bij listing, 11 tussen $66K en $149K (vlak onder de grens van $150K). 13 van de 21 stonden bij listing negatief in het afgelopen uur (OMNI: −91%). 6 van de 21 hadden een andere quote dan SOL (ZEC, NEAR, PUMP, WBTC, MSFTx, CARDS). Geen enkele was een spookprijs (liquiditeit groeit mee met de prijs, de piek houdt langer dan 30 minuten stand, Jupiter bevestigt OMNI nu met 1.061 holders en $31K liquiditeit).

Alle vier de coins ≥50× werden gevolgd, geen enkele was afgewezen. Bij hen zat het probleem niet bij het wegfilteren maar bij het kiezen: bij listing leken ze op de ±700 andere coins die door alle poorten kwamen (behalve OMNI, die door de dump-poort werd geweerd).

## 4. Wat voorspelt een winnaar? (en hoeveel kun je met deze data zien)

**Kenmerken bij listing** (36 getest, tegen 21 winnaars ≥10×, 38 winnaars ≥5×, 74 winnaars ≥3×; permutatietoets): bij ≥10× haalt niets de Bonferroni-grens (p < 0,0014). Wat het dichtst bij komt: grootste holder en top-5-holders iets hoger bij winnaars (AUC 0,62 tot 0,63, p ≈ 0,04, ongecorrigeerd). Eén uitzondering bij de ruimste definitie (≥3×): winnaars hebben bij listing minder vaak een website (51% tegen 70%, p = 0,001); bij ≥5× is dat 55% tegen 69%, bij ≥10× is er geen verschil (71% tegen 69%). Ik lees dat als hypothese voor de nieuwe data, niet als regel. Leeftijd, liquiditeit, buy/sell-verhouding, volume, socials, boosts, dex en quote-token zeggen niets.

**Vlak voor een uitbraak** (event-studie: 49 uitbraken ≥2,5× binnen 12 uur, vergeleken met gewone momenten op dezelfde leeftijd en op een lokale bodem): twee zwakke effecten. Hogere liquiditeit (AUC 0,65, p = 0,001) en meer volatiliteit (AUC 0,68; gecorrigeerd voor de scanfrequentie 0,62, p = 0,008). Volume-versnelling, buy-aandeel, trade-snelheid, boosts, tijdstip: niets. Let op: de eerste versie leek een sterke "dip vooraf" te tonen (AUC 0,33). Dat was een selectie-effect van mijn eigen uitbraakdefinitie en verdween toen de controles op dezelfde manier werden gekozen.

**Statische feiten van Jupiter** (creator-historie, launchpad, graduatietijd): geen verband. Websites en Twitter lijken bij winnaars vaker voor te komen, maar dat zijn de profielen van vandaag; coins vullen die in nadat ze stijgen. Op listing-moment (DexScreener) is het verband omgekeerd. Dit is dus lekkage, geen signaal.

**Dagpatroon:** geen clustering van winnaars op bepaalde dagen (p = 0,29), geen duidelijk uurpatroon.

**Hoeveel kun je zien:** met 21 winnaars tegen 912 anderen is de standaardfout van een AUC ongeveer 0,064. Aantonen na correctie voor 36 getoetste kenmerken kan pas vanaf AUC ≈ 0,70. Met 100 winnaars (en 2.000 anderen) kan dat vanaf ≈ 0,60. Bij 33 gevolgde coins per dag duurt 100 winnaars van ≥3× (7,9%) zo'n 5 weken, 100 winnaars van ≥10× (2,3%) zo'n 4 maanden, 30 winnaars van ≥50× (0,4%) zo'n 7 maanden. Een drie keer bredere trechter verkort dat tot 12 dagen, 6 weken en 2,3 maanden.

## 5. Wat het systeem tegenhoudt: gemeten

### 5.1 Wegsmijten bij de eerste blik

**De "één wallet ≥20%"-regel** (`packages/safety-engine/src/analyzers.ts`, `RUG.MAX_SINGLE_HOLDER = 0.20`, in de code onderbouwd met "published trader practice"). Bij 263 coins (19% van alles) leidde dit tot REJECTED. Deze coins werden mediaan 18 minuten en 3 metingen gevolgd; 5% langer dan 6 uur. Wat deden ze daarna (vandaag, relatief tot de eerste waarde, liquiditeit ≥$5K):

| | afgewezen door deze regel | alles daarbuiten | p (Fisher) |
|---|---|---|---|
| nu ≥2× | 5,3% (14 van 263) | 2,7% | 0,050 |
| nu ≥5× | **3,4% (9 van 263)** | 1,1% | **0,009** |
| nu ≥10× | 0,4% (1) | 0,7% | 1,0 |
| nu dood (geen paar of liquiditeit <$5K) | 60% | 63% | 0,36 |

Dus: geen aantoonbare bescherming tegen sterven, en juist meer coins die 5× zijn gegaan. Uit de 21 coins die nu ≥5× staan zijn er 12 afgewezen (9 door deze regel, 3 door "hard safety failure"), waarvan 2 met ≥16× (18× en 17×, liquiditeit $127K en $75K). Let op: dit is één regel uit ±14 verdictgroepen die ik bekeek, dus p = 0,009 is indicatief, geen bewijs. De andere grote groepen zitten op 0,6% tot 2,1% alive-≥5× (een kleine groep van 25 coins op 8%).

**De dump-poort die elke tab gebruikt** (`apps/web/app/api/safety-gate/route.ts`: −70% in 1 uur, −70% in 6 uur, −80% in 24 uur, plus sell/buy-pieken). Ik heb `evaluatePair` exact nagebouwd en losgelaten op de opgeslagen listing-snapshots. Bij listing blokkeert hij 224 van 933 coins (24%), waaronder 5 van de 21 winnaars (OMNI 85×, shoggoth 25×, MONARK 16×, $T800 13×, TIGRINO 10×). Vooruitkijkend vanaf het moment van de check (volgende 72 uur, ladder met stop, 5% kosten):

| check op | geblokkeerd: gemiddeld | doorgelaten: gemiddeld |
|---|---|---|
| bij listing | −25,9% (217 coins) | −29,9% (694) |
| +1 uur | −15,8% (181) | −27,0% (533) |
| +3 uur | −22,8% (191) | −26,4% (451) |
| +6 uur | −11,4% (141) | −32,6% (372) |
| +24 uur | −20,9% (91) | −22,7% (263) |

Op geen enkel moment doet de doorgelaten groep het beter. Dat past bij §6: de poort weert coins die al gedaald zijn, en gedaalde coins hebben gemiddeld minder neerwaarts risico dan coins die nog op hun top zitten. (Een eerdere variant van deze toets, "coins die ≥10× werden, per poortstatus op uur X", leek de poort juist te bevestigen, maar liep vooruit op de toekomst: de piek kon al voor het meetmoment liggen. Daarom bovenstaande toets met alleen de periode erna.)

**Wat wél lijkt te werken:** de groep "hard safety/market failure" (866 coins, mediaan 24 uur gevolgd): 25% valt binnen 6 uur naar ≤30% van de beginprijs (tegen 7% tot 18% bij de andere groepen) en maar 0,6% staat nu ≥5×. En de "top-5 ≥60%"-regel: de 58 coins erboven zijn vaker dood (79% tegenover 63%, p = 0,012) en maar één staat nu ≥5×. Die regels laat ik staan.

### 5.2 Afgewezen coins worden niet gevolgd, ondanks de bedoeling (bug)

`apps/worker/src/verdicts.ts` beschrijft het precies: zonder gevolgde afwijzingen kun je niet weten of een filter dat alles afwijst goed of waardeloos is. Daarom krijgt een afgewezen coin `observe_until` en een "leerstaart" van 24 uur met 10 minuten cadans (`LEARNING_TAIL_MS`, `LEARNING_TAIL_CADENCE_MS`). Alle 263 "één wallet"-afwijzingen hebben `observe_until` ingevuld. Toch hadden ze gemiddeld 0,3 metingen na het oordeel. Over alle 633 coins in de status REJECTED: **2 zijn langer dan een uur na het oordeel nog gemeten, de mediaan is 0 metingen.**

Oorzaak: `dueCandidates()` en `freshCandidates()` in `apps/worker/src/scan.ts` sluiten `monitoring_tier = 'TIER0_DORMANT'` altijd uit, en `tiers.ts` zet elke REJECTED/EXPIRED op TIER0_DORMANT (alle 693 coins in die twee statussen staan daar). De cadans wordt wel weggeschreven, maar de coin wordt nooit geselecteerd. Oordelen die later vallen terwijl de coin nog actief is (bijvoorbeeld "hard safety failure" na uren) worden wél gevolgd: gemiddeld 144 metingen erna.

Gevolg: het eigen cijfer van het systeem voor "REJECTED / één wallet" is 0,0% winnaars (`verdict_outcomes`), puur omdat er niets gemeten is. Het gemeten werkelijke cijfer is 3,4% voor ≥5×.

### 5.3 De statuslabels dragen geen informatie

560 van 1.398 coins komen ooit in STRUCTURE_WATCH ("Safety passed; quality developing"), meestal ±1 uur na de eerste blik. Vooruitkijkend vanaf dat moment: ≥2× 14%, ≥5× 4,7%, ≥10× 2,5% (n = 553), gelijk aan de basis. De overgang UNRESOLVED ↔ STRUCTURE_WATCH gebeurt 12.745 keer ("Critical safety data is incomplete" tegenover "Safety passed"), dus de status volgt vooral of de gegevensbron antwoordde. De trap erboven wordt nooit bereikt: 3 ENTRY_READY-oordelen in 4.233, geen overgang naar ENTRY_WATCH of ENTRY_READY, en 6 naar QUALITY_CONFIRMED (met als reden alleen "t", dus waarschijnlijk testrijen). (Een eerder gelezen "10,5% van STRUCTURE_WATCH-coins is ≥5×" kwam uit `reached_state` en is een overlevingsartefact.)

### 5.4 De informatie die winnaars zou kunnen onderscheiden ontbreekt

12 van de 24 gedefinieerde features hebben **nooit** een waarde: `unique_buyer_growth`, `unique_seller_growth`, `buyer_seller_ratio`, `buyer_concentration`, `wallet_group_diversity`, `smart_wallet_count`, `smart_wallet_hold_ratio`, `smart_wallet_net_flow`, `attention_velocity`, `boost_dependency`, `bundle_contamination`, `source_agreement`. Tabellen zonder rijen: `holder_snapshots`, `deployers`, `funding_wallets`, `launch_bundles`, `social_observations`, `bonding_curve_metrics`, `whale_positions`, `insider_activity`. In de on-chain verrijking is `bundle_contamination` voor 1.357 van 1.357 coins INCOMPLETE, `liquidity_drain` voor 1.268, `wallet_clusters` UNAVAILABLE. De reden staat in het systeem zelf: de gratis RPC kan de geschiedenis niet ver genoeg teruglezen.

### 5.5 Meetfouten

Spookprijzen (§2). Het leervenster is 6 tot 24 uur, terwijl 38% van de ≥10×-winnaars er meer dan 24 uur over deed naar 10×. Een winnaar is "2× op één meting", zodat één spookprint genoeg is om een coin te labelen. De afgewezen coins hebben 0% winnaars omdat ze niet gemeten worden (§5.2).

### 5.6 Steekproef

±50 coins per dag ontdekt, ±33 per dag gevolgd. Zie §4 voor wat dat betekent voor de tijd tot bewijs.

## 6. Wat wél werkt (klein) en wat het kan opleveren

**Niet kopen op de top.** Instappen met de ladder (6 uur, helft op 2× plus 40% trailing stop, 5% kosten) afhankelijk van waar de prijs staat ten opzichte van de hoogste prijs sinds de eerste meting (alleen coins met liquiditeit ≥$6K en een volledig venster):

| prijs t.o.v. zijn hoogste | coins | gemiddeld resultaat | in 1e/2e helft van de data |
|---|---|---|---|
| op een nieuwe top (≥99%) | 530 | **−31%** [−35, −28] | −32% / −31% |
| 90 tot 99% | 409 | −26% | −26% / −25% |
| 70 tot 90% | 462 | −24% | −23% / −26% |
| 50 tot 70% | 423 | −22% | −19% / −25% |
| 30 tot 50% | 310 | −13% [−20, −6] | −17% / −9% |
| <30% | 185 | 0% [−10, +13] | −5% / +7% |

De bovenkant is stabiel in beide helften; de onderkant is ruisig. Met een bredere toets (ladder, 72 uur, instappunten elke 30 minuten): onder 30% of 50% van de 24-uurs-top levert in de testhelft −16% op tegen −27% voor alle instappunten. De "run sinds listing" (hoeveel keer de coin al steeg) is *niet* robuust: hij verschilt per helft. Daarom neem ik hem niet mee.

**Wat het systeem lijkt te doen:** het werkt in de tegenovergestelde richting. De poort weert coins die zijn gedaald, en CATE beloont stijgende koopactiviteit en "versheid". Ik heb de uitvoer van de tabs zelf niet gemeten, dus dit is een afleiding uit de regels, geen meting.

**Economie van een coin kopen** (alle gevolgde coins met ≥8 metingen, instap op de eerste prijs, 7 dagen, 5% op elke verkoop):

| plan | gemiddeld | mediaan | eindigt ≥1× |
|---|---|---|---|
| 7 dagen vasthouden | −44,9% | −84% | 8% |
| stop −50% | −36,8% | −58% | 6% |
| alles verkopen op 5× (stop −50%) | −37,2% | −57% | 8% |
| ladder 25% op 2×, 5×, 10×, rest met 40% trailing stop, stop −50% | **−27,3%** [−33, −21] | −56% | 20% |
| ladder, 30 minuten later instappen | −26,3% | −55% | 20% |

Zonder de beste coin −29,2%: het gemiddelde hangt niet aan één uitschieter. Verdeeld over de tijd: −29,5% (eerste helft), −25,0% (tweede helft).

**Hoeveel filtervaardigheid is nodig?** Stel een filter herkent de 74 coins die ≥3× vasthielden met AUC = x, en je koopt alleen de beste 20% of 10%:

| AUC | beste 20%: gemiddeld | beste 10%: gemiddeld | winnaars behouden (20%) |
|---|---|---|---|
| 0,50 | −27,5% | −26,8% | 20% |
| 0,60 | −18,7% | −16,1% | 30% |
| 0,65 | −13,4% | −8,5% | 36% |
| 0,70 | −7,9% | +1,0% | 43% |
| 0,80 | +5,8% | +23,3% | 59% |
| 0,90 | +21,7% | +54,9% | 77% |

Break-even ligt dus rond **AUC 0,70 tot 0,75** op de beste 10%. De beste signalen die ik zag zitten rond 0,62 tot 0,68 (in de steekproef, onzeker).

**Er is geen "zak" met positief resultaat.** Ik zocht 24 vaste regels (positie t.o.v. de 24-uurs-top × liquiditeit × activiteit) met een tijdsplitsing. De beste regel uit de eerste helft (+28,5%, 32 coins) gaf in de tweede helft +0,6% [−37%, +49%]. Hoge liquiditeit (≥$15K tot $25K) en veel trades per uur gaven juist een slechter resultaat (−37% tot −39%, −34%).

## 7. Gratis informatiebronnen die ik heb getest

| bron | geeft | vult welke ontbrekende feature |
|---|---|---|
| Jupiter `lite-api.jup.ag/tokens/v2/search?query=<mint,mint,…>` (geen sleutel; 50 mints per call getest, 1.396 van 1.414 mints gevonden) | `holderCount`, `stats5m/1h/6h/24h` met `numTraders`, `numOrganicBuyers`, `numNetBuyers`, `holderChange`, `buyVolume`/`sellVolume`, `buyOrganicVolume`, `organicScore`, `audit.devMints`/`devMigrations`/`topHoldersPercentage`, `launchpad`, `graduatedAt` | unique_buyer_growth, buyer_seller_ratio, attention (organisch), deployer-historie |
| GeckoTerminal `tokens/{mint}/info` | `holders.count` en verdeling (top 10, 11–20, 21–40, rest), `gt_score` en onderdelen, `developer_holding_percentage`, `launchpad_details` | holder_snapshots |
| GeckoTerminal `pools/{pool}/trades` | laatste 300 trades met `tx_from_address`, `kind`, volume | buyer_concentration, wallet_group_diversity (herhaalde wallets, bots), unique buyers per venster |
| RugCheck `tokens/{mint}/report` (publiek) | `creator`, `creatorTokens`, `graphInsidersDetected`, `insiderNetworks`, `totalHolders`, `totalLPProviders`, `lockers` | bundle/insider-features |

Allemaal momentopnames, geen historie: ze moeten vanaf nu elke ronde worden vastgelegd om er later op te kunnen toetsen. Rate-limits: GeckoTerminal ±30 per minuut per IP, gedeeld met de lokale worker (mijn eigen downloads gaven regelmatig 429). Jupiter heeft geen sleutel en is vriendelijker per mint.

## 8. De beste aanpak

### Vergeleken opties

| aanpak | oordeel |
|---|---|
| **A. Filters afstellen op de data die er nu is** | Niet doen. 21 winnaars geven geen kracht, elke drempel die ik nu kies is ruis. De enige regels die houden zijn "niet kopen op de top" (klein, stabiel). |
| **B. Loterij met discipline** (kleine inzet, ladder, stop, een vast maximum aantal coins per dag) | Doet de gebruiker al deels. Haalbaar nu, maar structureel verliesgevend (−27%). Wel de beste verdediging zolang er geen edge is. |
| **C. Nieuwe informatie verzamelen en toetsen (aanbevolen)** | Is de enige route naar AUC ≥0,70. Vult precies de lege features. Goedkoop (gratis API's), traag (weken), onzeker. |
| **D. Slimme wallets volgen** | Klassiek, maar vraagt betaalde of eigen on-chain data en een lijst met bewezen wallets. Later, als C iets laat zien. |
| **E. Sneller zijn dan anderen (sniping)** | Niet haalbaar tegen bots; de data laten ook zien dat de winnaars uren tot dagen na listing liepen. |

### Fasering en wijzigingen

**Fase 0: meetfouten en blinde vlekken (1 tot 2 dagen, geen nieuwe data)**

| wijziging | waar | bewijs |
|---|---|---|
| Spookprijs-bewaker: een meting met liquiditeit >20× de mediaan van de vorige 8 én prijs >5× markeren als verdacht (`evidence_status` / `data_quality_confidence` bestaan al), uitsluiten uit pieken, uitkomsten en meldingen; `candidate_research` herberekenen met bevestigde pieken (30 minuten gehouden) | `apps/worker/src/pipeline.ts`, `apps/web/lib/learning-engine.ts` (`decideOutcome`: 2× of <0,5× pas na een bevestigende tweede meting), `research/tail/common.py` als referentie | §2 |
| Leerstaart laten werken: dormante coins met `observe_until > now()` meenemen in de selectie; in de cloud een lichte staart (alleen DexScreener-prijzen, 30 mints per call, geen volledige pipeline) om binnen het gratis CPU-budget te blijven | `apps/worker/src/scan.ts` (twee queries), cloud: `apps/worker/src/run.ts`, `apps/web/lib/cloudScan.ts` | §5.2 |
| Venster verlengen: 72 uur voor afgewezen coins, horizons d3 en d7 en drempels 5× en 10× in de beoordeling | `apps/worker/src/verdicts.ts` (`VERDICT_HORIZONS`, `LEARNING_TAIL_MS`) | §5.5 |
| Status "STRUCTURE_WATCH/UNRESOLVED" niet meer als signaal gebruiken | `packages/rule-engine/src/transition.ts` en de tabs die erop steunen | §5.3 |

**Fase 1: niet meer weggooien bij de eerste blik (2 tot 3 dagen)**

| wijziging | waar | bewijs |
|---|---|---|
| "Één wallet ≥20%" van `blocking` naar `concerns` (risicobadge, coin blijft gevolgd). De rest blijft blokkeren: authorities, hard safety/market failure, actieve dump-patronen en ook "top-5 ≥60%" (58 coins erboven, 79% nu dood, 1 staat ≥5×) | `packages/safety-engine/src/analyzers.ts` | §5.1 |
| In de web-poort de pure prijsregels (h1 <−70%, h6 <−70%, h24 <−80%) van "verbergen" naar label "gedaald", de ratio-gebaseerde dump-combinaties (sell/buy >3 à 4 met m5 <−40 à −50%) blijven verbergen | `apps/web/app/api/safety-gate/route.ts` | §5.1 |
| "Koopt op de top"-waarschuwing: toon "X% onder de 24-uurs-top" op elke kaart, waarschuw bij ≥90% (−31% tegenover −13%) | radar-kaarten, `apps/web/app/radar/page.tsx`, `apps/web/lib/my-trades.ts` (bewaar `entry_dd`) | §6 |

**Fase 2: nieuwe informatie in schaduwmodus (1 tot 2 weken bouwen, 4 tot 6 weken verzamelen)**

| wijziging | waar |
|---|---|
| Tabel `coin_signals_ts` (candidate, tijd, bron, velden uit §7) en een verzamelaar die elke 10 tot 15 minuten Jupiter-batches ophaalt voor alle gevolgde coins, GeckoTerminal-info per uur en -trades voor de ±30 meest actieve, RugCheck bij +0 en +1 uur | nieuwe migratie `0028`, `apps/worker/src/` (lokaal), `apps/web/lib/cloudScan.ts` (cloud, lichter) |
| De 12 lege features invullen vanuit die tabel | `packages/feature-engine` |
| Trechter breder in alleen-observeren-modus (niet op de radar): `DISCOVERY_MAX_MCAP_USD` 150K naar 300K, `DISCOVERY_MIN_AGE_MINUTES` 60 naar 30, `DISCOVERY_MIN_LIQUIDITY_USD` 6K naar 4K. Verwacht 2 tot 3× meer coins per dag. Eerst op de laptop (geen opslagbudget), pas later in de cloud | `.env` / `apps/worker` |

**Fase 3: toetsen en pas dan gebruiken (week 5 tot 8)**

1. De scripts uit `research/tail/` wekelijks draaien op de groeiende data (export, `tail_features.py`, `event_study.py`, `policy_ev.py`, `pocket.py`), met een vooraf vastgelegde hypothesenlijst (maximaal 10) in `research/tail/HYPOTHESES.md` die ik schrijf **voordat** de nieuwe data erin zit.
2. Een eenvoudig model (logistische regressie, ≤8 features, monotoon) op de eerste 60% van de coins naar listingdatum, getoetst op de laatste 40%. Alleen doorgaan als AUC ≥0,70 én de ondergrens (90%) van de verbetering op de beste 20% >0 ligt.
3. Eerst twee weken als `shadow_signals` (bestaat al), dan als badge op de radar, pas daarna als filter.
4. Uitstappen: ladder-meldingen (2×, 5×, 10×, −40% vanaf de piek) via Telegram en het prijsverloop per trade in het dagboek. Dit vraagt de 24/7-scan (Supabase `pg_cron`).

**Beslismoment:** als na 4 weken nieuwe data (minstens 60 winnaars ≥3×) geen kenmerkenset een AUC ≥0,65 haalt, stop dan met zoeken naar filters en gebruik het systeem als meet- en risicotool met een ladder. Dat is ook een bruikbaar antwoord.

### Verwachting, eerlijk

- Fase 0 en 1 geven geen winst, ze geven correcte metingen, meer kandidaten en minder kopen op de top. Het gemeten effect van "niet op de top" is ongeveer 10 tot 18 procentpunt op het gemiddelde resultaat per coin.
- Met zwakke signalen (AUC 0,60 tot 0,65) wordt het gemiddelde ongeveer −9% tot −19% in plaats van −27%. Positief wordt het pas bij AUC ≈0,70 tot 0,75 op de bovenste 10%.
- Of de nieuwe databronnen (unieke handelaren, holder-groei, organische kopers, insider-netwerken) dat halen weet niemand; dat is precies wat fase 2 en 3 moeten uitmaken. Plausibel, niet gegarandeerd.

### Wat ik niet zou doen

- Drempels afstellen op de 21 winnaars die er nu zijn.
- Nog meer handgemaakte poorten en scores toevoegen zonder uitkomstmeting ("published trader practice" is geen bewijs).
- Een enkele coin of 1.000× als doel nemen. Die bestaan in deze data niet.
- Betaalde databronnen kopen vóór de gratis zijn getoetst.
- Het eerste uur van coins na listing proberen te sniper-en.

## 9. Bijlage: de negen coins uit de screenshots

Instap-markers staan in de screenshots; de exacte instaptijd en -prijs zijn niet bekend (dagboek bestond nog niet), dus ik reken niets uit over jouw winst of verlies per moment. Wel de uitkomst per coin, plus wat het systeem zag.

| coin | wat de grafiek toont | jouw uitkomst (wat er van de positie over is, of het getoonde verlies) | systeem: gezien op | piek vóór listing | beste moment na listing |
|---|---|---|---|---|---|
| Buto | marker op de daling na de piek | positie $0,06 | $122K, 2 u 45 na ontstaan | $483K (4,0× zo hoog) | +31% na 23 min, daarna −97% |
| DEXPAD | marker halverwege de daling | positie $0,10 | $142K, op de top ($153K) | 1,1× | +0% |
| COW | marker op de daling | −$1,72 (−90,6%) | $14K | $60K (4,2×) | +75% na 7 u |
| COUSCOUS | marker op de top-wiek | positie $0,11 | $68K | geen | +221% (3,2×) na 100 min |
| HASHERS | marker vóór de piek, verkoop bij de top | +$0,32 (+11,1%) | $149K | geen | +433% (5,3×) na 134 min |
| Bilbo | marker na de eerste piek | −$1,69 (−89,2%) | $35K | $76K (2,1×) | +76% na 3,4 u |
| him | marker na de piek | −$1,65 (−86,7%) | $23K (−72% in het uur ervoor) | onbekend | onbekend (geen candles) |
| ANISOM | marker op de daling | positie $0,10 | niet in de database | | |
| BEAN (BNB) | twee markers (top en daling) | −$3,31 (−87,6%) | niet in de database | | |

Vier van de zes coins die ik kon controleren hadden hun grootste piek al achter de rug toen het systeem ze voor het eerst zag; bij twee (COUSCOUS, HASHERS) kwam de piek 100 tot 134 minuten later. In het systeem staat 76% van de coins bij listing al ≥50% onder zijn eigen top (n = 154 met candles), dus dat patroon is de regel. In de systeemgeschiedenis (933 coins) wijkt het verwachte resultaat van instappen op de top (−31%) duidelijk af van instappen 30 tot 50% eronder (−13%).

## 10. Beperkingen

- Eén marktperiode van vier weken, 933 gevolgde coins (alleen wat het systeem toeliet: leeftijd ≥60 min, mcap ≤$150K, liquiditeit ≥$6K). Wat het nooit zag, weet ik niet.
- 21 winnaars ≥10×, 4 winnaars ≥50×: de betrouwbaarheidsintervallen zijn breed, en de gemiddelden hangen aan een paar coins.
- Uitkomsten zijn gemeten op de prijzen die het systeem op dat moment zag (elke 2 tot 5 minuten, soms langer). Verkopen worden op het niveau of de geziene prijs aangenomen; bij snelle rugs is dat optimistisch.
- De dump-poort is exact nagebouwd uit de code en losgelaten op opgeslagen snapshots (zonder de `unverified`-paden). De een-wallet-regel heb ik beoordeeld op wat het systeem zelf opsloeg en op de uitkomsten van vandaag. De per-tab scores (CATE, buy signals, ultra momentum, elite, incubation) heb ik niet kunnen terugspelen.
- De spookdetector is afgesteld door vijf coins te bekijken; zie de beschrijving in §2. Andere soorten foutieve prints kunnen er nog tussen zitten.
- Dit document toetst veel dingen. Elke p-waarde buiten de genoemde Bonferroni-gronden hoort als verkenning te worden gelezen.

## 11. Reproduceren

```bash
cd research/tail
./export.sh                  # leest uit de lokale database naar /tmp/pat (TAIL_DATA om te wijzigen)
python3 fetch_now.py         # huidige stand per coin (DexScreener)
python3 fetch_jup.py         # Jupiter-feiten per coin
python3 glitch.py            # §2, spookprijzen en de gecorrigeerde staart
python3 tail_features.py     # §3 en §4, opgeschoonde paden, winnaarstabel, kenmerken bij listing (schrijft coins.pkl)
python3 event_study.py       # §4, uitbraak-studie
python3 entry_state2.py      # §6, positie t.o.v. de top
python3 policy_ev.py         # §6, economie en filtervaardigheid
python3 pocket.py            # §6, regelzoektocht met tijdsplitsing
python3 gate_replay.py       # §5.1, de dump-poort nagespeeld op opgeslagen snapshots
python3 rejects_now.py       # §5.1, wat de afgewezen coins daarna deden
```

De exports zijn een momentopname van de lokale database; de worker draait door, dus nieuwe runs geven licht andere aantallen dan in dit document.
