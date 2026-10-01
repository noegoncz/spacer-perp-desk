(() => {
  const form = document.getElementById('signup');
  const msg = document.getElementById('msg');
  const send = document.getElementById('send');
  const say = (text, kind) => { msg.textContent = text; msg.className = 'msg ' + (kind || ''); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return say('Please enter a valid email address.', 'err');
    if (!form.consent.checked) return say('Please tick the consent box so we can email you.', 'err');
    send.disabled = true;
    say('Sending…');
    try {
      const res = await fetch('/api/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, consent: true, website: form.website.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong.');
      form.reset();
      say("Almost done — check your inbox and click the link to confirm your email. Can't see it? Look in your spam folder and mark it as not spam.", 'ok');
    } catch (err) {
      say(err.message || 'Something went wrong. Please try again.', 'err');
    } finally {
      send.disabled = false;
    }
  });
})();
