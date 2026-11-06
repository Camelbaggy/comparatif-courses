import { html, useState } from './lib.js';
import { driveConfigured } from '../../config.js';

export function SettingsView({ data, settings, onSettings, drive, github, user, setUser }) {
  const [token, setToken] = useState(github.token || '');
  const threshold = data.settings.auchan_threshold_eur_per_kg;
  return html`<section>
    <h2>Google Drive (liste partagée)</h2>
    <div class="card">
      ${!driveConfigured()
        ? html`<p class="msg">Identifiants Google pas encore configurés (config.js). La liste est enregistrée dans ce navigateur uniquement.</p>` : null}
      <p class="muted">${drive.fileId ? `Fichier lié : ${drive.fileId}` : 'Aucun fichier lié.'}
        ${drive.connected ? ' · connecté' : ''}</p>
      <div class="row">
        <button class="primary" disabled=${!driveConfigured()} onClick=${drive.connect}>
          ${drive.connected ? 'Synchroniser maintenant' : 'Se connecter à Google'}</button>
        <button disabled=${!drive.connected} onClick=${drive.create}>Créer le fichier</button>
        <button disabled=${!drive.connected} onClick=${drive.pick}>Ouvrir le fichier partagé</button>
        ${drive.fileId ? html`<button class="danger" onClick=${drive.unlink}>Délier</button>` : null}
      </div>
      <p class="muted">Première utilisation : une personne crée le fichier puis le partage (Drive > Partager) avec l'autre ; l'autre clique sur « Ouvrir le fichier partagé » une seule fois.</p>
    </div>

    <h2>Recherche des prix (GitHub)</h2>
    <div class="card">
      <label class="muted" for="gh">Jeton GitHub (droit « Actions : lecture et écriture » sur ce seul dépôt)</label>
      <div class="row">
        <input id="gh" class="grow" type="password" autocomplete="off" value=${token}
          onInput=${(e) => setToken(e.target.value)} placeholder="github_pat_…" />
        <button onClick=${() => github.setToken(token.trim())}>Enregistrer</button>
        ${github.token ? html`<button class="danger" onClick=${() => { setToken(''); github.setToken(''); }}>Effacer</button>` : null}
      </div>
      <p class="muted">Enregistré uniquement dans ce navigateur. Sans jeton, l'appli utilise des données d'exemple.</p>
    </div>

    <h2>Préférences</h2>
    <div class="card">
      <label class="row"><input type="checkbox" checked=${data.settings.auchan_enabled}
        onChange=${(e) => onSettings({ auchan_enabled: e.target.checked })} /> Auchan en repli (produits introuvables ailleurs)</label>
      <div class="row" style="margin-top:8px">
        <label for="thr" class="grow">Suggérer Auchan si le prix dépasse (€/kg)</label>
        <input id="thr" type="number" min="0" step="0.5" style="width:96px" value=${threshold ?? ''}
          onChange=${(e) => onSettings({ auchan_threshold_eur_per_kg: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
      <div class="row" style="margin-top:8px">
        <label for="usr" class="grow">Votre nom (affiché dans « validé par »)</label>
        <input id="usr" type="text" style="width:200px" value=${user || ''} onChange=${(e) => setUser(e.target.value)} />
      </div>
    </div>
  </section>`;
}
