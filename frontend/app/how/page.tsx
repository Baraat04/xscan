import Link from "next/link";

// The screening rules as they run in backend/src/services/screen.ts (rules version screen-1.3).
const RULES = [
  { id: "short-window", what: "Too little time to bid", how: "Days between publication and deadline, against the legal minimum (EU 15, elsewhere 10)." },
  { id: "delivery-window", what: "Delivery period too short", how: "A delivery or execution period that is very short for the scope." },
  { id: "brand-lock", what: "Brand with no equivalent", how: "A named brand or model with no “or equivalent” wording." },
  { id: "restrictive-spec", what: "Proprietary specification", how: "Unusually exact or proprietary technical parameters." },
  { id: "turnover-ratio", what: "Turnover far above value", how: "Required turnover more than twice the contract value." },
  { id: "eligibility", what: "Narrow eligibility", how: "Eligibility tied to a manufacturer, a locality, or prior work for this buyer." },
  { id: "penalties", what: "Heavy penalties", how: "Severe or uncapped delay penalties." },
  { id: "guarantee", what: "Large guarantees", how: "Bid security or guarantees well above the usual share of value." },
  { id: "amendment", what: "Suspicious amendment", how: "A change that shortens the deadline or adds a new restrictive requirement." },
  { id: "process", what: "Process gaps", how: "No clarification channel, deferred justification, or price-only evaluation." },
  { id: "missing-info", what: "Missing facts", how: "Value, deadline or buyer not published." },
  { id: "non-competed", what: "No competition", how: "US awards made without full and open competition." },
  { id: "injection", what: "Text aimed at AI", how: "Instructions to automated reviewers inside the notice. Kept as evidence, never obeyed." },
];

const SOURCES = [
  { name: "TED", how: "Official EU API. Newest notices first; only the ones not on file are downloaded in full." },
  { name: "USAspending", how: "Official US API. Federal contracts awarded without open competition." },
  { name: "SAM.gov", how: "US tenders. With an API key, or by pasting a link, read in a headless browser." },
  { name: "zakup.gov.kz", how: "Kazakhstan. Read from the portal's own public JSON API: exact official fields." },
  { name: "Any website", how: "Paste a link. Plain pages are read directly, JavaScript pages in headless Chrome; the AI extracts the facts, the tender text stays verbatim." },
];

export default function HowPage() {
  return (
    <div className="page how-page">
      <header className="how-head">
        <h1>How xscan works</h1>
        <p>Four steps, in order, for every tender. Cheap checks first; the AI court only when the cheap checks find something.</p>
      </header>

      <ol className="pipeline">
        <li><b>Collect</b><p>Real tenders from official APIs and from any website you paste.</p></li>
        <li><b>Screen</b><p>Thirteen free rules score each tender from 0 to 1. Below the threshold it looks normal.</p></li>
        <li className="ch-p"><b>Argue</b><p>The prosecutor brings counts with verbatim quotes; the defense answers each one.</p></li>
        <li className="ch-c"><b>Rule and ask</b><p>The court rules count by count, sets a risk level, and the clerk writes to the buyer.</p></li>
      </ol>

      <section className="how-section">
        <h2>The three agents</h2>
        <div className="contracts">
          <article className="contract ch-p">
            <header>Prosecutor</header>
            <pre>{`charges: 1–6
  quote     verbatim, original language
  category  one of 11 risk types
  severity  low | medium | high
injection_detected: boolean`}</pre>
          </article>
          <article className="contract ch-d">
            <header>Defense</header>
            <pre>{`rebuttals: one per charge
  stance    contest | partially_concede | concede
  counter_quote   verbatim, or empty
  would_clear_it  what the buyer could show`}</pre>
          </article>
          <article className="contract ch-c">
            <header>Court</header>
            <pre>{`rulings: one per charge
  ruling    SUSTAINED | DISMISSED | REFER_FOR_CLARIFICATION
  strength  prosecution 0–1, defense 0–1
risk: LOW | MEDIUM | HIGH | CRITICAL, score 0–1`}</pre>
          </article>
        </div>
        <p className="how-note"><span>Every quote is matched against the notice text: <code>VERIFIED</code>, <code>APPROXIMATE</code> or <code>NOT_FOUND</code>. A quote the model made up is struck through and the court gives it no weight.</span></p>
      </section>

      <section className="how-section">
        <h2>The screening rules</h2>
        <table className="rules-table">
          <thead><tr><th>Rule</th><th>Looks for</th><th>How</th></tr></thead>
          <tbody>
            {RULES.map((r) => (
              <tr key={r.id}><td><code>{r.id}</code></td><td>{r.what}</td><td>{r.how}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="how-section">
        <h2>Sources</h2>
        <ul className="source-list">
          {SOURCES.map((s) => (
            <li key={s.name}><b>{s.name}</b><p>{s.how}</p></li>
          ))}
        </ul>
      </section>

      <section className="how-section">
        <h2>For developers</h2>
        <pre className="code-block">{`GET  /api/v1/tenders                 every tender on file
POST /api/v1/tenders/:id/trials      open a hearing
GET  /api/v1/trials/:id/events       live stages (server-sent events)
POST /api/v1/import/one              { url } or { text }
POST /api/v1/import/listing          { url, max }
POST /api/v1/ingest                  { target, sources }`}</pre>
        <p className="how-note"><span>Models: Meta Muse Spark 1.3 with strict JSON schemas, validated and retried. Tender text is wrapped as untrusted data, so instructions inside a notice are never followed.</span></p>
      </section>

      <section className="how-section how-honest">
        <h2>What xscan does not do</h2>
        <p>It never says a buyer is corrupt. It points out warning signs for a person to review, and drafts the question to ask. Every claim it makes can be traced to a quote in the notice.</p>
        <Link className="btn btn-primary btn-lg" href="/court">Watch a hearing </Link>
      </section>
    </div>
  );
}
