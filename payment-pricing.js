(function (root) {
  'use strict';
  let pending;
  async function load(refresh = false) {
    // Same-origin on Care Pack; the marketing site provides the public URL.
    if (refresh) pending = null;
    if (!pending) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      pending = fetch(root.CARE_PACK_PRICING_URL || '/.netlify/functions/payment-pricing', { cache: 'no-store', signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error('Pricing unavailable');
          const value = await response.json();
          if (!value || !['card', 'debit', 'other', 'summary'].every(key => typeof value[key] === 'string')) throw new Error('Pricing unavailable');
          return value;
        }).finally(() => clearTimeout(timeout));
      pending.catch(() => { pending = null; });
    }
    return pending;
  }
  async function render(container = document) {
    try {
      const pricing = await load();
      container.querySelectorAll('[data-payment-pricing]').forEach(element => {
        const key = element.dataset.paymentPricing;
        if (typeof pricing[key] === 'string') element.textContent = pricing[key];
      });
    } catch (_) { /* Keep the link to current fees, never guess a rate. */ }
  }
  root.CarePackPaymentPricing = { load, render };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => render());
  else render();
})(window);
