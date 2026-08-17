import { getAuth, onAuthStateChanged } from 'firebase/auth';
import {
  AI_CONNECTIONS_CHANGED_EVENT,
  PLAYGROUND_MAX_PROMPT_CHARACTERS,
  getBrowserAiConnectionContext,
  runRouterComparison,
  type RouterComparisonResult,
} from './ai-connections';
import { getFirebaseClientApp, isFirebaseConfigured } from './firebase-client';

const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);

const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const formatLatency = (milliseconds: number) => milliseconds < 1_000
  ? `${Math.round(milliseconds)} ms`
  : `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;

const formatCost = (result: RouterComparisonResult) => {
  if (typeof result.cost !== 'number' || !result.costUnit) return 'Not reported';
  if (result.costUnit === 'USD') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: result.cost < 0.01 ? 5 : 2,
      maximumFractionDigits: result.cost < 0.01 ? 6 : 4,
    }).format(result.cost);
  }
  return `${result.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })} credits`;
};

const formatTokens = (result: RouterComparisonResult) => {
  if (typeof result.inputTokens !== 'number' && typeof result.outputTokens !== 'number') return 'Not reported';
  const input = typeof result.inputTokens === 'number' ? result.inputTokens.toLocaleString() : '?';
  const output = typeof result.outputTokens === 'number' ? result.outputTokens.toLocaleString() : '?';
  return `${input} in / ${output} out`;
};

const formatOutputSpeed = (result: RouterComparisonResult) => typeof result.outputTokensPerSecond === 'number'
  ? `${result.outputTokensPerSecond.toFixed(result.outputTokensPerSecond < 10 ? 1 : 0)} tokens/s`
  : 'Not reported';

const SUGGESTED_PROMPT = 'In exactly two short sentences, explain the difference between an AI model and an AI router to a curious beginner. Use one simple analogy and no jargon.';

const ROUTER_RESOURCES: Record<string, { mark: string; href: string }> = {
  openrouter: { mark: 'OR', href: 'https://openrouter.ai/' },
  huggingface: { mark: 'HF', href: 'https://huggingface.co/docs/inference-providers/index' },
  cloudflare: { mark: 'CF', href: 'https://developers.cloudflare.com/ai-gateway/' },
  merge: { mark: 'MG', href: 'https://gateway.merge.dev/get-started' },
};

const modelResourceUrl = (result: RouterComparisonResult) => {
  if (!result.actualModel) return '';
  const modelId = result.actualModel.split(':')[0];
  if (result.routerId === 'openrouter') return `https://openrouter.ai/${modelId}`;
  if (result.routerId === 'huggingface') return `https://huggingface.co/${modelId}`;
  return '';
};

const externalLink = (label: string, href: string, className?: string) => {
  const link = createElement('a', className, label);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
};

const resultDetail = (label: string, value: string) => {
  const item = createElement('div', 'playground-detail');
  item.append(createElement('dt', undefined, label), createElement('dd', undefined, value));
  return item;
};

