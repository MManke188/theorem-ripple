// Cuts a downloaded Wikipedia article (.import/pages/<qid>.json) down to the
// parts the models are shown. Used by write.cjs, links.cjs and check.cjs.
//
//   intro     the text before the first heading
//   formal    the start of the section that states the claim precisely (Statement, Formulation,
//             The theorem, ...), or of the first section when no heading says so. In the pilot the
//             intro alone was too vague to state the claim for a third of the articles.
//   history   the start of a section called History, Background or similar (dates and names)
//   mentions  every sentence that links to another statement on the candidate
//             list or on the map: { target, sentence, paragraph }
//
// Run on its own to look at one article:  node tools/import/pieces.cjs "Rolle's theorem"
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', '.import');

// Templates whose content is part of the sentence. Everything else in {{...}} is dropped.
const KEEP = /^(math|mvar|nowrap|nobr|em|var|tmath|abs|lang|lang-\w+|transl|harv|harvtxt|harvnb|harvs|harvard citation text|harvard citation no brackets|harvard citations|sfrac|frac|sub|sup|circa|c\.|pi|=|!|snd|spaced ndash|ndash|mdash|overline|bigmath|closed-closed|open-open|closed-open|open-closed)$/i;

function template(body) {
  const parts = body.split('|');
  const name = parts[0].trim();
  if (!KEEP.test(name)) return '';
  const named = Object.fromEntries(parts.slice(1).filter((p) => /^\s*\w+\s*=/.test(p)).map((p) => [p.split('=')[0].trim(), p.slice(p.indexOf('=') + 1).trim()]));
  const plain = parts.slice(1).filter((p) => !/^\s*\w+\s*=/.test(p)).map((p) => p.trim());
  const low = name.toLowerCase();
  if (low === 'pi') return 'π';
  if (low === '=') return '=';
  if (low === '!') return '|';
  if (/ndash|snd/.test(low)) return ' – ';
  if (low === 'mdash') return ' — ';
  if (low === 'sub') return `_${plain[0] || ''}`;
  if (low === 'sup') return `^${plain[0] || ''}`;
  if (low === 'sfrac' || low === 'frac') return plain.length > 1 ? `${plain.at(-2)}/${plain.at(-1)}` : `1/${plain[0]}`;
  if (low === 'circa' || low === 'c.') return `c. ${plain[0] || ''}`;
  if (/^harv/.test(low)) {
    // {{harvtxt|Erdős|1946}} and {{harvs|txt|last=Atiyah|year=1963}} carry who and when.
    const who = [named.last, named.last2, ...plain.filter((p) => p !== 'txt' && !/^\d{4}/.test(p))].filter(Boolean).join(' and ');
    const when = named.year || plain.find((p) => /^\d{4}/.test(p)) || '';
    return `${who} (${when})`;
  }
  if (/^lang|^transl/.test(low)) return plain.at(-1) || '';
  const interval = /^(closed|open)-(closed|open)$/.exec(low); // {{closed-open|a, b}} is the interval [a, b)
  if (interval) return `${interval[1] === 'closed' ? '[' : '('}${plain.join(', ')}${interval[2] === 'closed' ? ']' : ')'}`;
  return plain.join(' ');
}

// Wiki source to readable text. Links stay as [[Target|shown text]] so that
// `mentions` can find them; `unlink` turns them into the shown text.
function clean(wikitext) {
  let t = wikitext
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<math[^>]*>([\s\S]*?)<\/math>/g, (_, m) => `$${m.replace(/\s+/g, ' ').replace(/[{}|]/g, (c) => ({ '{': '⟪', '}': '⟫', '|': '∣' })[c]).trim()}$`)
    .replace(/<(gallery|syntaxhighlight|source|pre)[^>]*>[\s\S]*?<\/\1>/g, '');
  for (let i = 0, before; i < 30 && before !== t; i++) {
    before = t;
    t = t.replace(/\{\|(?:(?!\{\|)[\s\S])*?\|\}/g, ''); // tables
    t = t.replace(/\{\{([^{}]*)\}\}/g, (_, body) => template(body));
    t = t.replace(/\[\[(?:File|Image|Category):(?:[^[\]]|\[\[[^[\]]*\]\])*\]\]/gi, '');
  }
  return t
    .replace(/⟪/g, '{')
    .replace(/⟫/g, '}')
    .replace(/∣/g, '|')
    .replace(/<sub>(.*?)<\/sub>/g, '_$1')
    .replace(/<sup>(.*?)<\/sup>/g, '^$1')
    .replace(/<br\s*\/?>/g, ' ')
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;|&thinsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&minus;/g, '−')
    .replace(/\[https?:\/\/\S+ ([^\]]*)\]/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([,.;])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const unlink = (t) => t.replace(/\[\[(?:[^[\]|]*\|)?([^[\]]*)\]\]/g, '$1');
