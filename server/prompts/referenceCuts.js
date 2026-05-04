'use strict';

/**
 * referenceCuts.js — curated worked examples surfaced in the system prompt.
 *
 * Each entry is a real hand-cut LD card. The model sees these as concrete
 * style references (tag voice, highlight phrasing, bold density) rather
 * than relying on prose instructions alone.
 *
 * To add a reference:
 *   1. Pick a representative warrant-rich paragraph (200–500 chars).
 *   2. Strip markdown markup from `source` (verbatim source text).
 *   3. Fill `h` with each highlight phrase, in document order.
 *   4. Fill `b` with each bold phrase, in document order. Bolds typically
 *      overlap highlights — list both arrays independently.
 *   5. Set `type` to one of "policy" | "k" | "hybrid".
 *
 * Keep the set small and high-quality — the prompt is cached after the
 * first call so adding examples is mostly free at runtime, but each one
 * inflates the cold-start payload. 5–8 references is a good cap.
 *
 * These are SHARED across all users — they encode the canonical cutting
 * style for the platform, not any individual debater's preferences.
 */

const REFERENCE_CUTS = [
  // ── Policy: news article, North Korea threat ────────────────────────
  {
    type: 'policy',
    tag: 'Diplomacy fails to stabilize Northeast Asia, ignoring North Korean threats backfires.',
    source:
      "There's no evidence that threats from North Korea have abated. Pyongyang " +
      "rolled out a hypersonic missile system in August and Defense Minister NO " +
      "KWANG-CHOL vowed \"more offensive action\" targeting the U.S. and Seoul " +
      "after a North Korean ballistic missile test last month.",
    h: ['no evidence', 'threats', 'from North Korea', 'have abated',
        'Pyongyang rolled out', 'hypersonic', 'missile system',
        'vowed', 'more offensive action'],
    b: ['no evidence', 'threats', 'abated', 'hypersonic', 'missile system',
        'more offensive action'],
  },

  // ── Policy: academic, nuclear strategy ──────────────────────────────
  {
    type: 'policy',
    tag: 'US nuclear primacy is a dangerous illusion that escalates limited war into extinction.',
    source:
      "Five elements of Blackett's critique stand out: First, a counterforce " +
      "first-strike against other major nuclear nations is strategically, " +
      "operationally, and mathematically impossible to accomplish without " +
      "megadeaths on both sides. Hence, all dreams of nuclear primacy are " +
      "dangerous illusions. Second, limited nuclear war using tactical or " +
      "nonstrategic nuclear weapons would soon escalate out of control.",
    h: ['counterforce', 'first-strike', 'mathematically impossible',
        'without megadeaths', 'on both sides', 'dangerous illusions',
        'limited nuclear war', 'tactical', 'would', 'escalate out of control'],
    b: ['counterforce', 'first-strike', 'mathematically impossible',
        'without megadeaths', 'dangerous illusions', 'tactical',
        'escalate out of control'],
  },

  // ── Policy: forward deployment, regional security ───────────────────
  {
    type: 'policy',
    tag: 'Forward deployment destabilizes the region---goes nuclear and draws in Russia and China.',
    source:
      "Moreover, deploying US nuclear weapons a couple hundred miles from one " +
      "of the most militarized and tense region of the world – closer to a " +
      "nuclear adversary than any other US nuclear weapons – would expose the " +
      "weapons to unique dangers. Kunsan Air Base is only 198 kilometers (123 " +
      "miles) from the North Korean border.",
    h: ['deploying US', 'nuclear weapons', 'most militarized', 'tense region',
        'nuclear adversary', 'unique dangers', '198 kilometers',
        'North Korean border'],
    b: ['most militarized', 'tense region', 'nuclear adversary',
        'unique dangers', '198 kilometers', 'North Korean border'],
  },

  // ── K: Wilderson, debate / preconscious ─────────────────────────────
  {
    type: 'k',
    tag: 'Debates must center the preconscious: grammar of abstraction represses pain.',
    source:
      "In semiotics, what you have is processes of signification. There is the " +
      "preconscious interest, and then unconscious identification, then the " +
      "structural position of the subject. Preconscious interest is a mode of " +
      "signification called secondary processes of signification and that is " +
      "99 percent of the way you all win or lose debates. The structure of " +
      "grammar represses the nonsensical utterances. It's the part of the mind " +
      "that is least alive to laughter, sorrow, tears, heartbreak, joy.",
    h: ['preconscious', 'secondary processes of signification', '99 percent',
        'win or lose debates', 'structure of grammar', 'represses',
        'least alive', 'sorrow', 'heartbreak'],
    b: ['preconscious', '99 percent', 'represses', 'sorrow', 'heartbreak'],
  },

  // ── K: Meiches, racialized nuclear violence ─────────────────────────
  {
    type: 'k',
    tag: 'Nuclear policy is constituted by racialized violence and white fantasy.',
    source:
      "Existing nuclear policy, posture, and use is deeply connected to " +
      "racialized violence and hierarchy. Nuclear testing and use occurred " +
      "within the context of racialized warfare in the United States' conflict " +
      "with Japan and spawned an intersectional protest to nuclear dominance. " +
      "It is also at this level that nuclear weapons change the politics of " +
      "white supremacy, since they spawn new fantasies of atomic genocide.",
    h: ['nuclear policy', 'is deeply connected', 'to racialized violence',
        'and hierarchy', 'racialized warfare', 'nuclear dominance',
        'change the politics', 'of white supremacy', 'spawn',
        'fantasies of atomic genocide'],
    b: ['nuclear policy', 'racialized violence', 'racialized warfare',
        'nuclear dominance', 'white supremacy', 'fantasies of atomic genocide'],
  },

  // ── Policy: constitutional / unitary executive ──────────────────────
  {
    type: 'policy',
    tag: 'A unitary executive prevents solutions to existential threats.',
    source:
      "Effective governance requires systems that can respond to complex " +
      "challenges with appropriate speed, expertise, and democratic input. " +
      "The unitary executive theory, while appealing in its theoretical " +
      "clarity, may actually impede these goals in practice. Concentrating " +
      "decision-making power in a single executive has not demonstrably " +
      "improved government performance on basic aspects of governance.",
    h: ['Effective governance', 'speed', 'expertise', 'democratic input',
        'unitary executive', 'impede these goals', 'concentrating',
        'decision-making power', 'not demonstrably improved', 'performance'],
    b: ['speed', 'expertise', 'democratic input', 'unitary executive',
        'impede', 'not demonstrably improved'],
  },

  // ── K: state-engagement / coopted micropolitics ─────────────────────
  {
    type: 'k',
    tag: 'Absent state engagement, the alt is coopted---micropolitics fails to match state power.',
    source:
      "The notion of resistance came to stress that power and counterpower " +
      "were not in binary opposition, but in a decoupled, complex, ambivalent, " +
      "and perpetual dance of control. It based itself on the Foucauldian idea " +
      "that wherever there is power there is resistance, although the latter " +
      "consisted largely of small-scale, everyday, tiny activities that the " +
      "agents could afford to articulate given their political constraints. " +
      "Yet a number of conceptual and political problems also emerge from this paradigm.",
    h: ['resistance', 'power and counterpower', 'decoupled', 'dance of control',
        'wherever there is power', 'small-scale', 'tiny activities',
        'political constraints', 'conceptual', 'political problems',
        'emerge from this paradigm'],
    b: ['resistance', 'dance of control', 'small-scale', 'tiny activities',
        'conceptual', 'political problems'],
  },

  // ── Framework: Kant / UN alignment ──────────────────────────────────
  {
    type: 'policy',
    tag: 'Kant affirms---aff aligns with the U.N., founded on Kantian ideals.',
    source:
      "Historically, evaluating the UN in light of Kantian standards bears " +
      "considerable plausibility. Although the UN has been founded not less " +
      "than 150 years after Kantian thoughts on perpetual peace have been " +
      "published, they have left visible traces in every stage of the " +
      "historical development from the merely philosophical conception to the " +
      "present stage of political realisation. The League of Nations constitutes " +
      "the first attempt to put philosophical peace projects into practice.",
    h: ['evaluating the UN', 'Kantian standards', 'considerable plausibility',
        'founded', '150 years after Kantian thoughts', 'perpetual peace',
        'visible traces in every stage', 'philosophical conception',
        'political realisation', 'first attempt'],
    b: ['Kantian standards', 'considerable plausibility',
        'visible traces in every stage', 'political realisation'],
  },

  // ── STEM: thermodynamics / entropy / creationism ────────────────────
  {
    type: 'policy',
    tag: 'Thermodynamics doesn\'t support creationism---entropy makes evolution probabilistically likely.',
    source:
      "Creationists are not showing that evolution contradicts the second law " +
      "of thermodynamics; instead, they are saying that the second law, as " +
      "accepted by conventional science, is incorrect and insufficient to " +
      "explain natural phenomena. They insist that something else of their own " +
      "making must be added---namely, a divinely created directing program or " +
      "a distinction between different kinds of entropy. Their notions are " +
      "wrong and unnecessary.",
    h: ['Creationists are not showing', 'evolution contradicts',
        'the second law', 'they are saying', 'is incorrect',
        'divinely created directing program',
        'distinction between different kinds of entropy',
        'are wrong and unnecessary'],
    b: ['the second law', 'is incorrect', 'divinely created directing program',
        'are wrong and unnecessary'],
  },

  // ── Formal logic: paraconsistent / philosophy ───────────────────────
  {
    type: 'k',
    tag: 'Paraconsistent logic is self-evident, necessary, and outweighs on proximity.',
    source:
      "If the world were a perfect place, we would not need logic. Logic " +
      "tells us what follows from things we already believe, things we are " +
      "already committed to. Logic helps us work around our fallible and " +
      "finite limitations. We need logic because we can go wrong, because " +
      "things do go wrong, and we need guidance. Logic is most important for " +
      "navigating inconsistency---paraconsistent logic refuses to let " +
      "contradiction explode into total triviality.",
    h: ['Logic', 'what follows from things we already believe',
        'fallible and finite limitations', 'we need logic',
        'we can go wrong', 'we need guidance', 'most important',
        'navigating inconsistency', 'paraconsistent logic',
        'contradiction explode', 'total triviality'],
    b: ['Logic', 'fallible and finite', 'we need logic',
        'most important', 'paraconsistent logic',
        'contradiction explode'],
  },
];

// Render the references into a prompt section. Stable formatting so the
// model can pattern-match consistently across runs.
function formatReferenceCuts(examples = REFERENCE_CUTS) {
  return examples.map((ex, i) => {
    const num = i + 1;
    return `EXAMPLE ${num} (${ex.type}):
  Tag: "${ex.tag}"
  Source: "${ex.source}"
  h: ${JSON.stringify(ex.h)}
  b: ${JSON.stringify(ex.b)}`;
  }).join('\n\n');
}

module.exports = { REFERENCE_CUTS, formatReferenceCuts };
