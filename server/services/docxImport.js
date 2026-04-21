'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');

const { previewZipImport, resolveProjectPath, listZipEntries } = require('./zipImporter');
const { loadCards, saveCards, loadMeta, saveMeta } = require('./libraryStore');
const db = require('./db');

let ENGLISH_WORDS = null;
try { ENGLISH_WORDS = new Set(require('an-array-of-english-words')); } catch (_) { ENGLISH_WORDS = new Set(); }

function xmlDecode(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripXml(text) {
  return xmlDecode(String(text || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizeShortCite(text) {
  const value = normalizeWhitespace(text).replace(/[’]/g, "'");
  const match = value.match(/^([A-Z][A-Za-z.\-]+)\s*'(\d{2})\b/);
  return match ? `${match[1]} '${match[2]}` : '';
}

function inferTopicBucket(cardText) {
  const text = String(cardText || '').toLowerCase();

  if (text.includes('plea bargaining')) return 'Plea Bargaining';
  if (text.includes('artificial intelligence') && text.includes('criminal justice')) return 'AI in Criminal Justice';
  if (text.includes('rewild')) return 'Rewilding';
  if (text.includes('green growth') || text.includes('degrowth')) return 'Green Growth vs Degrowth';
  if (text.includes('nuclear weapon')) return 'Nuclear Weapons';
  if (text.includes('geoengineering')) return 'Geoengineering';
  if (text.includes('economic sanctions')) return 'Economic Sanctions';
  if (text.includes('non-intervention')) return 'Non-Intervention';
  if (text.includes('civil liberties') && text.includes('national security')) return 'Civil Liberties vs National Security';
  if (text.includes('development assistance')) return 'Development Assistance';
  return 'General LD';
}

function inferArgumentTypes(cardText) {
  const text = String(cardText || '').toLowerCase();
  const types = [];

  if (/ontology|capitalism|settler colonialism|psychoanalysis|heidegger|nietzsche|lacan|biopower|foucault|critique|\bcap k\b/.test(text))
    types.push('kritik');
  if (/disadvantage|\bbrink\b|uniqueness|link turn|impact turn|politics da/.test(text))
    types.push('da');
  if (/\bcp\b|counterplan|net benefit|\bcompetition\b|perm bad/.test(text))
    types.push('counterplan');
  if (/topicality|\bshells?\b|\bviolation\b|\binterpretation\b|\bstandards\b|\bvoters\b|\bfairness\b|\beducation\b|\bcondo\b|\bpics\b|\bdispo\b/.test(text))
    types.push('theory');
  if (/\bskep\b|skepticism|a priori|\bpermissibility\b|\bpresumption\b|\bburden\b|\bspikes\b|framing trick/.test(text))
    types.push('tricks');
  if (/\bframework\b|\bvalue\b|\bcriterion\b|utilitarianism|deontology|\bkant\b|\bmill\b|\brawls\b|contractualism|consequentialism/.test(text))
    types.push('phil');
  if (/\bplan\b|\binherency\b|\bharms\b|\badvantage\b|\bsolvency\b/.test(text))
    types.push('policy');

  return types.length ? types : ['none'];
}

function inferArgumentTags(tagText, bodyText) {
  // Classify primarily from tag (debater-written label), body as secondary signal
  const tag  = String(tagText  || '').toLowerCase();
  const body = String(bodyText || '').toLowerCase();
  const full = `${tag} ${body}`;
  const tags = [];

  // ── DAs ──────────────────────────────────────────────────────────────────
  if (/\becon(omy)?\b|gdp|recession|growth|trade war|inflation|unemploy|fiscal|monetary|market crash|financial crisis/.test(tag) ||
      (/\becon(omy)?\b|gdp|recession/.test(body) && /\b(da|disad|disadvantage)\b/.test(tag)))
    tags.push('econ da');

  if (/\bpolitics\b|\bptx\b|political capital|congressional|partisan|senate|filibuster|electoral|midterm|bipartisan/.test(tag))
    tags.push('politics da');

  if (/\bheg\b|hegemony|unipolarity|power projection|primacy|military dominance|leadership/.test(tag))
    tags.push('heg da');

  if (/\bnfu\b|no.first.use|first.use policy|launch.on.warning|nuclear use|nuclear employment/.test(full))
    tags.push('nfu cp');

  if (/nuclear war|nuclear conflict|prolifer|deterrence|arms race|warhead|nuke|escalat|nuclear exchange/.test(tag))
    tags.push('nuclear war');

  if (/\bhedg(e|ing)\b|hedge strategy|nuclear hedge|extended deterrence|assured destruction|second strike/.test(full))
    tags.push('hedge');

  if (/\bcil\b|customary international law|international custom|international norm|jus cogens|opinio juris/.test(full))
    tags.push('cil cp');

  if (/\bclimate\b|warming|emissions|carbon|greenhouse|sea level|temperature rise|decarboniz/.test(tag))
    tags.push('climate da');

  if (/\bspending\b|deficit|federal budget|debt ceiling|national debt|austerity/.test(tag))
    tags.push('spending da');

  if (/\bfederalism\b|states rights?|preemption|devolution|state sovereignty/.test(tag))
    tags.push('federalism da');

  if (/\belections?\b|electoral|swing state|polling|campaign|voter/.test(tag))
    tags.push('elections da');

  if (/\btrade\b|tariff|import|export|wto|trade deficit|protectionism/.test(tag))
    tags.push('trade da');

  if (/relations|alliance|diplomatic|bilateral|multilateral|foreign policy|soft power/.test(tag))
    tags.push('relations da');

  if (/\bbiow(eapon)?|bioterror|pandemic|pathogen|infectious disease/.test(tag))
    tags.push('bioweapons da');

  if (/\bcyber\b|hack|ransomware|critical infrastructure|cyberattack/.test(tag))
    tags.push('cyber da');

  if (/democracy|democratic backslid|authoritarianism|autocratic|free press/.test(tag))
    tags.push('democracy da');

  if (/\benergy\b|grid|electricity|power sector|renewable|fossil fuel/.test(tag))
    tags.push('energy da');

  if (/human rights|humanitarian|atrocity|genocide|r2p/.test(tag))
    tags.push('human rights da');

  if (/immigra|border|asylum|refugee|undocumented|migrant/.test(tag))
    tags.push('immigration da');

  // ── Counterplans ─────────────────────────────────────────────────────────
  if (/\bnfu\b|no.first.use/.test(full) && /\bcp\b|counterplan|advocate|solv/.test(full))
    { if (!tags.includes('nfu cp')) tags.push('nfu cp'); }

  if (/\bcil\b|customary international law/.test(full) && /\bcp\b|counterplan|advocate|solv/.test(full))
    { if (!tags.includes('cil cp')) tags.push('cil cp'); }

  if (/\bstates\b.*\bcp\b|\bcp\b.*\bstate(s)?\b|fifty.state/.test(tag))
    tags.push('states cp');

  if (/\binternational\b.*\bcp\b|\bcp\b.*international|multilateral cp/.test(tag))
    tags.push('international cp');

  if (/process cp|procedural cp|study cp|commission|pilot program/.test(tag))
    tags.push('process cp');

  if (/consult(ation)? cp|consult (allies|nato|congress)/.test(tag))
    tags.push('consult cp');

  if (/conditions? cp|conditioned on/.test(tag))
    tags.push('conditions cp');

  if (/delay cp|sun.?set|revisit|phase.in/.test(tag))
    tags.push('delay cp');

  // ── Kritiks ──────────────────────────────────────────────────────────────
  if (/capitalism|neoliberal|commodity form|surplus value|profit motive|\bcap k\b|capital accumulation|class struggle|bourgeois|wage labor|commodif/.test(full))
    tags.push('cap k');

  if (/settler colonialism|indigenous|decoloniz|land back|native (people|nation|sovere)|colonizer|first nation|tribal/.test(full))
    tags.push('set col k');

  if (/afropessimism|anti.?blackness|social death|fungibility|slaveholder|middle passage|afro.pessimism/.test(full))
    tags.push('afropess k');

  if (/anthropocentr|human exceptionalism|speciesism|nonhuman|more.than.human|posthuman|animal rights|multispecies/.test(full))
    tags.push('anthro k');

  if (/\bbiopower\b|biopoliti|governmentality|\bfoucault\b|discipline and punish|subject formation/.test(full))
    tags.push('biopower k');

  if (/psychoanaly|lacan|\bzizek\b|\bdrive\b|jouissance|the real|objet a|lack|symbolic order/.test(full))
    tags.push('psychoanalysis k');

  if (/queer theory|heteronormativity|homonationalism|\blgbt|\bgender binary|cis.?norm|queerness/.test(full))
    tags.push('queer theory k');

  if (/\bfeminis[mt]\b|patriarchy|misogyny|gender.based violence|rape culture|reproductive justice/.test(full))
    tags.push('feminist k');

  if (/\bheidegger\b|\bdasein\b|\benframing\b|being and time|ontological difference|thrownness/.test(full))
    tags.push('heidegger k');

  if (/\bnietzsche\b|will to power|ressentiment|eternal recurrence|overman|\bubermensch\b/.test(full))
    tags.push('nietzsche k');

  if (/\bableism\b|disability studies|crip theory|normative body|mad studies/.test(full))
    tags.push('disability k');

  if (/\bneoliberal(ism)?\b|market fundamentalism|washington consensus|structural adjustment/.test(full) && !tags.includes('cap k'))
    tags.push('neolib k');

  if (/\btechnology\b.*\bk\b|\btechno.?log(y|ical)\b.*critique|instrumental reason|tech k|technoscience/.test(tag))
    tags.push('tech k');

  if (/\bsecurit(y|ization)\b.*\bk\b|\bsecuritiz|existential threat framing|securitization theory/.test(tag))
    tags.push('security k');

  if (/orientalism|\bsaid\b|colonial gaze|othering|third world/.test(full))
    tags.push('orientalism k');

  if (/militarism|war machine|military.industrial|martial|warrior culture/.test(full))
    tags.push('militarism k');

  // ── Theory ───────────────────────────────────────────────────────────────
  if (/\bfairness\b|\bfair\b|adequate prep|pre.?round prep|limits|ground/.test(tag))
    tags.push('fairness');

  if (/\beducation\b|educational value|topic education|research burden/.test(tag))
    tags.push('education');

  if (/conditionality|conditional advocacy|\bcondo\b/.test(full))
    tags.push('condo');

  if (/\btopicality\b|\bt-\b|extra.topical|resolutional|definitions?|limits/.test(tag))
    tags.push('topicality');

  if (/\bpics?\b|plan.inclusive counterplan/.test(full))
    tags.push('PICs');

  if (/\bdispo\b|dispositional/.test(full))
    tags.push('dispo');

  if (/\brvi\b|reverse (voting|voter)/.test(full))
    tags.push('RVI');

  if (/disclosure|open.?source|posted|wiki|backfile/.test(tag))
    tags.push('disclosure theory');

  if (/\bspec\b|specification|actor spec|mechanism spec/.test(tag))
    tags.push('spec');

  if (/\bseverance\b|intrinsicness|spike/.test(tag))
    tags.push('severance');

  // ── Philosophy ───────────────────────────────────────────────────────────
  if (/utilitarianism|utilitarian|maximize (welfare|utility|well.?being|happiness)|greatest (good|number)|aggregate welfare/.test(full))
    tags.push('util');

  if (/\bkant\b|deontolog|categorical imperative|humanity as an end|kingdom of ends|korsgaard|formula of humanity/.test(full))
    tags.push('kant');

  if (/\brawls\b|veil of ignorance|difference principle|justice as fairness|original position/.test(full))
    tags.push('rawls');

  if (/virtue ethics|aristotle|\beudaimonia\b|character.based|phronesis|flourishing/.test(full))
    tags.push('virtue ethics');

  if (/care ethics|relational ethics|carol gilligan|ethics of care|nell noddings/.test(full))
    tags.push('care ethics');

  if (/contractualism|\bscanlon\b|reasonable rejection|what we owe to each other/.test(full))
    tags.push('contractualism');

  if (/contractarianism|social contract|\bhobbes\b|\blocke\b|\brousseau\b/.test(full))
    tags.push('contractarianism');

  if (/moral skeptic|nihilism|error theory|non.?cognitivism|moral realism|amoralism/.test(full))
    tags.push('moral skepticism');

  if (/\bross\b|prima facie duties|pro tanto|moral pluralism|w\.d\. ross/.test(full))
    tags.push('ross');

  if (/\blevinas\b|face of the other|alterity|infinite responsibility/.test(full))
    tags.push('levinas');

  if (/\bparfit\b|personal identity|reasons and persons|reductionism about persons/.test(full))
    tags.push('parfit');

  if (/\bpogge\b|global justice|world poverty|negative duty/.test(full))
    tags.push('pogge');

  // ── Tricks ───────────────────────────────────────────────────────────────
  if (/skep(ticism)? trigger|\bskep\b|default to skep|moral skept/.test(tag))
    tags.push('skep trigger');

  if (/\ba priori\b/.test(full))
    tags.push('a priori');

  if (/\bpresumption\b|presumptively|tie.?goes/.test(full))
    tags.push('presumption');

  if (/framing (argument|trick|issue)|meta.?level|prior question/.test(tag))
    tags.push('framing');

  if (/permissibility|permissive|permissibilism/.test(full))
    tags.push('permissibility');

  // ── General evidence categories ──────────────────────────────────────────
  if (/\bnonprolifer|nonprolifer|arms control|disarmament|npt\b|start treaty/.test(full))
    tags.push('nonproliferation');

  if (/\barms control\b|disarmament|new start|salt\b|inf treaty/.test(full))
    tags.push('arms control');

  if (/\bsurveillance\b|nsa|mass surveillance|data collection|privacy/.test(full))
    tags.push('surveillance');

  if (/\bai\b|artificial intelligence|machine learning|autonomous weapon|lethal autonomous/.test(full))
    tags.push('AI');

  return tags;
}

// Patterns that indicate opponent-directed meta-commentary in a tag line.
// These are coach/debater annotations that don't belong in a clean card tag.
const META_COMMENTARY_PATTERNS = [
  /\btheir\s+\w[\w\s]*?\s+is\s+(wrong|bad|false|incorrect|flawed|misleading|outdated)\b/gi,
  /\bthey\s+(misunderstood|misread|miscut|misuse|misconstrue|misrepresent|mis\w+)\b/gi,
  /\btheir\s+(author|ev(idence)?|card|cite|source|tag)\s+(says|is|doesn'?t|cuts?)\b/gi,
  /\bopponent'?s?\s+\w[\w\s]*?\s+(fails?|is wrong|misses?)\b/gi,
  /\b(no|non-?)\s*unique(ness)?\b/gi,
];

function normalizeTag(tag) {
  if (!tag) return tag;
  let result = String(tag);

  // Strip opponent meta-commentary
  for (const pattern of META_COMMENTARY_PATTERNS) {
    result = result.replace(pattern, '');
  }

  // Fix whitespace: collapse runs of spaces/tabs, trim ends
  result = result.replace(/[ \t]{2,}/g, ' ').trim();

  // Fix space before punctuation: "word ." → "word."
  result = result.replace(/\s+([.,;:!?])/g, '$1');

  // Fix double dashes/slashes with surrounding spaces: " -- " → " — "
  result = result.replace(/\s+--\s+/g, ' — ');

  // Remove leading/trailing punctuation artifacts left after stripping
  result = result.replace(/^[\s\-—,;:]+|[\s\-—,;:]+$/g, '').trim();

  // Strip leading numbering: "1.", "2]", "3)", "4---", "5:" etc.
  result = result.replace(/^\s*\d+\s*[.\])\-—:]+\s*/g, '');

  // Strip leading "T:" or "T---" (type-prefix annotation)
  result = result.replace(/^\s*T\s*[:\-—]+\s*/i, '');

  // Strip leading single-letter marker followed by separator + space: "A] foo", "B. foo", "b) foo"
  // Requires the trailing space so "Apple" and "d omain" survive this step.
  result = result.replace(/^\s*[A-Za-z]\s*[.\])\-—:]\s+/, '');

  // Strip leading "*" bullets and "+" signs
  result = result.replace(/^\s*[*+]+\s*/g, '');

  // Collapse spaces around triple-dash and em-dash: " --- " → "---", " —" → "—"
  result = result.replace(/\s+---\s*/g, '---');
  result = result.replace(/\s+—/g, '—');

  // Merge mis-split words like "d omain" → "domain" using local English dictionary.
  // Skip when the standalone letter is itself a real word ("a", "i") or when it follows
  // an apostrophe (contraction fragment like "It's an" → the "s" must not attach to "an").
  if (ENGLISH_WORDS && ENGLISH_WORDS.size) {
    // Leading stray letter: "d omain" → "domain", "l egal" → "legal"
    result = result.replace(/(^|[^A-Za-z\u2019'’])([a-zA-Z])\s+([a-zA-Z]{2,})\b/g, (m, pre, letter, rest) => {
      const merged = (letter + rest).toLowerCase();
      const letterLower = letter.toLowerCase();
      if (ENGLISH_WORDS.has(merged) && !['a', 'i'].includes(letterLower)) {
        return pre + letter + rest;
      }
      return m;
    });
    // Trailing stray letter: "realisti c" → "realistic"
    result = result.replace(/\b([a-zA-Z]{2,})\s+([a-zA-Z])(?=$|[^A-Za-z\u2019'’])/g, (m, body, letter) => {
      const merged = (body + letter).toLowerCase();
      const letterLower = letter.toLowerCase();
      if (ENGLISH_WORDS.has(merged) && !['a', 'i'].includes(letterLower)) {
        return body + letter;
      }
      return m;
    });
  }

  // Collapse double spaces introduced by prior passes
  result = result.replace(/[ \t]{2,}/g, ' ');

  // Remove any leading whitespace (tag must not start with space).
  result = result.replace(/^\s+/, '');

  // Capitalize first character.
  if (result.length) result = result[0].toUpperCase() + result.slice(1);

  return result || tag; // fall back to original if we wiped everything
}

function enrichCard(card) {
  const sourceText = `${card.tag || ''} ${card.cite || ''} ${card.body_plain || ''}`;
  return {
    ...card,
    tag: normalizeTag(card.tag),
    topicBucket: card.topicBucket || inferTopicBucket(sourceText),
    argumentTypes: (card.argumentTypes && card.argumentTypes.length) ? card.argumentTypes : inferArgumentTypes(sourceText),
    argumentTags: (card.argumentTags && card.argumentTags.length) ? card.argumentTags : inferArgumentTags(card.tag, card.body_plain),
    sourceKind: card.sourceKind || 'wiki',
  };
}

function computeWarrantDensity(bodyMarkdown) {
  const allWords = normalizeWhitespace(
    String(bodyMarkdown || '')
      .replace(/[*_=<>/]/g, ' ')
      .replace(/\u00B6/g, ' ')
  ).split(/\s+/).filter(Boolean);

  if (!allWords.length) return 0;

  const emphasizedWords = [];
  const regex = /(\*\*<u>[\s\S]*?<\/u>\*\*)|(<u>[\s\S]*?<\/u>)/g;
  let match;
  while ((match = regex.exec(String(bodyMarkdown || ''))) !== null) {
    const cleaned = stripXml(match[0].replace(/\*\*/g, ' '));
    emphasizedWords.push(...cleaned.split(/\s+/).filter(Boolean));
  }

  return Number((emphasizedWords.length / allWords.length).toFixed(4));
}

function fingerprintBody(text) {
  return crypto
    .createHash('sha1')
    .update(normalizeWhitespace(String(text || '').toLowerCase()))
    .digest('hex');
}

function parseRuns(paragraphXml) {
  const runs = [];
  const runRegex = /<w:r\b[\s\S]*?<\/w:r>/g;
  let match;

  while ((match = runRegex.exec(paragraphXml)) !== null) {
    const runXml = match[0];
    const texts = [...runXml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map(item => xmlDecode(item[1]));
    const text = texts.join('');
    if (!text) continue;

    const underline = /<w:u\b[^>]*w:val="(single|words|thick|dash|dotted|wave)?"/.test(runXml) || /<w:u\b/.test(runXml);
    const bold = /<w:b\b/.test(runXml);
    const highlight = /<w:highlight\b/.test(runXml);

    runs.push({ text, underline, bold, highlight });
  }

  return runs;
}

function runsToMarkdown(runs) {
  return runs.map(run => {
    const clean = run.text.replace(/\s+/g, ' ');
    if (!clean.trim()) return run.text;

    if (run.highlight && (run.underline || run.bold)) {
      const inner = run.bold ? `**<u>${clean}</u>**` : `<u>${clean}</u>`;
      return `==${inner}==`;
    }

    if (run.bold && run.underline) return `**<u>${clean}</u>**`;
    if (run.underline) return `<u>${clean}</u>`;
    return clean;
  }).join('').replace(/\s+/g, ' ').trim();
}

function extractParagraphs(documentXml) {
  const paragraphs = [];
  const paragraphRegex = /<w:p\b[\s\S]*?<\/w:p>/g;
  let match;

  while ((match = paragraphRegex.exec(documentXml)) !== null) {
    const paragraphXml = match[0];
    const style = (paragraphXml.match(/<w:pStyle[^>]*w:val="([^"]+)"/) || [])[1] || '';
    const runs = parseRuns(paragraphXml);
    const text = normalizeWhitespace(runs.map(run => run.text).join(' '));
    if (!text) continue;
    paragraphs.push({ style, text, runs, markdown: runsToMarkdown(runs) });
  }

  return paragraphs;
}

// Cache the unzipper directory per ZIP path (reads only central dir — cheap)
const _zipCache = new Map();

async function getOuterDirectory(zipPath) {
  if (_zipCache.has(zipPath)) return _zipCache.get(zipPath);
  const { directory } = await listZipEntries(zipPath);
  _zipCache.set(zipPath, directory);
  return directory;
}

function streamToBuffer(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

async function extractDocxXmlFromZip(zipPath, entryPath) {
  const directory = await getOuterDirectory(zipPath);
  const file = directory.files.find(f => f.path === entryPath);
  if (!file) throw new Error(`Entry not found in ZIP: ${entryPath}`);
  const docxBuffer = await streamToBuffer(file.stream());
  const docxZip = await JSZip.loadAsync(docxBuffer);
  const documentEntry = docxZip.file('word/document.xml');
  if (!documentEntry) throw new Error(`word/document.xml missing for ${entryPath}`);
  return documentEntry.async('string');
}

function parseCardsFromParagraphs(paragraphs, entryPath, zipPath) {
  const cards = [];
  let current = null;

  const flush = () => {
    if (!current || !current.cite || !current.body.length) {
      current = null;
      return;
    }

    const bodyMarkdown = current.body.join('\n\n').trim();
    const bodyPlain = normalizeWhitespace(current.bodyText.join(' '));
    const shortCite = normalizeShortCite(current.cite);
    const bodyFingerprint = fingerprintBody(bodyPlain);
    const cleanTag = normalizeTag(current.tag);
    const classifyText = `${cleanTag} ${bodyPlain}`;

    cards.push({
      id: crypto.createHash('sha1').update(`${entryPath}|${current.tag}|${current.cite}|${bodyFingerprint}`).digest('hex'),
      zipPath,
      sourceEntry: entryPath,
      sourceFileName: entryPath.split('/').pop() || entryPath,
      division: entryPath.split('/')[0] || '',
      school: entryPath.split('/')[1] || '',
      squad: entryPath.split('/')[2] || '',
      tag: cleanTag,
      cite: current.cite,
      shortCite,
      body_markdown: bodyMarkdown,
      body_plain: bodyPlain,
      warrantDensity: computeWarrantDensity(bodyMarkdown),
      contentFingerprint: bodyFingerprint,
      foundAt: entryPath,
      importedAt: new Date().toISOString(),
      topicBucket: inferTopicBucket(`${cleanTag} ${current.cite} ${bodyPlain}`),
      argumentTypes: inferArgumentTypes(classifyText),
      argumentTags: inferArgumentTags(cleanTag, bodyPlain),
      sourceKind: 'wiki',
      isCanonical: false,
      canonicalGroupKey: shortCite && bodyFingerprint ? `${shortCite}::${bodyFingerprint}` : '',
    });

    current = null;
  };

  paragraphs.forEach(paragraph => {
    if (paragraph.style === 'Heading4') {
      flush();
      current = {
        tag: paragraph.text,
        cite: '',
        body: [],
        bodyText: [],
      };
      return;
    }

    if (!current) return;

    if (!current.cite && normalizeShortCite(paragraph.text)) {
      current.cite = normalizeShortCite(paragraph.text);
      return;
    }

    if (current.cite) {
      current.body.push(paragraph.markdown || paragraph.text);
      current.bodyText.push(paragraph.text);
    }
  });

  flush();
  return cards;
}

function chooseCanonicals(cards) {
  const groups = new Map();

  cards.forEach(card => {
    const key = card.canonicalGroupKey || `${card.shortCite || 'unknown'}::${card.contentFingerprint}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(card);
  });

  groups.forEach(group => {
    group.sort((a, b) => {
      if (b.warrantDensity !== a.warrantDensity) return b.warrantDensity - a.warrantDensity;
      return a.sourceEntry.localeCompare(b.sourceEntry);
    });

    group.forEach((card, index) => {
      card.isCanonical = index === 0;
      card.variantCount = group.length;
    });
  });

  return cards;
}

function maybeStoreAnalytic(paragraphs, entryPath, zipPath, parsedCards) {
  // Collect text from paragraphs that are NOT part of a parsed card body.
  // Cards consume: Heading4 tag + one cite line + body paragraphs.
  // Anything else (tag-only blocks, analytical prose, overviews) is analytics.
  const citedBodies = new Set();
  for (const card of (parsedCards || [])) {
    if (card.body_plain) citedBodies.add(card.body_plain.slice(0, 80));
  }

  // Gather uncited content: paragraphs that are Heading4 (argument tags) or
  // plain prose not consumed as card body. We store the full file text so
  // full-text search works, but only commit if there's meaningful uncited content.
  const uncitedLines = [];
  let inUncitedBlock = false;

  for (const p of paragraphs) {
    if (p.style === 'Heading4') {
      inUncitedBlock = true;
      uncitedLines.push(p.text);
      continue;
    }
    // If this paragraph looks like a citation, it starts a card — not analytics
    if (inUncitedBlock && normalizeShortCite(p.text)) {
      inUncitedBlock = false;
      continue;
    }
    if (inUncitedBlock) {
      uncitedLines.push(p.text);
    } else {
      // Free-standing prose (no preceding Heading4) — likely overview/blocks
      uncitedLines.push(p.text);
    }
  }

  const uncitedText = uncitedLines.join('\n').trim();
  const wordCount = uncitedText.split(/\s+/).filter(Boolean).length;

  // Only store if there's meaningful analytical content (>30 words uncited)
  if (wordCount < 30) return false;

  const title = paragraphs.find(p => p.style === 'Heading4')?.text
    || paragraphs[0]?.text
    || entryPath.split('/').pop();

  db.upsertAnalytic({
    id: crypto.createHash('sha1').update(`analytic|${entryPath}|${zipPath}`).digest('hex'),
    zipPath,
    sourceEntry: entryPath,
    title,
    content_plain: uncitedText,
    wordCount,
    importedAt: new Date().toISOString(),
  });

  return true;
}

async function listDocxEntries(zipPath) {
  const directory = await getOuterDirectory(zipPath);
  return directory.files
    .filter(f => (!f.type || f.type === 'File') && f.path.toLowerCase().endsWith('.docx'))
    .map(f => f.path);
}

async function importDocxEntry(zipPath, entryPath) {
  const documentXml = await extractDocxXmlFromZip(zipPath, entryPath);
  const paragraphs = extractParagraphs(documentXml);
  return parseCardsFromParagraphs(paragraphs, entryPath, zipPath);
}

async function importZipToLibrary(zipPath, options = {}) {
  const { maxDocs = Infinity, logEvery = 250 } = options;
  await previewZipImport(zipPath, 5);
  const allEntries = await listDocxEntries(zipPath);

  const selectedEntries = Number.isFinite(maxDocs) ? allEntries.slice(0, maxDocs) : allEntries;
  const rawNewCards = [];
  let processedDocs = 0;
  let analyticsCount = 0;

  for (const entryPath of selectedEntries) {
    try {
      const documentXml = await extractDocxXmlFromZip(zipPath, entryPath);
      const paragraphs = extractParagraphs(documentXml);
      const cards = parseCardsFromParagraphs(paragraphs, entryPath, zipPath);

      if (maybeStoreAnalytic(paragraphs, entryPath, zipPath, cards)) analyticsCount++;
      if (cards.length > 0) rawNewCards.push(...cards);

      processedDocs += 1;
    } catch (error) {
      processedDocs += 1;
    }

    if (logEvery && processedDocs % logEvery === 0) {
      console.log(`[import] ${processedDocs}/${selectedEntries.length} docs, ${rawNewCards.length} cards, ${analyticsCount} analytics`);
    }
  }

  // Dedup: only insert cards with fingerprints not already in DB
  const existingFingerprints = db.getExistingFingerprints();
  const deduped = rawNewCards.filter(c => !existingFingerprints.has(c.contentFingerprint));

  // Insert new cards with isCanonical=false initially
  deduped.forEach(c => { c.isCanonical = false; c.variantCount = 1; });
  db.upsertCards(deduped);

  // Re-elect canonicals for only the affected groups — pure SQL, no JS memory load
  const affectedGroups = [...new Set(deduped.map(c => c.canonicalGroupKey).filter(Boolean))];
  db.recanonicalizeGroups(affectedGroups);

  db.logIngestion(zipPath, deduped.length, analyticsCount, processedDocs);
  _zipCache.delete(zipPath); // free memory

  // Query stats directly from DB — no in-memory load
  const dbInst = db.getDb();
  const totalCards = dbInst.prepare('SELECT COUNT(*) AS n FROM cards').get().n;
  const canonicalGroups = dbInst.prepare('SELECT COUNT(*) AS n FROM cards WHERE isCanonical = 1').get().n;
  const citationGroups = dbInst.prepare("SELECT COUNT(DISTINCT shortCite) AS n FROM cards WHERE shortCite IS NOT NULL AND shortCite != ''").get().n;

  const meta = loadMeta();
  saveMeta({
    ...meta,
    lastImport: new Date().toISOString(),
    importedZip: zipPath,
    totalCards,
    totalDocs: (meta.totalDocs || 0) + processedDocs,
    citationGroups,
    canonicalGroups,
  });

  return {
    zipPath,
    processedDocs,
    newCards: deduped.length,
    totalCards,
    analyticsCount,
    citationGroups,
    canonicalGroups,
  };
}

function getLibraryDashboard(limit = 12) {
  const cards = loadCards().map(enrichCard);
  const meta = loadMeta();

  const recent = [...cards]
    .sort((a, b) => new Date(b.importedAt) - new Date(a.importedAt))
    .slice(0, limit);

  const canonicals = cards.filter(card => card.isCanonical);
  const topicBreakdown = countBreakdown(cards, 'topicBucket', 8);
  const argumentBreakdown = countArgumentBreakdown(cards, 8);

  return {
    meta,
    stats: {
      totalCards: cards.length,
      canonicalCards: canonicals.length,
      totalSchools: new Set(cards.map(card => card.school).filter(Boolean)).size,
      totalTeams: new Set(cards.map(card => `${card.school}/${card.squad}`).filter(Boolean)).size,
    },
    topicBreakdown,
    argumentBreakdown,
    communityRecent: canonicals.slice(0, limit),
    wikiRecent: recent,
    recent,
  };
}

function countArgumentBreakdown(cards, limit) {
  const counts = new Map();
  cards.forEach(card => {
    (card.argumentTypes || ['none']).forEach(t => counts.set(t, (counts.get(t) || 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function countBreakdown(cards, field, limit) {
  const counts = new Map();
  cards.forEach(card => {
    const key = card[field] || 'Uncategorized';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function searchLibrary(query = '', limit = 50) {
  // Delegate to FTS-backed getLibraryCards to avoid loading + enriching
  // all 150k+ cards in memory (caused heap OOM on /api/library/search).
  const { getLibraryCards } = require('./libraryQuery');
  const cap = Math.max(1, Math.min(200, Number(limit) || 50));
  try {
    // getLibraryCards is async; searchLibrary callers use it synchronously
    // only in legacy paths. For the HTTP endpoint we return a promise-safe
    // fallback: if caller awaits, they get the FTS page; otherwise we fall
    // back to an empty array rather than scanning the whole DB.
    return getLibraryCards({ q: String(query || ''), limit: cap, sort: 'relevance' });
  } catch {
    return { items: [], total: 0 };
  }
}

async function importDocxBuffer(buffer, sourceLabel = 'manual-upload') {
  const docxZip = await JSZip.loadAsync(buffer);
  const documentEntry = docxZip.file('word/document.xml');
  if (!documentEntry) throw new Error('word/document.xml not found in uploaded DOCX');

  const documentXml = await documentEntry.async('string');
  const paragraphs = extractParagraphs(documentXml);
  const cards = parseCardsFromParagraphs(paragraphs, sourceLabel, sourceLabel);

  maybeStoreAnalytic(paragraphs, sourceLabel, sourceLabel, cards);

  const existingFingerprints = db.getExistingFingerprints();
  const deduped = cards.filter(c => !existingFingerprints.has(c.contentFingerprint));
  deduped.forEach(c => { c.isCanonical = false; c.variantCount = 1; c.sourceKind = 'personal'; });
  db.upsertCards(deduped);

  const affectedGroups = [...new Set(deduped.map(c => c.canonicalGroupKey).filter(Boolean))];
  db.recanonicalizeGroups(affectedGroups);

  return { sourceLabel, cardsImported: deduped.length, totalParsed: cards.length };
}

module.exports = {
  importZipToLibrary,
  importDocxBuffer,
  getLibraryDashboard,
  searchLibrary,
  listDocxEntries,
  importDocxEntry,
  chooseCanonicals,
  enrichCard,
  inferArgumentTags,
  normalizeTag,
};
