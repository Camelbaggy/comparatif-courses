// Preact + htm en un seul module servi par CDN (version épinglée) : pas d'étape de build.
export {
  h, html, render, useState, useEffect, useRef, useMemo, useCallback,
} from 'https://cdn.jsdelivr.net/npm/htm@3.1.1/preact/standalone.module.js';

export const eur = (n) =>
  n == null ? '—' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

export const BASIS_SHORT = { kg: 'kg', l: 'L', unit: 'unité' };
export const unitText = (u) => (u ? `${eur(u.value)} / ${BASIS_SHORT[u.basis]}` : 'prix à vérifier');
