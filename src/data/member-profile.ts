import { countryCodes } from './countries';

export const professionalRoleOptions = [
  ['prefer-not-to-say', 'Prefer not to say'],
  ['student', 'Student'],
  ['educator-researcher', 'Educator or researcher'],
  ['technology-ai-practitioner', 'Technology or AI practitioner'],
  ['business-operations-leader', 'Business or operations leader'],
  ['public-sector-policy', 'Public sector or policy'],
  ['writer-creator', 'Writer or creator'],
  ['independent-learner', 'Independent learner'],
  ['other', 'Other'],
] as const;

export const primaryInterestOptions = [
  ['prefer-not-to-say', 'Prefer not to say'],
  ['practical-ai', 'Practical AI use'],
  ['ai-strategy', 'AI strategy and leadership'],
  ['open-reusable-ai', 'Open and reusable AI'],
  ['ai-policy-social-impact', 'AI policy and social impact'],
  ['education-training', 'Education and training'],
  ['community-discussion', 'Community and discussion'],
  ['other', 'Other'],
] as const;

export const professionalRoleValues = new Set(professionalRoleOptions.map(([value]) => value));
export const primaryInterestValues = new Set(primaryInterestOptions.map(([value]) => value));
export const countryCodeValues = new Set<string>(countryCodes);

export type MemberProfileChoices = {
  professionalRole: string;
  primaryInterest: string;
  countryCode: string;
  profileCompletedAt: string;
};

export const populateCountryOptions = (select: HTMLSelectElement) => {
  if (select.options.length > 1) return;
  let displayNames: Intl.DisplayNames | undefined;
  try {
    displayNames = new Intl.DisplayNames(navigator.languages, { type: 'region' });
  } catch {
    displayNames = undefined;
  }
  const collator = new Intl.Collator(navigator.languages, { sensitivity: 'base' });
  const options = countryCodes
    .map((code) => ({ code, label: displayNames?.of(code) ?? code }))
    .sort((left, right) => collator.compare(left.label, right.label));
  for (const { code, label } of options) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    select.append(option);
  }
};
