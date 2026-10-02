/**
 * Pozvi přátele (doporučení / referraly).
 *
 * Tlačítko vlevo dole na přehledu pozic otevře okno: vlastní přezdívka
 * (= kód odkazu perpyx.com/ref/<přezdívka>), sdílení a kopírování, počty
 * pozvaných ve třech stupních a seznam se zamaskovanými e-maily. Kdo přišel
 * bez odkazu, může prvních pár dní zadat přezdívku toho, kdo ho pozval.
 *
 * Párování dělá server (web/lib/ref.js): pozvaný se zapíše na webu přes
 * odkaz a pak se v aplikaci přihlásí stejným e-mailem. Bod se počítá, až
 * aplikaci používá několik různých dní — přesná čísla se uživateli neříkají.
 */
import * as ucet from './ucet.js';
import { t } from './i18n.js';

const el = (id) => document.getElementById(id);
let stav = null;

function zprava(id, text, ok = false) {
  const p = el(id);
  if (!p) return;
  p.textContent = text || '';
  p.hidden = !text;
  p.classList.toggle('ok', ok);
}

const chybaText = (e) => {
  const kod = e?.kod;
  if (['invalid', 'reserved', 'taken', 'locked', 'not-found', 'self', 'already', 'too-late'].includes(kod)) {
    return t(`invite.err.${kod}`);
  }
  return t('invite.err.network');
};

async function zkopiruj(text, potvrzeni) {
  try {
    await navigator.clipboard.writeText(text);
    zprava('inviteMsg', potvrzeni, true);
  } catch {
    zprava('inviteMsg', text);
  }
}

async function sdilej() {
  if (!stav?.link) return;
  const text = t('invite.shareText', { link: stav.link });
  const sdileni = self.Capacitor?.Plugins?.Share;
  try {
    // Odkaz je už v textu; s `url` navíc ho Telegram a další aplikace
    // vložily podruhé (hlášeno uživatelem).
    if (sdileni) await sdileni.share({ title: 'PerpyX', text });
    else if (navigator.share) await navigator.share({ title: 'PerpyX', text });
    else await zkopiruj(text, t('invite.copiedLink'));
  } catch {
    // Zavřené okno sdílení není chyba.
  }
}

function vykresli() {
  const s = stav;
  if (!s) return;
  const maNick = Boolean(s.nick);
  el('inviteNickBox').hidden = maNick && !el('inviteNickBox').dataset.meni;
  el('inviteLinkBox').hidden = !maNick;
  if (maNick) {
    el('inviteLink').textContent = s.link.replace(/^https:\/\//, '');
    el('inviteCode').textContent = s.nick;
  }

  el('inviteCountInvited').textContent = s.counts?.invited ?? 0;
  el('inviteCountJoined').textContent = s.counts?.joined ?? 0;
  el('inviteCountActive').textContent = s.counts?.active ?? 0;

  const seznam = el('invitePeople');
  seznam.replaceChildren(...(s.people || []).map((p) => {
    const radek = document.createElement('li');
    const email = document.createElement('span');
    email.textContent = p.email;
    const stupen = document.createElement('span');
    stupen.className = `invite-stage ${p.stage}`;
    stupen.textContent = t(`invite.stage.${p.stage}`);
    radek.append(email, stupen);
    return radek;
  }));
  el('invitePeopleEmpty').hidden = Boolean(s.people?.length);

  el('inviteByBox').hidden = !s.canEnterCode;
  el('invitedBy').hidden = !s.invitedBy;
  if (s.invitedBy) el('invitedByNick').textContent = s.invitedBy;
}

async function nacti() {
  zprava('inviteMsg', '');
  try {
    stav = await ucet.api('GET', '/referral');
    vykresli();
  } catch (e) {
    zprava('inviteMsg', chybaText(e));
  }
}

async function ulozNick() {
  const nick = el('inviteNickInput').value.trim().toLowerCase();
  if (!nick) return;
  try {
    stav = await ucet.api('PUT', '/referral', { nick });
    delete el('inviteNickBox').dataset.meni;
    zprava('inviteMsg', t('invite.saved'), true);
    vykresli();
  } catch (e) {
    zprava('inviteMsg', chybaText(e));
  }
}

async function zadejKod() {
  const code = el('inviteByInput').value.trim().toLowerCase();
  if (!code) return;
  try {
    stav = await ucet.api('POST', '/referral', { code });
    zprava('inviteMsg', t('invite.byOk', { nick: stav.invitedBy }), true);
    vykresli();
  } catch (e) {
    zprava('inviteMsg', chybaText(e));
  }
}

export function otevri() {
  el('inviteBackdrop').hidden = false;
  el('sheetInvite').hidden = false;
  nacti();
}

export function zavri() {
  el('inviteBackdrop').hidden = true;
  el('sheetInvite').hidden = true;
}

/** Tlačítko jen pro přihlášené (pozvat bez účtu nejde). */
export function ukazTlacitko(prihlasen) {
  const b = el('inviteBtn');
  if (b) b.hidden = !prihlasen;
}

export function spust() {
  const na = (id, ud, fn) => el(id)?.addEventListener(ud, fn);
  na('inviteBtn', 'click', otevri);
  na('inviteClose', 'click', zavri);
  na('inviteBackdrop', 'click', zavri);
  na('inviteNickSave', 'click', ulozNick);
  na('inviteNickInput', 'keydown', (e) => { if (e.key === 'Enter') ulozNick(); });
  na('inviteShare', 'click', sdilej);
  na('inviteCopyLink', 'click', () => stav?.link && zkopiruj(stav.link, t('invite.copiedLink')));
  na('inviteCopyCode', 'click', () => stav?.nick && zkopiruj(stav.nick, t('invite.copiedCode')));
  na('inviteChangeNick', 'click', () => {
    el('inviteNickBox').dataset.meni = '1';
    el('inviteNickInput').value = stav?.nick || '';
    vykresli();
    el('inviteNickInput').focus();
  });
  na('inviteBySave', 'click', zadejKod);
}
