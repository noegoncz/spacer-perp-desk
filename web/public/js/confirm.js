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
      const nadpis = document.querySelector('main h1');
      if (nadpis) nadpis.textContent = "You're on the list";
      say("✓ We'll email you when your spot in the beta opens — with a download link and a short guide.", 'ok');
      document.getElementById('feedback').hidden = false;
      // Odkaz pro přátele (2026-10-18) — jen když ho server vyrobil.
      if (data.ref && /^[a-z0-9-]{3,20}$/.test(data.ref)) {
        const odkaz = 'perpyx.com/ref/' + data.ref;
        document.getElementById('shareLink').textContent = odkaz;
        document.getElementById('share').hidden = false;
        document.getElementById('copy').addEventListener('click', () => {
          const zprava = document.getElementById('copyMsg');
          navigator.clipboard.writeText('https://' + odkaz).then(
            () => { zprava.textContent = 'Copied.'; zprava.className = 'msg ok'; },
            () => {
              const r = document.createRange();
              r.selectNodeContents(document.getElementById('shareLink'));
              const v = getSelection(); v.removeAllRanges(); v.addRange(r);
              zprava.textContent = 'Selected — copy it with your keyboard or long-press.';
              zprava.className = 'msg';
            },
          );
        });
      }
    } catch (e) {
      go.disabled = false;
      say(e.message || 'Something went wrong. Please try again.', 'err');
    }
  });
})();
