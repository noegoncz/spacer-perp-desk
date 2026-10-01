(() => {
  const t = new URLSearchParams(location.search).get('t') || '';
  const go = document.getElementById('go');
  const msg = document.getElementById('msg');
  const say = (s, k) => { msg.textContent = s; msg.className = 'msg ' + (k || ''); };
  if (!/^[0-9a-f]{64}$/.test(t)) {
    go.hidden = true;
    say('This link is not valid. Please use the link from the email we sent you.', 'err');
    return;
  }
  go.addEventListener('click', async () => {
    go.disabled = true;
    say('One moment…');
    try {
      const res = await fetch('/api/confirm', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'Something went wrong.');
      go.hidden = true;
      document.getElementById('text').hidden = true;
      say("You're on the list! We'll email you when the next beta round opens.", 'ok');
    } catch (e) {
      go.disabled = false;
      say(e.message || 'Something went wrong. Please try again.', 'err');
    }
  });
})();