export const initializeAiRouterPlayground = () => {
  const loading = find<HTMLElement>('[data-playground-loading]');
  const signedOut = find<HTMLElement>('[data-playground-signed-out]');
  const content = find<HTMLElement>('[data-playground-content]');
  const prompt = find<HTMLTextAreaElement>('[data-playground-prompt]');
  const useExample = find<HTMLButtonElement>('[data-playground-use-example]');
  const characterCount = find<HTMLElement>('[data-playground-character-count]');
  const compare = find<HTMLButtonElement>('[data-playground-compare]');
  const status = find<HTMLElement>('[data-playground-status]');
  const results = find<HTMLElement>('[data-playground-results]');
  const summary = find<HTMLElement>('[data-playground-summary]');
  const routerInputs = [...document.querySelectorAll<HTMLInputElement>('[data-playground-router]')];

  if (!isFirebaseConfigured) {
    if (loading) loading.hidden = true;
    if (signedOut) signedOut.hidden = false;
    const message = signedOut?.querySelector<HTMLElement>('[data-playground-signed-out-message]');
    if (message) message.textContent = 'The configured AI Spanda sign-in service is required.';
    return;
  }

  const { registry, manager: connectionManager } = getBrowserAiConnectionContext();
  let runId = 0;
  let running = false;

  const selectedConnectors = () => routerInputs
    .filter((input) => input.checked && !input.disabled)
    .map((input) => registry.get(input.value));

  const setStatus = (message: string, tone: 'neutral' | 'error' | 'success' = 'neutral') => {
    if (!status) return;
    status.textContent = message;
    status.dataset.tone = tone;
  };

  const updateControls = () => {
    const selectedCount = selectedConnectors().length;
    if (compare) {
      compare.disabled = running || selectedCount < 1;
      compare.textContent = running
        ? selectedCount > 1 ? 'Comparing…' : 'Running…'
        : selectedCount > 1 ? `Compare selected routers (${selectedCount})` : 'Run selected router';
    }
  };

  const renderRouterChoices = () => {
    for (const input of routerInputs) {
      const connector = registry.get(input.value);
      const row = input.closest<HTMLElement>('[data-playground-router-row]');
      const state = row?.querySelector<HTMLElement>('[data-playground-router-state]');
      const connected = connector.status.connected;
      const active = connectionManager.activeId === input.value && connected;
      input.disabled = !connected;
      input.checked = connected;
      row?.toggleAttribute('data-connected', connected);
      row?.toggleAttribute('data-active', active);
      if (state) state.textContent = active ? 'Active' : connected ? 'Connected' : 'Not connected';
    }
    updateControls();
  };

  const renderSummary = (comparisonResults: RouterComparisonResult[]) => {
    if (!summary) return;
    summary.replaceChildren();
    const successful = comparisonResults.filter((result) => result.success);
    if (!successful.length) {
      summary.hidden = true;
      return;
    }

    summary.hidden = false;
    const heading = createElement('div', 'playground-summary-heading');
    heading.append(
      createElement('h2', undefined, 'Compare at a glance'),
      createElement('p', undefined, 'Performance comes first. Green marks the best result and red marks the weakest when measurements are directly comparable.'),
    );
    summary.append(heading);

    const reportedModels = successful.map((result) => result.actualModel || result.requestedModel).filter(Boolean);
    const differentModels = new Set(reportedModels).size > 1;
    const incompleteResults = comparisonResults.some((result) => !result.success);
    if (differentModels || incompleteResults) {
      const notice = createElement('aside', 'playground-summary-warning');
      notice.setAttribute('role', 'note');
      if (differentModels) {
        notice.append(
          createElement('strong', undefined, 'Different models were used.'),
          createElement('span', undefined, " This measures each router's selected route, not router performance alone."),
        );
      }
      if (incompleteResults) {
        if (differentModels) notice.append(document.createTextNode(' '));
        notice.append(
          createElement('strong', undefined, 'One or more routers did not complete.'),
          createElement('span', undefined, ' Compare the completed results separately.'),
        );
      }
      summary.append(notice);
    }

    const withResponseTime = successful.filter((result) => typeof result.totalLatencyMs === 'number');
    const responseTimeComparable = withResponseTime.length === successful.length && withResponseTime.length > 1;
    const fastestResponseTime = responseTimeComparable
      ? [...withResponseTime].sort((a, b) => a.totalLatencyMs - b.totalLatencyMs)[0]
      : undefined;
    const slowestResponseTime = responseTimeComparable
      ? [...withResponseTime].sort((a, b) => b.totalLatencyMs - a.totalLatencyMs)[0]
      : undefined;
    const withOutputSpeed = successful.filter((result) => typeof result.outputTokensPerSecond === 'number');
    const outputSpeedComparable = withOutputSpeed.length === successful.length && withOutputSpeed.length > 1;
    const fastestOutput = outputSpeedComparable
      ? [...withOutputSpeed].sort((a, b) => (b.outputTokensPerSecond ?? 0) - (a.outputTokensPerSecond ?? 0))[0]
      : undefined;
    const slowestOutput = outputSpeedComparable
      ? [...withOutputSpeed].sort((a, b) => (a.outputTokensPerSecond ?? 0) - (b.outputTokensPerSecond ?? 0))[0]
      : undefined;
    const withCost = successful.filter((result) => typeof result.cost === 'number' && result.costUnit);
    const costUnits = new Set(withCost.map((result) => result.costUnit));
    const costsComparable = withCost.length === successful.length && withCost.length > 1 && costUnits.size === 1;
    const lowestCost = costsComparable
      ? [...withCost].sort((a, b) => (a.cost ?? 0) - (b.cost ?? 0))[0]
      : undefined;
    const highestCost = costsComparable
      ? [...withCost].sort((a, b) => (b.cost ?? 0) - (a.cost ?? 0))[0]
      : undefined;

    const tableWrap = createElement('div', 'playground-table-wrap');
    const table = createElement('table', 'playground-comparison-table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const metricHeader = document.createElement('th');
    metricHeader.scope = 'col';
    metricHeader.textContent = 'What to compare';
    headerRow.append(metricHeader);
    for (const result of comparisonResults) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      const column = createElement('span', 'playground-router-column');
      const routerResource = ROUTER_RESOURCES[result.routerId];
      const identity = createElement('span', 'playground-router-identity');
      if (routerResource) {
        identity.append(
          createElement('span', 'playground-brand-mark', routerResource.mark),
          externalLink(result.routerLabel, routerResource.href),
        );
      } else {
        identity.append(createElement('strong', undefined, result.routerLabel));
      }
      const modelLabel = result.success ? result.actualModel || 'Model not reported' : 'Request did not complete';
      const modelUrl = result.success ? modelResourceUrl(result) : '';
      const model = createElement('small');
      model.append(modelUrl ? externalLink(modelLabel, modelUrl) : document.createTextNode(modelLabel));
      column.append(identity, model);
      cell.append(column);
      headerRow.append(cell);
    }
    head.append(headerRow);
    table.append(head);

    const body = document.createElement('tbody');
    const appendRow = (
      label: string,
      help: string,
      value: (result: RouterComparisonResult) => string,
      marker: (result: RouterComparisonResult) => { label: string; tone: 'winner' | 'loser' } | undefined = () => undefined,
    ) => {
      const row = document.createElement('tr');
      const labelCell = document.createElement('th');
      labelCell.scope = 'row';
      labelCell.append(
        createElement('span', 'playground-metric-label', label),
        createElement('span', 'playground-metric-help', help),
      );
      row.append(labelCell);
      for (const result of comparisonResults) {
        const cell = document.createElement('td');
        const content = createElement('div', `playground-table-value${result.success ? '' : ' playground-unavailable'}`);
        content.append(document.createTextNode(result.success ? value(result) : 'Did not complete'));
        const resultMarker = result.success ? marker(result) : undefined;
        if (resultMarker) {
          cell.classList.add(`is-${resultMarker.tone}`);
          content.append(createElement('span', `playground-marker is-${resultMarker.tone}`, resultMarker.label));
        }
        cell.append(content);
        row.append(cell);
      }
      body.append(row);
    };

    const appendSection = (label: string, help: string) => {
      const row = document.createElement('tr');
      row.className = 'playground-table-section';
      const cell = document.createElement('th');
      cell.scope = 'rowgroup';
      cell.colSpan = comparisonResults.length + 1;
      cell.append(
        createElement('span', 'playground-section-label', label),
        createElement('span', 'playground-section-help', help),
      );
      row.append(cell);
      body.append(row);
    };

    appendSection('Performance', 'Which completed route was faster or cheaper in this browser run?');
    appendRow(
      'Response time',
      'Lower is better. Total browser-observed time until the response was received; this is not time to first token.',
      (result) => formatLatency(result.totalLatencyMs),
      (result) => !fastestResponseTime || !slowestResponseTime || fastestResponseTime.totalLatencyMs === slowestResponseTime.totalLatencyMs
        ? undefined
        : result.routerId === fastestResponseTime.routerId
          ? { label: 'Fastest', tone: 'winner' }
          : result.routerId === slowestResponseTime.routerId
            ? { label: 'Slowest', tone: 'loser' }
            : undefined,
    );
    appendRow(
      'Output speed',
      'Higher is better. Approximate end-to-end output tokens per second for this browser run.',
      formatOutputSpeed,
      (result) => !fastestOutput || !slowestOutput || fastestOutput.outputTokensPerSecond === slowestOutput.outputTokensPerSecond
        ? undefined
        : result.routerId === fastestOutput.routerId
          ? { label: 'Fastest output', tone: 'winner' }
          : result.routerId === slowestOutput.routerId
            ? { label: 'Slowest output', tone: 'loser' }
            : undefined,
    );
    appendRow(
      'Reported cost',
      costsComparable ? 'Lower is better. All successful routers reported the same unit.' : 'Lower is better, but a winner needs comparable reported values from every successful router.',
      (result) => formatCost(result),
      (result) => !lowestCost || !highestCost || lowestCost.cost === highestCost.cost
        ? undefined
        : result.routerId === lowestCost.routerId
          ? { label: 'Lowest cost', tone: 'winner' }
          : result.routerId === highestCost.routerId
            ? { label: 'Highest cost', tone: 'loser' }
            : undefined,
    );
    appendRow(
      'Token use',
      'Information only. Tokenizers differ, so fewer tokens do not automatically mean a better answer.',
      (result) => formatTokens(result),
    );
    appendRow(
      'Reasoning tokens',
      'Information only. More hidden reasoning can increase cost, but does not guarantee a better answer.',
      (result) => typeof result.reasoningTokens === 'number' ? result.reasoningTokens.toLocaleString() : 'Not reported',
    );

    appendSection('Routing details', 'What each router selected and how the request was served.');
    appendRow(
      'Routing method',
      'How the router decided where to send this request.',
      (result) => result.requestedRoute || 'Not reported',
    );
    appendRow(
      'Model ownership',
      'Open-weight models offer more inspectability; proprietary models are controlled by their provider.',
      (result) => result.modelOwnership,
    );
    appendRow(
      'Usage type',
      'Shows whether this run was reported as free, paid, account credit, or route-defined billing.',
      (result) => result.usageType,
    );
    appendRow(
      'Fallback',
      'Shows whether an alternate provider or route was available and whether its use was disclosed.',
      (result) => result.fallbackStatus,
    );
    appendRow(
      'Infrastructure provider',
      'The company that served the compute, not the model publisher. A router may choose differently next time.',
      (result) => result.provider || (result.routerId === 'huggingface' ? 'Not disclosed in this response' : 'Not reported'),
    );
    table.append(body);
    tableWrap.append(table);
    summary.append(tableWrap);
    summary.append(createElement('p', 'playground-summary-note', 'No overall winner or AI quality score is calculated. Read the answers and choose which helped you more; one run is a useful trial, not a permanent benchmark.'));
  };

  const refreshResultActivationControls = () => {
    results?.querySelectorAll<HTMLElement>('[data-result-router-id]').forEach((action) => {
      const isActive = connectionManager.activeId === action.dataset.resultRouterId;
      const button = action.querySelector<HTMLButtonElement>('[data-result-activate]');
      const indicator = action.querySelector<HTMLElement>('[data-result-active]');
      if (button) button.hidden = isActive;
      if (indicator) indicator.hidden = !isActive;
    });
  };

  const renderResults = (comparisonResults: RouterComparisonResult[], currentRun: number) => {
    if (!results || currentRun !== runId) return;
    results.replaceChildren();
    const successfulCount = comparisonResults.filter((result) => result.success).length;
    for (const result of comparisonResults) {
      const card = createElement('article', `playground-result${result.success ? '' : ' is-error'}`);
      const heading = createElement('div', 'playground-result-heading');
      const titleGroup = createElement('div');
      titleGroup.append(createElement('p', 'eyebrow', 'Router answer'));
      titleGroup.append(createElement('h2', undefined, result.routerLabel));
      titleGroup.append(createElement('p', 'playground-result-model', result.success ? result.actualModel || 'Model not reported' : 'Request did not complete'));
      const badge = createElement('span', `playground-result-state ${result.success ? 'is-success' : 'is-error'}`, result.success ? 'Completed' : 'Needs attention');
      heading.append(titleGroup, badge);
      card.append(heading);

      if (!result.success) {
        card.append(createElement('p', 'playground-result-error', result.error || 'This router could not complete the request.'));
        card.append(createElement('p', 'playground-result-help', `Observed in this browser: ${formatLatency(result.totalLatencyMs)}. Other router results are unaffected.`));
        results.append(card);
        continue;
      }

      card.append(createElement('p', 'playground-answer', result.responseText));
      if (result.responseTruncated) card.append(createElement('p', 'playground-result-help', 'Display shortened to 500 characters. The router may have returned more text.'));

      const details = createElement('details', 'playground-result-details');
      details.append(createElement('summary', undefined, 'How this result was produced'));
      const detailList = createElement('dl', 'playground-detail-list');
      detailList.append(
        resultDetail('Model requested', result.requestedModel || 'Not reported'),
        resultDetail('Cache use', result.cacheHit === undefined ? 'Not reported' : result.cacheHit ? 'Reported' : 'Not reported'),
        resultDetail('Timing source', 'Observed by this browser'),
        resultDetail('Cost source', result.costSource === 'router-estimate' ? 'Router estimate' : result.costSource === 'reported' ? 'Reported by router' : 'Not reported'),
      );
      details.append(detailList);
      card.append(details);

      if (successfulCount > 1) {
        const preference = createElement('label', 'playground-preference');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = `preferred-router-${currentRun}`;
        radio.value = result.routerId;
        const preferenceLabel = createElement('span', 'playground-preference-label', 'Choose as the better answer');
        radio.addEventListener('change', () => {
          results.querySelectorAll<HTMLElement>('.playground-result').forEach((resultCard) => resultCard.classList.remove('is-preferred'));
          results.querySelectorAll<HTMLElement>('.playground-preference-label').forEach((label) => { label.textContent = 'Choose as the better answer'; });
          card.classList.add('is-preferred');
          preferenceLabel.textContent = 'Your preferred answer';
        });
        preference.append(radio, preferenceLabel);
        card.append(preference);
      }

      const activation = createElement('div', 'playground-result-activation');
      activation.dataset.resultRouterId = result.routerId;
      const activateButton = createElement('button', 'button button-secondary', 'Make active');
      activateButton.type = 'button';
      activateButton.dataset.resultActivate = '';
      activateButton.addEventListener('click', () => {
        connectionManager.activate(result.routerId);
        renderRouterChoices();
        refreshResultActivationControls();
        window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
        setStatus(`${result.routerLabel} is now active for AI actions.`, 'success');
      });
      const activeIndicator = createElement('span', 'connection-active-indicator', '✓ Active');
      activeIndicator.dataset.resultActive = '';
      activation.append(activateButton, activeIndicator);
      card.append(activation);
      results.append(card);
    }
    refreshResultActivationControls();
    renderSummary(comparisonResults);
  };

  const execute = async (connectors: ReturnType<typeof selectedConnectors>) => {
    const value = prompt?.value.trim() ?? '';
    if (!value) {
      setStatus('Enter a short prompt first.', 'error');
      prompt?.focus();
      return;
    }
    if (value.length > PLAYGROUND_MAX_PROMPT_CHARACTERS) {
      setStatus(`Keep the prompt within ${PLAYGROUND_MAX_PROMPT_CHARACTERS} characters.`, 'error');
      prompt?.focus();
      return;
    }
    if (!connectors.length) {
      setStatus('Connect and select at least one router.', 'error');
      return;
    }

    const currentRun = ++runId;
    running = true;
    updateControls();
    setStatus(`Sending the same prompt to ${connectors.length} ${connectors.length === 1 ? 'router' : 'routers'}…`);
    if (results) results.replaceChildren();
    if (summary) summary.hidden = true;

    const settled = await Promise.allSettled(connectors.map((connector) => runRouterComparison(connector, value)));
    if (currentRun !== runId) return;
    const comparisonResults = settled.map((outcome, index): RouterComparisonResult => outcome.status === 'fulfilled'
      ? outcome.value
      : {
          routerId: connectors[index].descriptor.id,
          routerLabel: connectors[index].descriptor.label,
          responseText: '',
          responseTruncated: false,
          totalLatencyMs: 0,
          latencySource: 'browser',
          modelOwnership: 'Not determined',
          usageType: 'Not available',
          fallbackStatus: 'Request did not complete',
          success: false,
          error: outcome.reason instanceof Error ? outcome.reason.message : 'This router could not complete the request.',
        });
    renderResults(comparisonResults, currentRun);
    const completed = comparisonResults.filter((result) => result.success).length;
    setStatus(`${completed} of ${comparisonResults.length} ${comparisonResults.length === 1 ? 'router' : 'routers'} completed.`, completed ? 'success' : 'error');
    running = false;
    updateControls();
  };

  prompt?.addEventListener('input', () => {
    if (characterCount) characterCount.textContent = `${prompt.value.length}/${PLAYGROUND_MAX_PROMPT_CHARACTERS}`;
  });
  useExample?.addEventListener('click', () => {
    if (!prompt) return;
    prompt.value = SUGGESTED_PROMPT;
    prompt.dispatchEvent(new Event('input', { bubbles: true }));
    prompt.focus();
    setStatus('Suggested prompt added. Choose a router or compare all connected routers.');
  });
  for (const input of routerInputs) input.addEventListener('change', updateControls);
  window.addEventListener(AI_CONNECTIONS_CHANGED_EVENT, () => {
    renderRouterChoices();
    refreshResultActivationControls();
    const active = connectionManager.active;
    setStatus(active
      ? `${active.descriptor.label} is active for AI actions.`
      : 'Connect and activate an AI router to use AI actions.');
  });
  compare?.addEventListener('click', () => void execute(selectedConnectors()));

  const auth = getAuth(getFirebaseClientApp());
  onAuthStateChanged(auth, (user) => {
    if (loading) loading.hidden = true;
    if (signedOut) signedOut.hidden = Boolean(user);
    if (content) content.hidden = !user;
    if (!user) return;
    setStatus('Checking your connected routers…');
    void Promise.allSettled(
      registry.list().filter((connector) => connector.status.connected).map((connector) => connector.refreshStatus()),
    ).then(() => {
      renderRouterChoices();
      const connectedCount = registry.list().filter((connector) => connector.status.connected).length;
      setStatus(connectedCount
        ? 'Ready. Results are temporary and remain only on this page.'
        : 'Connect an AI router from My account before using the Playground.');
    });
  });
};
