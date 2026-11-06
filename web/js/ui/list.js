import { html, useState } from './lib.js';
import { CATEGORY_LABELS, KIND_LABELS, visibleItems } from '../data.js';

function AddForm({ onAdd }) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('normal');
  const [kind, setKind] = useState('recurring');
  const [qty, setQty] = useState(1);
  const submit = (e) => {
    e.preventDefault();
    if (!label.trim()) return;
    onAdd({ label, category, kind, qty });
    setLabel('');
    setQty(1);
  };
  return html`<form class="card" onSubmit=${submit}>
    <div class="row">
      <input class="grow" type="text" placeholder="Ajouter un produit (ex. lait d'avoine)" value=${label}
        onInput=${(e) => setLabel(e.target.value)} aria-label="Produit" />
      <input type="number" min="1" step="1" value=${qty} onInput=${(e) => setQty(Number(e.target.value))} aria-label="Quantité" />
    </div>
    <div class="row" style="margin-top:8px">
      <select class="grow" value=${category} onChange=${(e) => setCategory(e.target.value)} aria-label="Type">
        <option value="normal">Normal (comparé)</option>
        <option value="fresh">Frais (→ Biocoop)</option>
        <option value="farm">Ferme (pas de comparaison)</option>
      </select>
      <select class="grow" value=${kind} onChange=${(e) => setKind(e.target.value)} aria-label="Fréquence">
        <option value="recurring">Habituel</option>
        <option value="oneoff">Ponctuel</option>
      </select>
      <button class="primary" type="submit">Ajouter</button>
    </div>
  </form>`;
}

function Item({ item, actions }) {
  return html`<div class=${'item' + (item.checked ? ' checked' : '')}>
    <input type="checkbox" checked=${item.checked} aria-label=${'Pris : ' + item.label}
      onChange=${(e) => actions.update(item.id, { checked: e.target.checked })} />
    <div class="label">
      ${item.label}
      <div class="row muted" style="gap:6px">
        <span class=${'badge ' + item.category}>${CATEGORY_LABELS[item.category]}</span>
        ${item.note ? html`<span>${item.note}</span>` : null}
      </div>
    </div>
    <input type="number" min="1" step="1" value=${item.qty} aria-label=${'Quantité de ' + item.label}
      onChange=${(e) => actions.update(item.id, { qty: Math.max(1, Number(e.target.value) || 1) })} />
    <select style="width:auto" value=${item.category} aria-label=${'Type de ' + item.label}
      onChange=${(e) => actions.update(item.id, { category: e.target.value })}>
      ${Object.entries(CATEGORY_LABELS).map(([k, v]) => html`<option value=${k}>${v}</option>`)}
    </select>
    <button class="danger" title="Supprimer" aria-label=${'Supprimer ' + item.label} onClick=${() => actions.remove(item.id)}>✕</button>
  </div>`;
}

export function ListView({ data, actions, search, onSearch, onFinish, onLoadSample, demo }) {
  const items = visibleItems(data);
  const groups = [
    ['recurring', 'Produits habituels'],
    ['oneoff', 'Recherches ponctuelles'],
  ];
  const todo = items.filter((i) => !i.checked && i.category !== 'farm').length;
  return html`<section>
    <${AddForm} onAdd=${actions.add} />
    <div class="row between">
      <button class="primary" disabled=${search.busy || !todo} onClick=${onSearch}>
        ${search.busy ? 'Recherche en cours…' : `Comparer les prix (${todo})`}
      </button>
      <button onClick=${onFinish} disabled=${!items.some((i) => i.checked)}>Fin des courses</button>
    </div>
    ${search.status ? html`<p class="muted">${search.status}</p>` : null}
    ${demo ? html`<p class="msg info">Mode démo : les résultats viennent d'un jeu de données d'exemple (aucun jeton GitHub enregistré).</p>` : null}
    ${items.length === 0
      ? html`<p class="msg info">Liste vide. <button class="link" onClick=${onLoadSample}>Charger un exemple</button></p>`
      : null}
    ${groups.map(([kind, title]) => {
      const list = items.filter((i) => i.kind === kind);
      if (!list.length) return null;
      return html`<h2>${title} <span class="muted">(${KIND_LABELS[kind]})</span></h2>
        <div class="card">${list.map((i) => html`<${Item} key=${i.id} item=${i} actions=${actions} />`)}</div>`;
    })}
    <p class="muted">Cochez un produit quand il est déjà pris : il est ignoré par la comparaison. « Fin des courses » supprime les ponctuels cochés et décoche les habituels.</p>
  </section>`;
}
