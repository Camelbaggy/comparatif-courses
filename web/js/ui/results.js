import { html, useState } from './lib.js';
import { STORES, STORE_LABELS, auchanSearchUrl, manualToProduct, isStale, queryFor } from '../compare.js';
import { eur, unitText } from './lib.js';
import { CATEGORY_LABELS } from '../data.js';

function ProductLine({ entry }) {
  const p = entry.product;
  return html`<span>
    ${p.url ? html`<a href=${p.url} target="_blank" rel="noopener">${p.name}</a>` : p.name}
    ${p.brand ? html` <span class="muted">· ${p.brand}</span>` : null}
    <span class="muted"> · ${p.pack_qty ?? '?'} ${p.pack_unit}</span>
  </span>`;
}

function ManualAuchan({ d, actions }) {
  const { item, manual } = d;
  const [f, setF] = useState({ name: '', price: '', pack_qty: '', pack_unit: 'g' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const valid = Number(f.price.replace(',', '.')) > 0 && Number(f.pack_qty.replace(',', '.')) > 0;
  const link = auchanSearchUrl(queryFor(item));
  const product = manual ? manualToProduct(manual) : null;
  const stale = product && isStale(product);
  const date = manual ? new Date(manual.entered_at).toLocaleDateString('fr-FR') : '';
  return html`<div style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line)">
    <div class="row between">
      <strong class="badge auchan">Prix Auchan (saisie manuelle)</strong>
      <a href=${link} target="_blank" rel="noopener">Chercher sur Auchan ↗</a>
    </div>
    ${manual ? html`<p style="margin:6px 0">
        ${manual.name || 'Produit Auchan'} · ${manual.pack_qty} ${manual.pack_unit} ·
        <b class="price">${eur(manual.price)}</b> <span class="muted price">(${unitText(
          product.unit_price == null ? null : { value: product.unit_price, basis: product.unit_price_basis })})</span>
        <span class="muted"> · saisi le ${date}${manual.entered_by ? ' par ' + manual.entered_by : ''}</span>
        ${stale ? html` <span class="badge warn">prix ancien : à revérifier</span>` : null}
        <button class="link danger" onClick=${() => actions.removeManual(item)}>supprimer</button>
      </p>`
      : html`<p class="muted" style="margin:6px 0">Ouvrez le lien, repérez le produit, puis saisissez son prix et son format.</p>`}
    <div class="row">
      <input class="grow" type="text" placeholder="Produit (facultatif)" value=${f.name} onInput=${set('name')} aria-label="Nom du produit Auchan" />
      <input type="text" inputmode="decimal" style="width:90px" placeholder="Prix €" value=${f.price} onInput=${set('price')} aria-label="Prix Auchan en euros" />
      <input type="text" inputmode="decimal" style="width:90px" placeholder="Quantité" value=${f.pack_qty} onInput=${set('pack_qty')} aria-label="Quantité du conditionnement" />
      <select style="width:auto" value=${f.pack_unit} onChange=${set('pack_unit')} aria-label="Unité">
        ${['g', 'kg', 'ml', 'cl', 'l', 'unit'].map((u) => html`<option value=${u}>${u === 'unit' ? 'unité(s)' : u}</option>`)}
      </select>
      <button class="primary" disabled=${!valid}
        onClick=${() => { actions.setManual(item, { ...f, url: link }); setF({ name: '', price: '', pack_qty: '', pack_unit: f.pack_unit }); }}>
        ${manual ? 'Mettre à jour' : 'Enregistrer'}</button>
    </div>
  </div>`;
}

function OptionsPicker({ decision, selection, onSelect }) {
  const { options } = decision;
  return html`<div class="cols">
    ${Object.keys(options).map((s) => html`<div>
      <strong class=${'badge ' + s}>${STORE_LABELS[s]}</strong>
      ${options[s].length === 0 ? html`<p class="muted">Aucun résultat.</p>` : null}
      ${options[s].slice(0, 6).map((e) => html`<label class=${'opt' + (e.available ? '' : ' off')}>
        <input type="radio" name=${decision.item.id + s} disabled=${!e.available || !e.comparable}
          checked=${selection[s] === e.product.id} onChange=${() => onSelect(s, e.product.id)} />
        <span><${ProductLine} entry=${e} /><br />
          <span class="price"><b>${eur(e.product.promo_price ?? e.product.price)}</b> · ${unitText(e.unit)}</span>
          ${e.product.promo_price != null ? html` <span class="badge warn">promo</span>` : null}
          ${!e.available ? html` <span class="badge warn">rupture</span>` : null}
          ${e.toCheck ? html` <span class="badge warn">à vérifier</span>` : null}
          ${e.product.manual ? html` <span class="badge auchan">manuel</span>` : null}
          ${isStale(e.product) ? html` <span class="badge warn">prix ancien</span>` : null}
          ${e.unit && !e.comparable ? html` <span class="badge warn">autre unité</span>` : null}
        </span>
      </label>`)}
      ${selection[s] ? html`<button class="link" onClick=${() => onSelect(s, null)}>aucun</button>` : null}
    </div>`)}
  </div>`;
}

function Card({ d, actions }) {
  const item = d.item;
  const [open, setOpen] = useState(false);
  const initial = Object.fromEntries(Object.keys(d.options).map((s) => [s, d.chosen[s]?.product.id ?? null]));
  const [selection, setSelection] = useState(initial);
  const select = (s, id) => setSelection({ ...selection, [s]: id });
  const hasEq = d.validated;

  return html`<div class="card">
    <div class="row between">
      <div><b>${item.label}</b> <span class="muted">× ${d.quantity}</span>
        <span class=${'badge ' + item.category}>${CATEGORY_LABELS[item.category]}</span></div>
      ${d.status === 'assigned'
        ? html`<span class=${'badge ' + d.store}>${STORE_LABELS[d.store]}</span>`
        : d.status === 'unfound' ? html`<span class="badge warn">introuvable</span>` : null}
    </div>
    ${d.status === 'assigned'
      ? html`<div style="margin-top:6px">
          <${ProductLine} entry=${{ product: d.product }} /><br />
          <span class="price big">${eur(d.lineTotal)}</span>
          <span class="muted price"> · ${unitText(d.unit)}</span>
          ${d.saving ? html` <span class="badge ok">−${eur(d.saving.amount)} vs ${STORE_LABELS[d.saving.versus]}</span>` : null}
          ${d.validated ? html` <span class="badge ok">équivalence validée</span>` : null}
          ${d.needsValidation ? html` <span class="badge warn">à valider</span>` : null}
          ${d.auchanSuggestion
            ? html` <span class="badge auchan">Auchan : ${unitText(d.auchanSuggestion.unit)}</span>` : null}
        </div>`
      : null}
    ${d.reasons.map((r) => html`<div class="muted">${r}</div>`)}
    ${d.needsManualAuchan ? html`<div class="msg">Introuvable ou Auchan demandé : saisissez le prix Auchan ci-dessous.</div>` : null}
    ${d.needsManualAuchan || d.manual || (item.want_auchan && d.status !== 'farm')
      ? html`<${ManualAuchan} d=${d} actions=${actions} />` : null}
    ${d.status !== 'pending'
      ? html`<details open=${open} onToggle=${(e) => setOpen(e.target.open)}>
          <summary>Comparer et valider</summary>
          <${OptionsPicker} decision=${d} selection=${selection} onSelect=${select} />
          <div class="row" style="margin-top:10px">
            <button class="primary" onClick=${() => actions.validate(item, selection)}>Valider cette équivalence</button>
            ${hasEq ? html`<button onClick=${() => actions.forget(item)}>Oublier</button>` : null}
            ${item.category !== 'farm'
              ? html`<select style="width:auto" value=${item.store_override ?? ''} aria-label="Forcer l'enseigne"
                  onChange=${(e) => actions.update(item.id, { store_override: e.target.value || null })}>
                  <option value="">Enseigne : auto</option>
                  ${STORES.map((s) => html`<option value=${s}>${STORE_LABELS[s]}</option>`)}
                </select>`
              : null}
            <label class="row" style="gap:4px"><input type="checkbox" checked=${!!item.want_auchan}
              onChange=${(e) => actions.update(item.id, { want_auchan: e.target.checked })} /> Voir Auchan</label>
          </div>
        </details>`
      : null}
  </div>`;
}

export function ResultsView({ decisions, run, actions }) {
  if (!decisions.length) return html`<p class="msg info">Ajoutez des produits dans la liste puis lancez la comparaison.</p>`;
  const order = { unfound: 0, assigned: 1, pending: 2, farm: 3 };
  const sorted = [...decisions].sort(
    (a, b) => (b.needsManualAuchan - a.needsManualAuchan) || (b.needsValidation - a.needsValidation) || order[a.status] - order[b.status],
  );
  const errors = Object.entries(run?.errors ?? {}).filter(([, v]) => v);
  return html`<section>
    ${run ? html`<p class="muted">Résultats du ${run.run_id ?? 'dernier run'}.</p>` : html`<p class="msg">Aucun résultat : lancez la comparaison depuis la liste.</p>`}
    ${errors.map(([s, e]) => html`<p class="msg error">${STORE_LABELS[s] ?? s} indisponible : ${e}</p>`)}
    ${sorted.map((d) => html`<${Card} key=${d.item.id + (d.store ?? '') + d.status} d=${d} actions=${actions} />`)}
  </section>`;
}
