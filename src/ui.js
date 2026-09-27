const $ = (id) => document.getElementById(id);

// 臺灣廟宇常見解釋（行天宮、龍山寺等）
export const READINGS = {
  sheng: {
    title: '聖筊',
    seal: '允',
    sub: '一平一凸・神明應允',
    body: '所問之事，神明同意。若是重大決定，可再求連續三個聖筊，以確認神意。',
    short: '聖',
  },
  xiao: {
    title: '笑筊',
    seal: '笑',
    sub: '兩平面朝上・笑而不答',
    body: '神明笑而不答：或許問題說得不夠清楚，或時機未到。請把事情講明白，再擲一次。',
    short: '笑',
  },
  yin: {
    title: '陰筊',
    seal: '否',
    sub: '兩凸面朝上・神明不允',
    body: '所問之事不宜，或需再三思量。請改變想法、換個方式請示，或擇日再問。',
    short: '陰',
  },
  li: {
    title: '立筊',
    seal: '奇',
    sub: '筊杯立地・極為罕見',
    body: '筊杯立於地上，民間視為神明顯靈、另有指示。廟方常會以金紙圍起，留待神明示意。',
    short: '立',
  },
};

export class UI {
  constructor() {
    this.el = {
      loading: $('loading'), bar: $('bar'), loadNote: $('loadNote'), brand: $('brand'), intro: $('intro'),
      status: $('status'), result: $('result'), rTitle: $('rTitle'), rSub: $('rSub'), rBody: $('rBody'),
      seal: $('seal'), streak: $('streak'), history: $('history'), tools: $('tools'), info: $('info'),
      btnSound: $('btnSound'), btnInfo: $('btnInfo'), btnClose: $('btnClose'),
    };
    this.history = [];
    this.streak = 0;
  }

  progress(f, note) {
    this.el.bar.style.width = `${Math.round(Math.min(1, f) * 100)}%`;
    if (note) this.el.loadNote.textContent = note;
  }

  ready() {
    this.el.loading.classList.add('hidden');
    for (const k of ['brand', 'intro', 'tools']) this.el[k].classList.remove('hidden');
  }

  error(msg) {
    this.el.loadNote.textContent = msg;
    this.el.loadNote.style.opacity = 1;
  }

  throwing() {
    this.el.intro.classList.add('hidden');
    this.el.result.classList.add('hidden');
    this.el.history.classList.add('hidden');
    this.status('');
  }

  status(text) {
    this.el.status.textContent = text;
    this.el.status.classList.toggle('hidden', !text);
  }

  show(kind) {
    const r = READINGS[kind];
    this.streak = kind === 'sheng' ? this.streak + 1 : 0;
    this.history.unshift(kind);
    this.history = this.history.slice(0, 8);

    const { result, rTitle, rSub, rBody, seal, streak } = this.el;
    result.className = `kind-${kind}`;
    rTitle.textContent = r.title;
    seal.textContent = r.seal;
    rSub.textContent = r.sub;
    rBody.textContent = r.body;

    if (kind === 'sheng') {
      const n = this.streak;
      const dots = [0, 1, 2].map((i) => `<i class="${i < Math.min(n, 3) ? 'on' : ''}"></i>`).join('');
      let label = `連續聖筊 ${n} 次`;
      if (n === 3) label = '三聖筊・神意已明';
      else if (n > 3) label = `連續 ${n} 個聖筊`;
      streak.innerHTML = `${dots}<b>${label}</b>`;
      streak.hidden = false;
    } else {
      streak.innerHTML = '';
      streak.hidden = true;
    }
    this.el.history.innerHTML = this.history
      .map((k) => `<li class="${k}" title="${READINGS[k].title}">${READINGS[k].short}</li>`)
      .join('');
    this.el.history.classList.remove('hidden');
    this.status('');
    return this.streak;
  }

  onSound(fn) {
    this.el.btnSound.addEventListener('click', (e) => {
      e.stopPropagation();
      const on = this.el.btnSound.classList.toggle('off') === false;
      this.el.btnSound.setAttribute('aria-pressed', String(on));
      fn(on);
    });
  }

  onInfo(open, close) {
    const show = (e) => { e.stopPropagation(); this.el.info.classList.remove('hidden'); open?.(); this.el.btnClose.focus(); };
    const hide = (e) => { e?.stopPropagation(); this.el.info.classList.add('hidden'); close?.(); };
    this.el.btnInfo.addEventListener('click', show);
    this.el.btnClose.addEventListener('click', hide);
    this.el.info.addEventListener('click', (e) => { if (e.target === this.el.info) hide(e); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
  }

  get infoOpen() {
    return !this.el.info.classList.contains('hidden');
  }
}
