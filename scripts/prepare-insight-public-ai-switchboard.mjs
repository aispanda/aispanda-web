import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(
  'docs/research/compute-sovereignty/DRAFT-INSIGHT-public-ai-switchboard.md',
  'utf8',
);

let body = src.replace(/^# Draft Insight:[^\n]*\n+/, '');
body = body.replace(/^\| Field[\s\S]*?^---\n+/m, '');
body = body.replace(/\n## Labels and honesty box[\s\S]*$/, '\n');
body = body.replace(/\nLocal extracts:[^\n]+\n/, '\n');
body = body.replace('| How to use it here |', '| Role in this design |');
body = body.replace(
  'Center of the essay. A strong first example is universities; agencies are another; consulting pays.',
  'The main move. Strong examples: universities, agencies; consulting pays.',
);
body = body.replace('Default substrate under umbrellas.', 'Underpins the umbrellas.');
body = body.replace('What it bundles (old labels)', 'What it bundles');
body = body.replace(
  'Do not translate this as “learned numbers.” That is technocrat talk and does not help most readers.',
  'Everyday meaning: open weights means you can take the skill home; closed means you only rent answers.',
);

const author = `## Author note

Personal analysis and judgment; AI assisted the research and drafting. Linked Sources support named programs. Scenario designs are proposals, not as claims that any country already runs this system. Verify primary sources before you act.
`;

const fm = `---
title: "The Public AI Switchboard"
eyebrow: "Incentive design"
summary: "Open models promise independence. Unoptimized compute burns money. A competitive public AI switchboard (a router plus pooled buyers on rented capacity you can leave) is a capitalist-friendly path to thicker markets and real exits."
readTime: "18 min read"
---

`;

const parts = body.split(/\n---\n/);
// Drop workshop "Standfirst" heading; page hero already carries title/summary.
parts[0] = parts[0].replace(/^## Standfirst\n+/m, '');
const out =
  fm +
  parts[0].trim() +
  '\n\n' +
  author +
  '\n---\n\n' +
  parts.slice(1).join('\n---\n').trim() +
  '\n';

writeFileSync('src/content/insights/public-ai-switchboard.md', out);
console.log(`Wrote src/content/insights/public-ai-switchboard.md (${out.length} chars)`);
