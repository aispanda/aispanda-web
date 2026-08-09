/** Stamp header labels onto cells so narrow screens can stack comparison tables as cards. */
export function enhanceInsightTables() {
  for (const table of document.querySelectorAll<HTMLTableElement>('.insight-prose table')) {
    const headers = [...table.querySelectorAll('thead th')].map((th) => th.textContent?.trim() ?? '');
    if (headers.length < 3) continue;

    table.classList.add('insight-table-stack');
    for (const row of table.querySelectorAll('tbody tr')) {
      [...row.children].forEach((cell, index) => {
        if (!(cell instanceof HTMLElement)) return;
        const label = headers[index];
        if (label) cell.dataset.label = label;
      });
    }
  }
}