const canon = (title) => {
  const s = title.split('#')[0].replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function sections(text) {
  const out = [{ heading: '', body: '' }];
  for (const line of text.split('\n')) {
    const m = /^==+\s*(.*?)\s*==+\s*$/.exec(line);
    if (m) out.push({ heading: m[1], body: '' });
    else out.at(-1).body += line + '\n';
  }
  return out;
}

// Article title (or a title that redirects to it) -> { qid, title, existing }.
let targets = null;
function targetIndex() {
  if (targets) return targets;
  targets = new Map();
  for (const c of JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8'))) {
    const file = path.join(dir, 'pages', `${c.qid}.json`);
    const aliases = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).aliases : [];
    for (const t of [c.title, ...aliases]) targets.set(canon(t), c);
  }
  return targets;
}

function pieces(qid, { introMax = 2600, formalMax = 3000, historyMax = 1200, sentenceMax = 500 } = {}) {
  const page = JSON.parse(fs.readFileSync(path.join(dir, 'pages', `${qid}.json`), 'utf8'));
  const text = clean(page.wikitext);
  const secs = sections(text);
  const hist = secs.find((s) => /^(history|background|origins?|historical|discovery|history and|statement and history)/i.test(s.heading));
  const formal =
    secs.find((s) => /^(formal |precise |mathematical )?(statement|formulation)|^(the |statement of the )?(theorem|lemma|inequality|identity|formula|conjecture|problem|result|criterion|law)s?( statement)?$/i.test(s.heading)) ||
    secs.slice(1).find((s) => s !== hist && s.body.trim().length > 80 && !/^(see also|references|notes|external links|further reading|bibliography|citations|sources|history|examples?|applications?)/i.test(s.heading));
  const index = targetIndex();
  const mentions = [];
  const seen = new Set();
  for (const s of secs) {
    if (/^(see also|references|notes|external links|further reading|bibliography|citations|sources)$/i.test(s.heading)) continue;
    for (const paragraph of s.body.split(/\n+/)) {
      for (const sentence of paragraph.split(/(?<=[.!?])\s+(?=[A-Z[('"])/)) {
        for (const [, raw] of sentence.matchAll(/\[\[([^[\]|]*)(?:\|[^[\]]*)?\]\]/g)) {
          const target = index.get(canon(raw));
          if (!target || target.qid === qid) continue;
          const shown = unlink(sentence).replace(/^[*#:;]+\s*/, '').trim();
          const key = `${target.qid}|${shown}`;
          if (seen.has(key) || shown.length < 25) continue;
          seen.add(key);
          // `paragraph` is what stands around the sentence, for the second look at a link (linkcheck.cjs).
          mentions.push({ target: target.qid, title: target.title, existing: target.existing, section: s.heading, sentence: shown.slice(0, sentenceMax), paragraph: unlink(paragraph).trim().slice(0, 1100) });
        }
      }
    }
  }
  return {
    qid,
    title: page.title,
    intro: unlink(secs[0].body).trim().slice(0, introMax),
    formal: formal ? `${formal.heading}\n${unlink(formal.body).trim()}`.slice(0, formalMax) : '',
    history: hist ? unlink(hist.body).trim().slice(0, historyMax) : '',
    redirect: /^#redirect/i.test(page.wikitext.trim()), // Wikidata points at a title that only forwards to another article
    text: unlink(text), // the whole article, for checking quotes
    mentions,
  };
}

module.exports = { pieces, clean, unlink, dir };

if (require.main === module) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, 'candidates.json'), 'utf8')).find((x) => x.title === process.argv[2] || x.qid === process.argv[2]);
  const { text, ...rest } = pieces(c.qid);
  console.log(JSON.stringify(rest, null, 1), `\n(${text.length} characters in the whole article)`);
}
