const form = document.querySelector('.cp-form');
const count = document.getElementById('customers');
const notApplicable = document.getElementById('not-applicable');
const errorMessage = form.querySelector('.cp-form-error');
const button = form.querySelector('button[type="submit"]');
const buttonLabel = button.querySelector('span');

notApplicable.addEventListener('change', () => {
  // Keep a typed count available if the visitor changes their mind.
  count.disabled = notApplicable.checked;
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled || !form.reportValidity()) return;
  errorMessage.hidden = true;

  // A local design preview has no form backend. Never claim it saved a lead.
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    errorMessage.textContent = "This preview doesn't send registrations. Or email me: lukas@cafecarepackage.com";
    errorMessage.hidden = false;
    errorMessage.focus();
    return;
  }

  button.disabled = true;
  buttonLabel.textContent = 'Registering…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const body = new URLSearchParams(new FormData(form)).toString();
    const response = await fetch('/register-interest/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    });
    if (!response.ok) throw new Error('Registration was not accepted');
    location.assign(form.getAttribute('action'));
  } catch {
    errorMessage.textContent = "Couldn't confirm your registration. Try again, or email lukas@cafecarepackage.com.";
    errorMessage.hidden = false;
    errorMessage.focus();
    button.disabled = false;
    buttonLabel.textContent = 'Register interest';
  } finally {
    clearTimeout(timeout);
  }
});
