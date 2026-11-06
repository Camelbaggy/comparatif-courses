import { html, useState } from './lib.js';
import { STORES, STORE_LABELS } from '../compare.js';
import { eur, unitText } from './lib.js';

function plainText(basket) {
  return basket.lines
    .map((l) => `${l.quantity} × ${l.product.name}${l.product.brand ? ' (' + l.product.brand + ')' : ''} ${l.product.pack_qty ?? ''}${l.product.pack_unit ?? ''}`)
    .join('\n');
}

function Basket({ basket }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plainText(basket));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* presse-papiers indisponible */ }
  };
  if (!basket.lines.length && basket.store === 'auchan') return null;
  return html`<div class="card">
    <div class="row between">
      <h2 style="margin:0"><span class=${'badge ' + basket.store}>${STORE_LABELS[basket.store]}</span></h2>
      <button onClick=${copy} disabled=${!basket.lines.length}>${copied ? 'Copié ✓' : 'Copier la liste'}</button>
    </div>
    ${basket.lines.length === 0 ? html`<p class="muted">Rien à acheter ici.</p>` : html`
      <table class="lines"><tbody>
        ${basket.lines.map((l) => html`<tr>
          <td>${l.product.url ? html`<a href=${l.product.url} target="_blank" rel="noopener">${l.product.name}</a>` : l.product.name}
            <div class="muted">${l.item.label} × ${l.quantity} · ${unitText(l.unit)}
              ${l.saving ? html` · <span class="badge ok">−${eur(l.saving.amount)} vs ${STORE_LABELS[l.saving.versus]}</span>` : null}</div></td>
          <td class="r price">${eur(l.lineTotal)}</td></tr>`)}
      </tbody></table>
      <div class="total"><span>Total estimé</span><span class="price">${eur(basket.total)}</span></div>
      ${basket.savings > 0 ? html`<div class="muted">Économie vs alternative : ${eur(basket.savings)}</div>` : null}`}
  </div>`;
}

export function BasketsView({ baskets }) {
  const { stores, farm, unfound, pending } = baskets;
  return html`<section>
    <div class="card">
      <div class="muted">Coût global estimé du panier optimisé</div>
      <div class="big price" style="font-size:1.6rem">${eur(baskets.total)}</div>
      ${baskets.totalSavings > 0 ? html`<div class="muted">dont ${eur(baskets.totalSavings)} économisés grâce à la comparaison</div>` : null}
      <div class="row muted" style="margin-top:6px">
        ${STORES.map((s) => html`<span class=${'badge ' + s}>${STORE_LABELS[s]} ${eur(stores[s].total)}</span>`)}
      </div>
    </div>
    ${STORES.map((s) => html`<${Basket} basket=${stores[s]} />`)}
    ${unfound.length ? html`<div class="card"><h2 style="margin:0 0 6px">Introuvables</h2>
      ${unfound.map((d) => html`<div>${d.item.label} <span class="muted">× ${d.quantity}</span></div>`)}
      <p class="muted">À acheter autrement, ou reformulez la recherche.</p></div>` : null}
    ${pending.length ? html`<div class="card"><h2 style="margin:0 0 6px">Pas encore comparés</h2>
      ${pending.map((d) => html`<div>${d.item.label}</div>`)}</div>` : null}
    ${farm.length ? html`<div class="card"><h2 style="margin:0 0 6px"><span class="badge farm">Ferme</span> pour mémoire</h2>
      ${farm.map((i) => html`<div>${i.label} <span class="muted">× ${i.qty}</span></div>`)}</div>` : null}
    <p class="muted">Prix estimés d'après les catalogues au moment de la recherche ; frais de livraison et minimum de commande non inclus.</p>
  </section>`;
}
