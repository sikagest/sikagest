/* SikaGest — écrans */
'use strict';

const PAY_METHODS = ['Espèces', 'Mobile Money', 'Orange Money', 'Wave', 'Carte bancaire', 'Chèque', 'Virement'];
const payOptions = (sel = 'Espèces') => PAY_METHODS.map((m) => `<option ${m === sel ? 'selected' : ''}>${m}</option>`).join('');
const emptyRow = (cols, title, hint = '') => `<tr><td colspan="${cols}"><div class="empty"><b>${title}</b>${hint}</div></td></tr>`;

// ======================================================================
// TABLEAU DE BORD
// ======================================================================
VIEWS.dashboard = async (c) => {
  setPage('Tableau de bord', `Bonjour ${S.user.name}`,
    `<select class="input" id="d-period"><option value="0">Aujourd'hui</option><option value="6">7 derniers jours</option><option value="29" selected>30 derniers jours</option><option value="364">12 derniers mois</option><option value="all">Depuis le début</option></select>
     <a class="btn primary" href="#/pos">${icon('pos')} Ouvrir la caisse</a>`);
  const draw = async () => {
    const v = $('#d-period').value;
    const range = v === 'all' ? {} : { from: daysAgo(Number(v)), to: today() };
    const [sum, daily, top, recent, low] = await Promise.all([
      API.call('reports.summary', range), API.call('reports.daily', { days: 30 }), API.call('reports.topProducts', { ...range, limit: 6 }),
      API.call('sales.list', {}), API.call('products.list', { lowOnly: true }),
    ]);
    const k = (ic, cls, label, val, sub = '') => `<div class="kpi"><div class="k-ico ${cls}">${icon(ic, '')}</div><div><div class="k-label">${label}</div><div class="k-val">${val}</div>${sub ? `<div class="k-sub">${sub}</div>` : ''}</div></div>`;
    c.innerHTML = `
      <div class="kpis">
        ${k('sale', 'c-brand', 'Total des ventes', money(sum.sales.net), `${sum.sales.n} vente(s)`)}
        ${k('cash', 'c-ok', 'Encaissé', money(sum.sales.paid))}
        ${k('alert', 'c-bad', 'Factures impayées', money(sum.sales.due))}
        ${k('trend', 'c-info', 'Bénéfice net', money(sum.netProfit), `Marge brute ${money(sum.grossProfit)}`)}
        ${k('purchase', 'c-info', 'Total des achats', money(sum.purchases.net), `${sum.purchases.n} achat(s)`)}
        ${k('wallet', 'c-warn', 'Achats impayés', money(sum.purchases.due))}
        ${k('expense', 'c-warn', 'Dépenses', money(sum.expenses))}
        ${k('box', sum.lowStock ? 'c-bad' : 'c-ok', 'Stock', money(sum.stockValue), `${sum.products} produits · ${sum.lowStock} en alerte`)}
      </div>
      <div class="dash-grid">
        <div class="card"><div class="card-h"><h3>Ventes et achats des 30 derniers jours</h3><div class="spacer"></div>
          <div class="legend"><span><i style="background:var(--brand)"></i>Ventes</span><span><i style="background:#2563a8"></i>Achats</span></div></div>
          <div class="card-b">${chartSvg(daily)}</div></div>
        <div class="card"><div class="card-h"><h3>Meilleurs produits</h3></div><div class="card-b">
          ${top.length ? top.map((t, i) => `<div class="list-row"><span class="tag mute">${i + 1}</span><span class="grow">${esc(t.name)}<div class="muted" style="font-size:12px;color:var(--ink-3)">${qtyf(t.qty)} vendu(s)</div></span><b class="num">${money(t.amount)}</b></div>`).join('') : '<div class="empty">Aucune vente sur la période</div>'}
        </div></div>
      </div>
      <div class="dash-grid">
        <div class="card"><div class="card-h"><h3>Dernières ventes</h3><div class="spacer"></div><a class="btn sm" href="#/sales">Tout voir</a></div>
          <table class="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Client</th><th class="num">Total</th><th>Statut</th></tr></thead><tbody>
          ${recent.slice(0, 7).map((s) => `<tr class="click" data-sale="${s.id}"><td>${esc(s.ref)}</td><td class="muted">${fdate(s.date)}</td><td>${esc(s.client || 'Client comptoir')}</td><td class="num">${money(s.total - s.returned)}</td><td>${statusTag(s)}</td></tr>`).join('') || emptyRow(5, 'Aucune vente pour le moment', 'Ouvrez la caisse pour enregistrer votre première vente.')}
          </tbody></table></div>
        <div class="card"><div class="card-h"><h3>Alertes de stock</h3><div class="spacer"></div><a class="btn sm" href="#/products">Produits</a></div><div class="card-b">
          ${low.length ? low.slice(0, 8).map((p) => `<div class="list-row"><span class="grow">${esc(p.name)}</span><span class="tag ${p.stock <= 0 ? 'bad' : 'warn'}">${qtyf(p.stock)} ${esc(p.unit || '')}</span></div>`).join('') : '<div class="empty">Tous les stocks sont suffisants 👍</div>'}
        </div></div>
      </div>`;
    $$('[data-sale]', c).forEach((r) => r.addEventListener('click', () => saleDetail(Number(r.dataset.sale), draw)));
    bindChartTips(c, daily);
  };
  $('#d-period').addEventListener('change', draw);
  await draw();
};

function chartSvg(data) {
  const W = 720, H = 260, L = 64, R = 10, T = 12, B = 30;
  const max = Math.max(1, ...data.map((d) => Math.max(d.sales, d.purchases)));
  const step = niceStep(max / 4);
  const top = Math.ceil(max / step) * step;
  const iw = W - L - R, ih = H - T - B, bw = iw / data.length;
  const y = (v) => T + ih - (v / top) * ih;
  let g = '';
  for (let v = 0; v <= top + 0.001; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${compact(v)}</text>`;
  const bars = data.map((d, i) => { const h = ih * d.sales / top; return `<rect x="${L + i * bw + bw * 0.18}" y="${T + ih - h}" width="${bw * 0.64}" height="${Math.max(h, d.sales ? 1 : 0)}" rx="3" fill="var(--brand)"/>`; }).join('');
  const pts = data.map((d, i) => `${L + i * bw + bw / 2},${y(d.purchases)}`).join(' ');
  const labels = data.map((d, i) => (i % 5 === 0 || i === data.length - 1) ? `<text x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${d.date.slice(8)}/${d.date.slice(5, 7)}</text>` : '').join('');
  const hits = data.map((d, i) => `<rect class="hit" data-i="${i}" x="${L + i * bw}" y="${T}" width="${bw}" height="${ih}" fill="transparent"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g class="grid">${g}</g>${bars}
    <polyline points="${pts}" fill="none" stroke="#2563a8" stroke-width="2" stroke-linejoin="round"/>${labels}${hits}</svg>`;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); const n = raw / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function compact(v) { if (v >= 1e6) return `${nf2.format(v / 1e6)} M`; if (v >= 1e3) return `${nf2.format(v / 1e3)} k`; return nf.format(v); }
function bindChartTips(root, data) {
  let tip = $('.chart-tip');
  if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.style.display = 'none'; document.body.appendChild(tip); }
  $$('.hit', root).forEach((h) => {
    h.addEventListener('mousemove', (e) => {
      const d = data[Number(h.dataset.i)];
      tip.innerHTML = `<b>${fdate(d.date, false)}</b><br>Ventes : ${money(d.sales)}<br>Achats : ${money(d.purchases)}`;
      tip.style.display = 'block'; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY - 10}px`;
    });
    h.addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  });
}

// ======================================================================
// CAISSE (POS)
// ======================================================================
VIEWS.pos = async (c) => {
  setPage('Caisse', 'Vente rapide au comptoir', `<a class="btn" href="#/sales">Historique des ventes</a>`);
  const [products, cats, clients] = await Promise.all([API.call('products.list'), API.call('categories.list'), API.call('contacts.list', { type: 'client' })]);
  const cart = [];
  let cat = null;
  c.innerHTML = `<div class="pos">
    <div class="pos-left">
      <div class="toolbar" style="margin-bottom:10px"><input class="input search" id="p-search" placeholder="Rechercher ou scanner un code-barres…" style="flex:1"></div>
      <div class="pos-cats" id="p-cats"></div>
      <div class="pos-grid" id="p-grid"></div>
    </div>
    <div class="card cart">
      <div class="card-h"><h3>Panier</h3><div class="spacer"></div><button class="btn sm ghost" id="c-clear">Vider</button></div>
      <div style="padding:10px 16px;border-bottom:1px solid var(--line)"><select class="input" id="c-client" style="width:100%"><option value="">Client comptoir</option>${clients.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>
      <div class="cart-lines" id="c-lines"></div>
      <div class="cart-foot">
        <div class="trow"><span>Sous-total</span><b class="num" id="c-sub">0</b></div>
        <div class="trow"><span>Remise</span><input class="input" type="number" min="0" id="c-disc" value="0"></div>
        <div class="trow big"><span>Total</span><span class="num" id="c-total">0</span></div>
        <button class="btn primary lg" id="c-pay" disabled>${icon('cash')} Encaisser</button>
      </div>
    </div></div>`;

  const drawCats = () => {
    $('#p-cats').innerHTML = `<button class="chip ${!cat ? 'on' : ''}" data-cat="">Tous</button>` + cats.map((x) => `<button class="chip ${cat === x.id ? 'on' : ''}" data-cat="${x.id}">${esc(x.name)}</button>`).join('');
    $$('#p-cats .chip').forEach((b) => b.addEventListener('click', () => { cat = b.dataset.cat ? Number(b.dataset.cat) : null; drawCats(); drawGrid(); }));
  };
  const drawGrid = () => {
    const s = $('#p-search').value.trim().toLowerCase();
    const list = products.filter((p) => (!cat || p.category_id === cat) && (!s || p.name.toLowerCase().includes(s) || (p.code || '').toLowerCase().includes(s)));
    $('#p-grid').innerHTML = list.map((p) => `<button class="pcard ${p.stock <= 0 ? 'out' : ''}" data-id="${p.id}">
      <span class="pc-init">${esc(p.name.slice(0, 1).toUpperCase())}</span><span class="pc-name">${esc(p.name)}</span>
      <span class="pc-stock">Stock : ${qtyf(p.stock)} ${esc(p.unit || '')}</span><span class="pc-price">${money(p.sale_price)}</span></button>`).join('') ||
      `<div class="empty" style="grid-column:1/-1"><b>Aucun produit</b>${products.length ? 'Modifiez votre recherche.' : 'Ajoutez vos produits dans « Produits » pour commencer.'}</div>`;
    $$('#p-grid .pcard').forEach((b) => b.addEventListener('click', () => add(Number(b.dataset.id))));
  };
  const add = (id) => {
    const p = products.find((x) => x.id === id);
    if (!p) return;
    const line = cart.find((l) => l.product_id === id);
    const inCart = line ? line.qty : 0;
    if (inCart + 1 > p.stock) return toast(`Stock insuffisant pour « ${p.name} »`, 'err');
    if (line) line.qty += 1; else cart.push({ product_id: id, name: p.name, qty: 1, price: p.sale_price, stock: p.stock });
    drawCart();
  };
  const totals = () => {
    const sub = cart.reduce((a, l) => a + l.qty * l.price, 0);
    const disc = Math.min(Number($('#c-disc').value) || 0, sub);
    return { sub, disc, total: sub - disc };
  };
  const drawTotals = () => {
    const t = totals();
    $('#c-sub').textContent = money(t.sub);
    $('#c-total').textContent = money(t.total);
    $('#c-pay').disabled = !cart.length;
  };
  const drawCart = () => {
    $('#c-lines').innerHTML = cart.length ? cart.map((l, i) => `<div class="cline"><span class="cl-name">${esc(l.name)}</span><span class="cl-total">${money(l.qty * l.price)}</span>
      <div class="cl-ctrl"><div class="qty"><button data-dec="${i}">−</button><input data-q="${i}" value="${l.qty}"><button data-inc="${i}">+</button></div>
      <span class="muted" style="color:var(--ink-3)">×</span><input class="input price-in" data-p="${i}" type="number" value="${l.price}" ${isAdmin() ? '' : 'readonly title="Seul l\'administrateur peut modifier le prix"'}>
      <div style="flex:1"></div><button class="btn sm ghost" data-del="${i}" title="Retirer">✕</button></div></div>`).join('')
      : '<div class="empty"><b>Panier vide</b>Touchez un produit pour l\'ajouter.</div>';
    $$('[data-inc]').forEach((b) => b.addEventListener('click', () => { const l = cart[b.dataset.inc]; if (l.qty + 1 > l.stock) return toast('Stock insuffisant', 'err'); l.qty++; drawCart(); }));
    $$('[data-dec]').forEach((b) => b.addEventListener('click', () => { const l = cart[b.dataset.dec]; l.qty--; if (l.qty <= 0) cart.splice(b.dataset.dec, 1); drawCart(); }));
    $$('[data-del]').forEach((b) => b.addEventListener('click', () => { cart.splice(b.dataset.del, 1); drawCart(); }));
    $$('[data-q]').forEach((inp) => inp.addEventListener('change', () => { const l = cart[inp.dataset.q]; const v = Number(inp.value.replace(',', '.')) || 0; if (v > l.stock) toast('Stock insuffisant', 'err'); l.qty = Math.min(Math.max(v, 0), l.stock); if (!l.qty) cart.splice(inp.dataset.q, 1); drawCart(); }));
    $$('[data-p]').forEach((inp) => inp.addEventListener('change', () => { cart[inp.dataset.p].price = Math.max(0, Number(inp.value) || 0); drawCart(); }));
    drawTotals();
  };
  $('#p-search').addEventListener('input', drawGrid);
  $('#p-search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value.trim().toLowerCase();
    const exact = products.find((p) => (p.code || '').toLowerCase() === v);
    const list = $$('#p-grid .pcard:not(.out)');
    if (exact) add(exact.id); else if (list.length === 1) add(Number(list[0].dataset.id)); else return;
    e.target.value = ''; drawGrid();
  });
  $('#c-disc').addEventListener('input', drawTotals);
  $('#c-clear').addEventListener('click', () => { cart.length = 0; $('#c-disc').value = 0; drawCart(); });
  $('#c-pay').addEventListener('click', () => {
    const t = totals();
    modal({
      title: 'Encaissement',
      body: `<div class="trow big" style="margin-bottom:16px"><span>À payer</span><span class="num">${money(t.total)}</span></div>
        <div class="grid-form"><div class="field"><label>Mode de paiement</label><select class="input" name="method">${payOptions()}</select></div>
        <div class="field"><label>Montant reçu</label><input class="input" type="number" name="received" value="${t.total}" min="0"></div>
        <div class="field full"><div class="trow" style="font-size:16px"><span>Monnaie à rendre</span><b id="m-change" class="num">${money(0)}</b></div>
        <div class="muted" id="m-credit" style="color:var(--warn);margin-top:4px"></div></div>
        <label class="full" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="print" checked> Imprimer le ticket</label></div>`,
      foot: '<button class="btn" data-close>Annuler</button><button class="btn primary lg" id="m-ok">Valider la vente</button>',
      onMount: (el, close) => {
        const upd = () => {
          const r = Number($('[name=received]', el).value) || 0;
          $('#m-change').textContent = money(Math.max(0, r - t.total));
          $('#m-credit').textContent = r < t.total ? `Reste dû : ${money(t.total - r)} (vente à crédit${$('#c-client').value ? '' : ' — choisissez un client'})` : '';
        };
        $('[name=received]', el).addEventListener('input', upd);
        $('[name=received]', el).select();
        $('#m-ok', el).addEventListener('click', async () => {
          const f = formData(el);
          const received = Number(f.received) || 0;
          if (received < t.total && !$('#c-client').value) return toast('Pour une vente à crédit, choisissez d\'abord un client.', 'err');
          const sale = await run(() => API.call('sales.create', {
            client_id: Number($('#c-client').value) || null, items: cart.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price })),
            discount: t.disc, paid: Math.min(received, t.total), method: f.method, source: 'pos',
          }), 'Vente enregistrée');
          close();
          if (f.print) printDoc({ ...sale, received }, 'vente');
          route();
        });
      },
    });
  });
  drawCats(); drawGrid(); drawCart();
  $('#p-search').focus();
};

// ======================================================================
// VENTES
// ======================================================================
VIEWS.sales = async (c, params) => {
  if (params[0] === 'new') return docEditor(c, 'vente');
  setPage('Ventes', '', `<a class="btn" href="#/pos">${icon('pos')} Caisse</a><a class="btn primary" href="#/sales/new">${icon('plus')} Nouvelle facture</a>`);
  c.innerHTML = `<div class="toolbar"><input class="input search" id="f-s" placeholder="Réf. ou client…">
    <div class="field" style="flex-direction:row;align-items:center"><label>Du</label><input class="input" type="date" id="f-from" value="${daysAgo(29)}"></div>
    <div class="field" style="flex-direction:row;align-items:center"><label>au</label><input class="input" type="date" id="f-to" value="${today()}"></div>
    <select class="input" id="f-st"><option value="">Tous les statuts</option><option value="payee">Payées</option><option value="partielle">Partielles</option><option value="impayee">Impayées</option><option value="annulee">Annulées</option></select>
    <div class="spacer"></div><button class="btn" id="f-csv">Exporter (Excel)</button></div>
    <div class="card"><table class="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Client</th><th>Vendeur</th><th class="num">Total</th><th class="num">Payé</th><th class="num">Reste</th><th>Statut</th></tr></thead><tbody id="t-body"></tbody></table></div>
    <div id="t-foot" style="margin-top:10px;color:var(--ink-2)"></div>`;
  let rows = [];
  const load = async () => {
    rows = await API.call('sales.list', { search: $('#f-s').value, from: $('#f-from').value, to: $('#f-to').value, status: $('#f-st').value || null });
    $('#t-body').innerHTML = rows.map((s) => `<tr class="click" data-id="${s.id}"><td><b>${esc(s.ref)}</b> ${s.source === 'pos' ? '<span class="tag mute">POS</span>' : ''}</td><td class="muted">${fdate(s.date)}</td>
      <td>${esc(s.client || 'Client comptoir')}</td><td class="muted">${esc(s.user || '')}</td><td class="num">${money(s.total - s.returned)}</td><td class="num">${money(s.paid)}</td>
      <td class="num">${s.cancelled ? '—' : money(s.total - s.returned - s.paid)}</td><td>${statusTag(s)}</td></tr>`).join('') || emptyRow(8, 'Aucune vente trouvée', 'Changez les filtres ou la période.');
    const ok = rows.filter((r) => !r.cancelled);
    $('#t-foot').innerHTML = `${ok.length} vente(s) · Total <b>${money(ok.reduce((a, r) => a + r.total - r.returned, 0))}</b> · Reste à encaisser <b>${money(ok.reduce((a, r) => a + r.total - r.returned - r.paid, 0))}</b>`;
    $$('#t-body tr[data-id]').forEach((r) => r.addEventListener('click', () => saleDetail(Number(r.dataset.id), load)));
  };
  ['#f-from', '#f-to', '#f-st'].forEach((s) => $(s).addEventListener('change', load));
  $('#f-s').addEventListener('input', debounce(load));
  $('#f-csv').addEventListener('click', () => exportCsv('ventes', ['Référence', 'Date', 'Client', 'Vendeur', 'Total', 'Payé', 'Reste', 'Statut'],
    rows.map((s) => [s.ref, s.date, s.client || 'Client comptoir', s.user, s.total - s.returned, s.paid, s.total - s.returned - s.paid, s.cancelled ? 'Annulée' : s.status])));
  await load();
};

async function saleDetail(id, onChange) {
  const s = await API.call('sales.get', { id });
  docDetailModal(s, 'vente', onChange);
}
async function purchaseDetail(id, onChange) {
  const p = await API.call('purchases.get', { id });
  docDetailModal(p, 'achat', onChange);
}

function docDetailModal(d, kind, onChange) {
  const isSale = kind === 'vente';
  const due = d.total - d.returned - d.paid;
  modal({
    title: `${isSale ? 'Vente' : 'Achat'} ${d.ref}`, wide: true,
    body: `<div style="display:flex;gap:30px;flex-wrap:wrap">
      <dl class="kv"><dt>Date</dt><dd>${fdate(d.date)}</dd><dt>${isSale ? 'Client' : 'Fournisseur'}</dt><dd>${esc((isSale ? d.client : d.supplier) || (isSale ? 'Client comptoir' : '—'))}</dd>
      <dt>Saisi par</dt><dd>${esc(d.user || '')}</dd><dt>Statut</dt><dd>${statusTag(d)}</dd>${d.note ? `<dt>Note</dt><dd>${esc(d.note)}</dd>` : ''}</dl>
      <div class="summary-box">${isSale && d.discount ? `<div class="trow"><span>Sous-total</span><span class="num">${money(d.subtotal)}</span></div><div class="trow"><span>Remise</span><span class="num">-${money(d.discount)}</span></div>` : ''}
        <div class="trow"><b>Total</b><b class="num">${money(d.total)}</b></div>${d.returned ? `<div class="trow"><span>Retours</span><span class="num">-${money(d.returned)}</span></div>` : ''}
        <div class="trow"><span>Payé</span><span class="num">${money(d.paid)}</span></div><div class="trow" style="font-size:16px"><b>Reste à payer</b><b class="num" style="color:${due > 0.5 && !d.cancelled ? 'var(--bad)' : 'inherit'}">${money(d.cancelled ? 0 : due)}</b></div></div></div>
      <div class="section-title">Articles</div>
      <div class="card"><table class="tbl"><thead><tr><th>Produit</th><th class="num">Qté</th><th class="num">${isSale ? 'Prix' : 'Coût'}</th><th class="num">Montant</th><th class="num">Retourné</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${qtyf(i.qty)}</td><td class="num">${money(isSale ? i.price : i.cost)}</td><td class="num">${money(i.qty * (isSale ? i.price : i.cost))}</td><td class="num">${i.returned_qty ? qtyf(i.returned_qty) : '—'}</td></tr>`).join('')}</tbody></table></div>
      ${d.payments.length ? `<div class="section-title">Paiements</div><div class="card"><table class="tbl"><tbody>${d.payments.map((p) => `<tr><td class="muted">${fdate(p.date)}</td><td>${esc(p.method || '')}</td><td class="num">${money(p.amount)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${d.returns.length ? `<div class="section-title">Retours</div><div class="card"><table class="tbl"><tbody>${d.returns.map((r) => `<tr><td class="muted">${fdate(r.date)}</td><td>${esc(r.note || 'Retour')}</td><td class="num">${money(r.total)}</td></tr>`).join('')}</tbody></table></div>` : ''}`,
    foot: `<div class="left">${isAdmin() && !d.cancelled ? `<button class="btn danger" id="x-cancel">Annuler ${isSale ? 'la vente' : 'l\'achat'}</button>` : ''}</div>
      ${!d.cancelled ? `<button class="btn" id="x-ret">${icon('undo')} Retour</button>` : ''}
      ${isSale ? `<button class="btn" id="x-tk">${icon('print')} Ticket</button>` : ''}<button class="btn" id="x-pr">${icon('print')} ${isSale ? 'Facture A4' : 'Imprimer'}</button>
      ${!d.cancelled && due > 0.5 ? `<button class="btn primary" id="x-pay">${icon('cash')} Enregistrer un paiement</button>` : ''}`,
    onMount: (el, close) => {
      const reopen = async () => { close(); onChange && onChange(); isSale ? saleDetail(d.id, onChange) : purchaseDetail(d.id, onChange); };
      $('#x-pr', el).addEventListener('click', () => printDoc(d, kind, 'a4'));
      if ($('#x-tk', el)) $('#x-tk', el).addEventListener('click', () => printDoc(d, kind, 'ticket'));
      if ($('#x-pay', el)) $('#x-pay', el).addEventListener('click', () => modal({
        title: 'Enregistrer un paiement',
        body: `<div class="grid-form"><div class="field"><label>Montant (reste : ${money(due)})</label><input class="input" type="number" name="amount" value="${Math.round(due * 100) / 100}" min="0"></div>
          <div class="field"><label>Mode</label><select class="input" name="method">${payOptions()}</select></div></div>`,
        foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" id="p-ok">Valider</button>',
        onMount: (el2, close2) => $('#p-ok', el2).addEventListener('click', async () => {
          await run(() => API.call(isSale ? 'sales.pay' : 'purchases.pay', { id: d.id, ...formData(el2) }), 'Paiement enregistré');
          close2(); reopen();
        }),
      }));
      if ($('#x-ret', el)) $('#x-ret', el).addEventListener('click', () => modal({
        title: `Retour ${isSale ? 'client' : 'fournisseur'}`,
        body: `<p class="muted" style="margin-top:0;color:var(--ink-2)">Indiquez les quantités ${isSale ? 'rapportées par le client (elles reviennent en stock)' : 'renvoyées au fournisseur (elles sortent du stock)'}.</p>
          <table class="tbl"><thead><tr><th>Produit</th><th class="num">Possible</th><th class="num">Qté retournée</th></tr></thead><tbody>
          ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="num">${qtyf(i.qty - i.returned_qty)}</td><td class="num"><input class="input" style="width:90px;text-align:right" type="number" min="0" max="${i.qty - i.returned_qty}" data-item="${i.id}" value="0"></td></tr>`).join('')}</tbody></table>
          <div class="field" style="margin-top:12px"><label>Motif</label><input class="input" name="note" placeholder="Ex. : produit défectueux"></div>`,
        foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" id="r-ok">Valider le retour</button>',
        onMount: (el2, close2) => $('#r-ok', el2).addEventListener('click', async () => {
          const items = $$('[data-item]', el2).map((i) => ({ item_id: Number(i.dataset.item), qty: Number(i.value) || 0 })).filter((i) => i.qty > 0);
          await run(() => API.call(isSale ? 'sales.return' : 'purchases.return', { id: d.id, items, note: $('[name=note]', el2).value }), 'Retour enregistré');
          close2(); reopen();
        }),
      }));
      if ($('#x-cancel', el)) $('#x-cancel', el).addEventListener('click', async () => {
        if (!(await confirmBox(`Annuler ${d.ref} ? Le stock sera remis comme avant. Cette action est définitive.`, 'Oui, annuler'))) return;
        await run(() => API.call(isSale ? 'sales.cancel' : 'purchases.cancel', { id: d.id }), 'Document annulé');
        close(); onChange && onChange();
      });
    },
  });
}

// Éditeur de facture de vente / bon d'achat
async function docEditor(c, kind) {
  const isSale = kind === 'vente';
  setPage(isSale ? 'Nouvelle facture' : 'Nouvel achat', isSale ? 'Vente avec client, à crédit ou payée' : 'Réception de marchandise : le stock augmente',
    `<a class="btn" href="#/${isSale ? 'sales' : 'purchases'}">Retour à la liste</a>`);
  const [products, partners] = await Promise.all([API.call('products.list'), API.call('contacts.list', { type: isSale ? 'client' : 'fournisseur' })]);
  const lines = [];
  c.innerHTML = `<div class="card" style="margin-bottom:16px"><div class="card-b grid-form" style="grid-template-columns:2fr 1fr 2fr">
      <div class="field"><label>${isSale ? 'Client' : 'Fournisseur'}</label><div style="display:flex;gap:8px"><select class="input" id="e-partner" style="flex:1"><option value="">${isSale ? 'Client comptoir' : '— Choisir —'}</option>${partners.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
        <button class="btn" id="e-newp" title="Nouveau">${icon('plus')}</button></div></div>
      <div class="field"><label>Date</label><input class="input" type="date" id="e-date" value="${today()}"></div>
      <div class="field"><label>Note</label><input class="input" id="e-note" placeholder="Facultatif"></div></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-h"><h3>Articles</h3></div>
      <div class="card-b" style="padding-bottom:6px"><div class="picker"><input class="input search" id="e-pick" placeholder="Rechercher un produit par nom ou code puis Entrée…" style="width:100%"><div class="picker-list" id="e-list" hidden></div></div></div>
      <table class="tbl doc-lines"><thead><tr><th>Produit</th><th class="num">Stock</th><th class="num" style="width:120px">Quantité</th><th class="num" style="width:150px">${isSale ? 'Prix unitaire' : 'Coût unitaire'}</th><th class="num">Montant</th><th></th></tr></thead><tbody id="e-lines"></tbody></table></div>
    <div style="display:flex;gap:16px;align-items:flex-start"><div style="flex:1"></div>
      <div class="card summary-box" style="padding:16px">
        ${isSale ? '<div class="trow"><span>Sous-total</span><span class="num" id="e-sub">0</span></div><div class="trow"><span>Remise</span><input class="input" type="number" id="e-disc" value="0" min="0"></div>' : ''}
        <div class="trow big"><span>Total</span><span class="num" id="e-total">0</span></div>
        <div class="trow"><span>Montant payé</span><input class="input" type="number" id="e-paid" value="0" min="0"></div>
        <div class="trow"><span>Mode</span><select class="input" id="e-method" style="width:150px">${payOptions()}</select></div>
        <div style="display:flex;gap:8px"><button class="btn" id="e-full" style="flex:1">Tout payé</button><button class="btn primary" id="e-save" style="flex:2">Enregistrer</button></div>
      </div></div>`;

  const sub = () => lines.reduce((a, l) => a + l.qty * l.price, 0);
  const total = () => sub() - (isSale ? Math.min(Number($('#e-disc').value) || 0, sub()) : 0);
  const drawTot = () => { if (isSale) $('#e-sub').textContent = money(sub()); $('#e-total').textContent = money(total()); };
  const draw = () => {
    $('#e-lines').innerHTML = lines.map((l, i) => `<tr><td><b>${esc(l.name)}</b></td><td class="num muted">${qtyf(l.stock)}</td>
      <td class="num"><input class="input" type="number" min="0" data-q="${i}" value="${l.qty}" style="width:100px;text-align:right"></td>
      <td class="num"><input class="input" type="number" min="0" data-p="${i}" value="${l.price}" style="width:130px;text-align:right"></td>
      <td class="num" id="e-amt-${i}">${money(l.qty * l.price)}</td><td><button class="btn sm ghost" data-del="${i}">✕</button></td></tr>`).join('') || emptyRow(6, 'Aucun article', 'Recherchez un produit ci-dessus pour l\'ajouter.');
    $$('[data-q]').forEach((x) => x.addEventListener('input', () => { lines[x.dataset.q].qty = Number(x.value) || 0; $(`#e-amt-${x.dataset.q}`).textContent = money(lines[x.dataset.q].qty * lines[x.dataset.q].price); drawTot(); }));
    $$('[data-p]').forEach((x) => x.addEventListener('input', () => { lines[x.dataset.p].price = Number(x.value) || 0; $(`#e-amt-${x.dataset.p}`).textContent = money(lines[x.dataset.p].qty * lines[x.dataset.p].price); drawTot(); }));
    $$('[data-del]').forEach((x) => x.addEventListener('click', () => { lines.splice(x.dataset.del, 1); draw(); }));
    drawTot();
  };
  const addLine = (p) => {
    const ex = lines.find((l) => l.product_id === p.id);
    if (ex) ex.qty += 1; else lines.push({ product_id: p.id, name: p.name, stock: p.stock, qty: 1, price: isSale ? p.sale_price : p.cost_price });
    draw();
  };
  productPicker($('#e-pick'), $('#e-list'), products, addLine, isSale);
  if (isSale) $('#e-disc').addEventListener('input', drawTot);
  $('#e-full').addEventListener('click', () => { $('#e-paid').value = Math.round(total() * 100) / 100; });
  $('#e-newp').addEventListener('click', () => contactForm({ type: isSale ? 'client' : 'fournisseur' }, async (id) => {
    const list = await API.call('contacts.list', { type: isSale ? 'client' : 'fournisseur' });
    $('#e-partner').innerHTML = `<option value="">${isSale ? 'Client comptoir' : '— Choisir —'}</option>` + list.map((p) => `<option value="${p.id}" ${p.id === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  }));
  $('#e-save').addEventListener('click', async () => {
    const partner = Number($('#e-partner').value) || null;
    const paid = Number($('#e-paid').value) || 0;
    if (isSale && !partner && paid < total() - 0.5) return toast('Une vente non payée en totalité doit avoir un client.', 'err');
    const date = $('#e-date').value === today() ? null : `${$('#e-date').value} 12:00:00`;
    const common = { paid, method: $('#e-method').value, note: $('#e-note').value, date };
    const doc = isSale
      ? await run(() => API.call('sales.create', { ...common, client_id: partner, discount: Number($('#e-disc').value) || 0, items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, price: l.price })) }), 'Facture enregistrée')
      : await run(() => API.call('purchases.create', { ...common, supplier_id: partner, items: lines.map((l) => ({ product_id: l.product_id, qty: l.qty, cost: l.price })) }), 'Achat enregistré');
    go(isSale ? 'sales' : 'purchases');
    setTimeout(() => (isSale ? saleDetail : purchaseDetail)(doc.id), 150);
  });
  draw();
  $('#e-pick').focus();
}

function productPicker(input, list, products, onPick, checkStock) {
  let hl = 0, res = [];
  const show = () => {
    const s = input.value.trim().toLowerCase();
    if (!s) { list.hidden = true; return; }
    res = products.filter((p) => p.name.toLowerCase().includes(s) || (p.code || '').toLowerCase() === s).slice(0, 12);
    hl = 0;
    list.innerHTML = res.map((p, i) => `<div data-i="${i}" class="${i === 0 ? 'hl' : ''}"><span>${esc(p.name)} <span style="color:var(--ink-3)">${esc(p.code || '')}</span></span><span style="color:var(--ink-3)">stock ${qtyf(p.stock)} · ${money(checkStock ? p.sale_price : p.cost_price)}</span></div>`).join('') || '<div style="color:var(--ink-3)">Aucun produit</div>';
    list.hidden = false;
    $$('[data-i]', list).forEach((d) => d.addEventListener('mousedown', (e) => { e.preventDefault(); pick(res[d.dataset.i]); }));
  };
  const pick = (p) => { if (!p) return; onPick(p); input.value = ''; list.hidden = true; input.focus(); };
  input.addEventListener('input', show);
  input.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); hl = Math.max(0, Math.min(res.length - 1, hl + (e.key === 'ArrowDown' ? 1 : -1)));
      $$('[data-i]', list).forEach((d, i) => d.classList.toggle('hl', i === hl));
    } else if (e.key === 'Enter') { e.preventDefault(); pick(res[hl]); }
  });
}

// ======================================================================
// ACHATS
// ======================================================================
VIEWS.purchases = async (c, params) => {
  if (params[0] === 'new') return docEditor(c, 'achat');
  setPage('Achats', 'Approvisionnement auprès des fournisseurs', `<a class="btn primary" href="#/purchases/new">${icon('plus')} Nouvel achat</a>`);
  c.innerHTML = `<div class="toolbar"><input class="input search" id="f-s" placeholder="Réf. ou fournisseur…">
    <div class="field" style="flex-direction:row;align-items:center"><label>Du</label><input class="input" type="date" id="f-from" value="${daysAgo(89)}"></div>
    <div class="field" style="flex-direction:row;align-items:center"><label>au</label><input class="input" type="date" id="f-to" value="${today()}"></div>
    <select class="input" id="f-st"><option value="">Tous les statuts</option><option value="payee">Payés</option><option value="partielle">Partiels</option><option value="impayee">Impayés</option><option value="annulee">Annulés</option></select></div>
    <div class="card"><table class="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Fournisseur</th><th class="num">Total</th><th class="num">Payé</th><th class="num">Reste</th><th>Statut</th></tr></thead><tbody id="t-body"></tbody></table></div>
    <div id="t-foot" style="margin-top:10px;color:var(--ink-2)"></div>`;
  const load = async () => {
    const rows = await API.call('purchases.list', { search: $('#f-s').value, from: $('#f-from').value, to: $('#f-to').value, status: $('#f-st').value || null });
    $('#t-body').innerHTML = rows.map((p) => `<tr class="click" data-id="${p.id}"><td><b>${esc(p.ref)}</b></td><td class="muted">${fdate(p.date)}</td><td>${esc(p.supplier || '—')}</td>
      <td class="num">${money(p.total - p.returned)}</td><td class="num">${money(p.paid)}</td><td class="num">${p.cancelled ? '—' : money(p.total - p.returned - p.paid)}</td><td>${statusTag(p)}</td></tr>`).join('') || emptyRow(7, 'Aucun achat trouvé', 'Enregistrez un achat pour faire entrer de la marchandise en stock.');
    const ok = rows.filter((r) => !r.cancelled);
    $('#t-foot').innerHTML = `${ok.length} achat(s) · Total <b>${money(ok.reduce((a, r) => a + r.total - r.returned, 0))}</b> · Reste à payer <b>${money(ok.reduce((a, r) => a + r.total - r.returned - r.paid, 0))}</b>`;
    $$('#t-body tr[data-id]').forEach((r) => r.addEventListener('click', () => purchaseDetail(Number(r.dataset.id), load)));
  };
  ['#f-from', '#f-to', '#f-st'].forEach((s) => $(s).addEventListener('change', load));
  $('#f-s').addEventListener('input', debounce(load));
  await load();
};

// ======================================================================
// PRODUITS
// ======================================================================
VIEWS.products = async (c) => {
  setPage('Produits', '', `<button class="btn" id="a-cats">Catégories</button><button class="btn primary" id="a-new">${icon('plus')} Nouveau produit</button>`);
  let cats = await API.call('categories.list');
  c.innerHTML = `<div class="toolbar"><input class="input search" id="f-s" placeholder="Nom ou code…">
    <select class="input" id="f-cat"><option value="">Toutes les catégories</option>${cats.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="f-low"> Stock en alerte seulement</label><div class="spacer"></div><span id="f-count" class="muted" style="color:var(--ink-3)"></span></div>
    <div class="card"><table class="tbl"><thead><tr><th>Code</th><th>Produit</th><th>Catégorie</th><th class="num">Prix d'achat</th><th class="num">Prix de vente</th><th class="num">Marge</th><th class="num">Stock</th><th></th></tr></thead><tbody id="t-body"></tbody></table></div>`;
  const load = async () => {
    const rows = await API.call('products.list', { search: $('#f-s').value, category_id: Number($('#f-cat').value) || null, lowOnly: $('#f-low').checked });
    $('#f-count').textContent = `${rows.length} produit(s)`;
    $('#t-body').innerHTML = rows.map((p) => `<tr class="click" data-id="${p.id}"><td class="muted">${esc(p.code || '')}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category || '')}</td>
      <td class="num">${money(p.cost_price)}</td><td class="num">${money(p.sale_price)}</td><td class="num muted">${p.sale_price ? Math.round((p.sale_price - p.cost_price) / p.sale_price * 100) + ' %' : '—'}</td>
      <td class="num"><span class="tag ${p.stock <= 0 ? 'bad' : p.stock <= p.alert_qty ? 'warn' : 'ok'}">${qtyf(p.stock)} ${esc(p.unit || '')}</span></td>
      <td class="num"><button class="btn sm" data-adj="${p.id}">Ajuster</button></td></tr>`).join('') || emptyRow(8, 'Aucun produit', 'Cliquez sur « Nouveau produit » pour créer votre catalogue.');
    $$('#t-body tr[data-id]').forEach((r) => r.addEventListener('click', (e) => { if (e.target.closest('[data-adj]')) return; productForm(rows.find((p) => p.id === Number(r.dataset.id)), cats, load); }));
    $$('[data-adj]').forEach((b) => b.addEventListener('click', () => adjustForm(rows.find((p) => p.id === Number(b.dataset.adj)), load)));
  };
  $('#f-s').addEventListener('input', debounce(load));
  $('#f-cat').addEventListener('change', load);
  $('#f-low').addEventListener('change', load);
  $('#a-new').addEventListener('click', () => productForm({}, cats, load));
  $('#a-cats').addEventListener('click', () => categoriesManager(async () => { cats = await API.call('categories.list'); route(); }));
  await load();
};

function productForm(p, cats, onSave) {
  const isNew = !p.id;
  modal({
    title: isNew ? 'Nouveau produit' : `Modifier — ${p.name}`,
    body: `<form class="grid-form" id="pf">
      <div class="field full"><label>Nom du produit *</label><input class="input" name="name" value="${esc(p.name || '')}" required></div>
      <div class="field"><label>Code / code-barres</label><input class="input" name="code" value="${esc(p.code || '')}" placeholder="Facultatif"></div>
      <div class="field"><label>Catégorie</label><select class="input" name="category_id"><option value="">—</option>${cats.map((x) => `<option value="${x.id}" ${x.id === p.category_id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Prix d'achat</label><input class="input" type="number" min="0" name="cost_price" value="${p.cost_price ?? 0}"></div>
      <div class="field"><label>Prix de vente *</label><input class="input" type="number" min="0" name="sale_price" value="${p.sale_price ?? 0}"></div>
      <div class="field"><label>Unité</label><input class="input" name="unit" value="${esc(p.unit || 'pièce')}" list="units"><datalist id="units"><option>pièce</option><option>kg</option><option>litre</option><option>carton</option><option>sac</option><option>paquet</option><option>mètre</option></datalist></div>
      <div class="field"><label>Alerte si stock ≤</label><input class="input" type="number" min="0" name="alert_qty" value="${p.alert_qty ?? 5}"></div>
      ${isNew ? '<div class="field"><label>Stock de départ</label><input class="input" type="number" name="stock" value="0"></div>' : `<div class="field"><label>Stock actuel</label><input class="input" value="${qtyf(p.stock)} (utilisez « Ajuster »)" disabled></div>`}
    </form>${isNew ? '' : '<div class="section-title">Derniers mouvements</div><div id="pf-moves" class="card"></div>'}`,
    foot: `<div class="left">${!isNew && isAdmin() ? '<button class="btn danger" id="pf-del">Supprimer</button>' : ''}</div><button class="btn" data-close>Annuler</button><button class="btn primary" id="pf-ok">Enregistrer</button>`,
    onMount: async (el, close) => {
      $('#pf-ok', el).addEventListener('click', async () => {
        const f = formData($('#pf', el));
        f.category_id = Number(f.category_id) || null;
        await run(() => API.call('products.save', { ...f, id: p.id }), 'Produit enregistré');
        close(); onSave();
      });
      $('#pf', el).addEventListener('submit', (e) => { e.preventDefault(); $('#pf-ok', el).click(); });
      if ($('#pf-del', el)) $('#pf-del', el).addEventListener('click', async () => {
        if (!(await confirmBox(`Supprimer « ${p.name} » du catalogue ? L'historique des ventes est conservé.`, 'Supprimer'))) return;
        await run(() => API.call('products.delete', { id: p.id }), 'Produit supprimé'); close(); onSave();
      });
      if (!isNew) {
        const full = await API.call('products.get', { id: p.id });
        $('#pf-moves', el).innerHTML = `<table class="tbl"><tbody>${full.moves.slice(0, 8).map((m) => `<tr><td class="muted">${fdate(m.date)}</td><td>${moveLabel(m.reason)} ${esc(m.ref || '')}</td><td class="num" style="color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${qtyf(m.qty)}</td></tr>`).join('') || '<tr><td class="empty">Aucun mouvement</td></tr>'}</tbody></table>`;
      }
    },
  });
}

function adjustForm(p, onSave) {
  modal({
    title: `Ajuster le stock — ${p.name}`,
    body: `<p style="margin-top:0">Stock actuel : <b>${qtyf(p.stock)} ${esc(p.unit || '')}</b></p><div class="grid-form">
      <div class="field"><label>Opération</label><select class="input" name="mode"><option value="add">Ajouter (+)</option><option value="remove">Retirer (−)</option><option value="set">Fixer le stock à (inventaire)</option></select></div>
      <div class="field"><label>Quantité</label><input class="input" type="number" min="0" name="qty" value="0"></div>
      <div class="field full"><label>Motif</label><input class="input" name="note" placeholder="Ex. : casse, inventaire, cadeau…"></div></div>`,
    foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" id="aj-ok">Valider</button>',
    onMount: (el, close) => $('#aj-ok', el).addEventListener('click', async () => {
      await run(() => API.call('stock.adjust', { product_id: p.id, ...formData(el) }), 'Stock ajusté'); close(); onSave();
    }),
  });
}

function categoriesManager(onChange) {
  const m = modal({ title: 'Catégories', body: '<div id="cm"></div>', foot: '<button class="btn" data-close>Fermer</button>' });
  let changed = false;
  const draw = async () => {
    const cats = await API.call('categories.list');
    $('#cm', m.el).innerHTML = `<form class="toolbar" id="cm-f"><input class="input" name="name" placeholder="Nouvelle catégorie" style="flex:1" required><button class="btn primary">Ajouter</button></form>
      ${cats.map((x) => `<div class="list-row"><span class="grow">${esc(x.name)} <span style="color:var(--ink-3)">· ${x.n} produit(s)</span></span><button class="btn sm" data-ren="${x.id}">Renommer</button>${isAdmin() ? `<button class="btn sm danger" data-del="${x.id}">Supprimer</button>` : ''}</div>`).join('') || '<div class="empty">Aucune catégorie</div>'}`;
    $('#cm-f', m.el).addEventListener('submit', async (e) => { e.preventDefault(); await run(() => API.call('categories.save', formData(e.target))); changed = true; draw(); });
    $$('[data-ren]', m.el).forEach((b) => b.addEventListener('click', async () => {
      const x = cats.find((k) => k.id === Number(b.dataset.ren));
      const row = b.closest('.list-row');
      row.innerHTML = `<input class="input" value="${esc(x.name)}" style="flex:1"><button class="btn sm primary">OK</button>`;
      $('input', row).focus();
      $('button', row).addEventListener('click', async () => { await run(() => API.call('categories.save', { id: x.id, name: $('input', row).value })); changed = true; draw(); });
    }));
    $$('[data-del]', m.el).forEach((b) => b.addEventListener('click', async () => { await run(() => API.call('categories.delete', { id: Number(b.dataset.del) })); changed = true; draw(); }));
  };
  draw();
  new MutationObserver((_, obs) => { if (!m.el.isConnected) { obs.disconnect(); if (changed) onChange(); } }).observe($('#modal-root'), { childList: true });
}

// ======================================================================
// MOUVEMENTS DE STOCK
// ======================================================================
const MOVE_LABELS = { vente: 'Vente', achat: 'Achat', ajustement: 'Ajustement', retour_vente: 'Retour client', retour_achat: 'Retour fournisseur', stock_initial: 'Stock initial', annulation_vente: 'Annulation vente', annulation_achat: 'Annulation achat' };
const moveLabel = (r) => MOVE_LABELS[r] || r;
VIEWS.stock = async (c) => {
  setPage('Mouvements de stock', 'Toutes les entrées et sorties de marchandise');
  const rows = await API.call('stock.moves', { limit: 500 });
  c.innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Produit</th><th>Type</th><th>Réf.</th><th>Motif</th><th>Par</th><th class="num">Quantité</th></tr></thead><tbody>
    ${rows.map((m) => `<tr><td class="muted">${fdate(m.date)}</td><td><b>${esc(m.product)}</b></td><td><span class="tag ${m.qty < 0 ? 'bad' : 'ok'}">${moveLabel(m.reason)}</span></td><td>${esc(m.ref || '')}</td><td class="muted">${esc(m.note || '')}</td><td class="muted">${esc(m.user || '')}</td>
    <td class="num" style="font-weight:600;color:${m.qty < 0 ? 'var(--bad)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${qtyf(m.qty)}</td></tr>`).join('') || emptyRow(7, 'Aucun mouvement de stock')}</tbody></table></div>`;
};

// ======================================================================
// CLIENTS & FOURNISSEURS
// ======================================================================
VIEWS.contacts = async (c, params) => {
  let type = params[0] === 'fournisseur' ? 'fournisseur' : 'client';
  setPage('Clients & fournisseurs', '', `<button class="btn primary" id="a-new">${icon('plus')} Nouveau</button>`);
  c.innerHTML = `<div class="tabs"><button data-t="client">Clients</button><button data-t="fournisseur">Fournisseurs</button></div>
    <div class="toolbar"><input class="input search" id="f-s" placeholder="Nom ou téléphone…"></div>
    <div class="card"><table class="tbl"><thead><tr><th>Nom</th><th>Téléphone</th><th>Adresse</th><th class="num" id="h-bal"></th></tr></thead><tbody id="t-body"></tbody></table></div>`;
  const load = async () => {
    $$('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === type));
    $('#h-bal').textContent = type === 'client' ? 'Doit encore' : 'Nous devons';
    const rows = await API.call('contacts.list', { type, search: $('#f-s').value });
    $('#t-body').innerHTML = rows.map((x) => `<tr class="click" data-id="${x.id}"><td><b>${esc(x.name)}</b></td><td>${esc(x.phone)}</td><td class="muted">${esc(x.address)}</td>
      <td class="num">${x.balance > 0.5 ? `<span class="tag bad">${money(x.balance)}</span>` : '<span class="muted" style="color:var(--ink-3)">—</span>'}</td></tr>`).join('') || emptyRow(4, type === 'client' ? 'Aucun client' : 'Aucun fournisseur');
    $$('#t-body tr[data-id]').forEach((r) => r.addEventListener('click', () => contactForm(rows.find((x) => x.id === Number(r.dataset.id)), load)));
  };
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => { type = b.dataset.t; load(); }));
  $('#f-s').addEventListener('input', debounce(load));
  $('#a-new').addEventListener('click', () => contactForm({ type }, load));
  await load();
};

function contactForm(x, onSave) {
  modal({
    title: x.id ? x.name : (x.type === 'fournisseur' ? 'Nouveau fournisseur' : 'Nouveau client'),
    body: `<form class="grid-form" id="cf"><div class="field"><label>Type</label><select class="input" name="type"><option value="client" ${x.type !== 'fournisseur' ? 'selected' : ''}>Client</option><option value="fournisseur" ${x.type === 'fournisseur' ? 'selected' : ''}>Fournisseur</option></select></div>
      <div class="field"><label>Nom *</label><input class="input" name="name" value="${esc(x.name || '')}" required></div>
      <div class="field"><label>Téléphone</label><input class="input" name="phone" value="${esc(x.phone || '')}"></div>
      <div class="field"><label>E-mail</label><input class="input" name="email" value="${esc(x.email || '')}"></div>
      <div class="field full"><label>Adresse</label><input class="input" name="address" value="${esc(x.address || '')}"></div></form>
      ${x.id ? '<div class="section-title">Historique</div><div id="cf-h" class="card"></div>' : ''}`,
    foot: `<div class="left">${x.id && isAdmin() ? '<button class="btn danger" id="cf-del">Supprimer</button>' : ''}</div><button class="btn" data-close>Annuler</button><button class="btn primary" id="cf-ok">Enregistrer</button>`,
    onMount: async (el, close) => {
      $('#cf-ok', el).addEventListener('click', async () => { const id = await run(() => API.call('contacts.save', { ...formData($('#cf', el)), id: x.id }), 'Enregistré'); close(); onSave(id); });
      $('#cf', el).addEventListener('submit', (e) => { e.preventDefault(); $('#cf-ok', el).click(); });
      if ($('#cf-del', el)) $('#cf-del', el).addEventListener('click', async () => { if (!(await confirmBox(`Supprimer ${x.name} ?`, 'Supprimer'))) return; await run(() => API.call('contacts.delete', { id: x.id })); close(); onSave(); });
      if (x.id) {
        const isC = x.type === 'client';
        const docs = (await API.call(isC ? 'sales.list' : 'purchases.list', { search: x.name })).filter((d) => (isC ? d.client_id : d.supplier_id) === x.id);
        $('#cf-h', el).innerHTML = `<table class="tbl"><tbody>${docs.slice(0, 15).map((d) => `<tr class="click" data-d="${d.id}"><td>${esc(d.ref)}</td><td class="muted">${fdate(d.date, false)}</td><td class="num">${money(d.total - d.returned)}</td><td>${statusTag(d)}</td></tr>`).join('') || '<tr><td class="empty">Aucun document</td></tr>'}</tbody></table>`;
        $$('[data-d]', el).forEach((r) => r.addEventListener('click', () => (isC ? saleDetail : purchaseDetail)(Number(r.dataset.d))));
      }
    },
  });
}

// ======================================================================
// DÉPENSES
// ======================================================================
const EXP_CATS = ['Loyer', 'Électricité', 'Eau', 'Salaires', 'Transport', 'Téléphone / Internet', 'Impôts et taxes', 'Entretien', 'Fournitures', 'Divers'];
VIEWS.expenses = async (c) => {
  setPage('Dépenses', 'Charges de fonctionnement', `<button class="btn primary" id="a-new">${icon('plus')} Nouvelle dépense</button>`);
  c.innerHTML = `<div class="toolbar"><div class="field" style="flex-direction:row;align-items:center"><label>Du</label><input class="input" type="date" id="f-from" value="${today().slice(0, 8)}01"></div>
    <div class="field" style="flex-direction:row;align-items:center"><label>au</label><input class="input" type="date" id="f-to" value="${today()}"></div><div class="spacer"></div><b id="f-tot"></b></div>
    <div class="card"><table class="tbl"><thead><tr><th>Date</th><th>Catégorie</th><th>Description</th><th>Saisi par</th><th class="num">Montant</th><th></th></tr></thead><tbody id="t-body"></tbody></table></div>`;
  const load = async () => {
    const rows = await API.call('expenses.list', { from: $('#f-from').value, to: $('#f-to').value });
    $('#f-tot').textContent = `Total : ${money(rows.reduce((a, r) => a + r.amount, 0))}`;
    $('#t-body').innerHTML = rows.map((e) => `<tr><td>${fdate(e.date, false)}</td><td><span class="tag mute">${esc(e.category)}</span></td><td>${esc(e.note)}</td><td class="muted">${esc(e.user || '')}</td><td class="num"><b>${money(e.amount)}</b></td>
      <td class="num">${isAdmin() ? `<button class="btn sm ghost" data-del="${e.id}">✕</button>` : ''}</td></tr>`).join('') || emptyRow(6, 'Aucune dépense sur la période');
    $$('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (await confirmBox('Supprimer cette dépense ?', 'Supprimer')) { await run(() => API.call('expenses.delete', { id: Number(b.dataset.del) })); load(); } }));
  };
  $('#a-new').addEventListener('click', () => modal({
    title: 'Nouvelle dépense',
    body: `<div class="grid-form"><div class="field"><label>Date</label><input class="input" type="date" name="date" value="${today()}"></div>
      <div class="field"><label>Montant</label><input class="input" type="number" min="0" name="amount"></div>
      <div class="field"><label>Catégorie</label><select class="input" name="category">${EXP_CATS.map((x) => `<option>${x}</option>`).join('')}</select></div>
      <div class="field"><label>Description</label><input class="input" name="note"></div></div>`,
    foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" id="ex-ok">Enregistrer</button>',
    onMount: (el, close) => $('#ex-ok', el).addEventListener('click', async () => { await run(() => API.call('expenses.save', formData(el)), 'Dépense enregistrée'); close(); load(); }),
  }));
  ['#f-from', '#f-to'].forEach((s) => $(s).addEventListener('change', load));
  await load();
};

// ======================================================================
// RAPPORTS
// ======================================================================
VIEWS.reports = async (c) => {
  setPage('Rapports', 'Résultats par période', '<button class="btn" id="r-print">' + icon('print') + ' Imprimer</button>');
  c.innerHTML = `<div class="toolbar"><select class="input" id="r-pre"><option value="today">Aujourd'hui</option><option value="month" selected>Ce mois-ci</option><option value="lastmonth">Mois dernier</option><option value="year">Cette année</option><option value="custom">Personnalisée</option></select>
    <input class="input" type="date" id="r-from"><input class="input" type="date" id="r-to"></div><div id="r-out"></div>`;
  const setPreset = () => {
    const d = new Date(), v = $('#r-pre').value;
    const f = (x) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
    if (v === 'today') { $('#r-from').value = today(); $('#r-to').value = today(); }
    if (v === 'month') { $('#r-from').value = f(new Date(d.getFullYear(), d.getMonth(), 1)); $('#r-to').value = today(); }
    if (v === 'lastmonth') { $('#r-from').value = f(new Date(d.getFullYear(), d.getMonth() - 1, 1)); $('#r-to').value = f(new Date(d.getFullYear(), d.getMonth(), 0)); }
    if (v === 'year') { $('#r-from').value = `${d.getFullYear()}-01-01`; $('#r-to').value = today(); }
  };
  let last = null;
  const load = async () => {
    const range = { from: $('#r-from').value, to: $('#r-to').value };
    const [s, top, pays] = await Promise.all([API.call('reports.summary', range), API.call('reports.topProducts', { ...range, limit: 15 }), API.call('reports.payments', range)]);
    last = { s, top, pays, range };
    const row = (l, v, strong) => `<div class="trow" style="padding:7px 0;border-bottom:1px solid var(--line)${strong ? ';font-weight:700;font-size:15.5px' : ''}"><span>${l}</span><span class="num">${v}</span></div>`;
    $('#r-out').innerHTML = `<div class="dash-grid" style="grid-template-columns:1fr 1fr">
      <div class="card"><div class="card-h"><h3>Compte de résultat</h3></div><div class="card-b">
        ${row('Ventes brutes', money(s.sales.total))}${s.sales.returned ? row('Retours clients', '−' + money(s.sales.returned)) : ''}${row('Ventes nettes', money(s.sales.net), true)}
        ${row('Coût des marchandises vendues', '−' + money(s.cost))}${row('Marge brute', money(s.grossProfit), true)}
        ${row('Dépenses', '−' + money(s.expenses))}${row('Bénéfice net', `<span style="color:${s.netProfit < 0 ? 'var(--bad)' : 'var(--ok)'}">${money(s.netProfit)}</span>`, true)}</div></div>
      <div class="card"><div class="card-h"><h3>Trésorerie et créances</h3></div><div class="card-b">
        ${row('Encaissé sur les ventes', money(s.sales.paid))}${row('Reste à encaisser (clients)', money(s.sales.due))}
        ${row('Achats nets', money(s.purchases.net))}${row('Payé aux fournisseurs', money(s.purchases.paid))}${row('Reste à payer (fournisseurs)', money(s.purchases.due))}
        <div class="section-title">Argent reçu sur la période, par mode</div>
        ${pays.filter((p) => p.kind === 'vente').map((p) => row(esc(p.method), money(p.amount))).join('') || '<div class="muted" style="color:var(--ink-3)">Aucun encaissement</div>'}</div></div></div>
      <div class="card"><div class="card-h"><h3>Produits vendus</h3></div><table class="tbl"><thead><tr><th>Produit</th><th class="num">Quantité</th><th class="num">Chiffre d'affaires</th><th class="num">Marge</th></tr></thead><tbody>
      ${top.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${qtyf(t.qty)}</td><td class="num">${money(t.amount)}</td><td class="num">${money(t.margin)}</td></tr>`).join('') || emptyRow(4, 'Aucune vente sur la période')}</tbody></table></div>`;
  };
  $('#r-pre').addEventListener('change', () => { setPreset(); load(); });
  ['#r-from', '#r-to'].forEach((s) => $(s).addEventListener('change', () => { $('#r-pre').value = 'custom'; load(); }));
  $('#r-print').addEventListener('click', () => {
    if (!last) return;
    const { s, top, range } = last;
    printHtml(`<div class="inv"><div class="head"><div><h1>${esc(S.settings.company_name)}</h1></div><div style="text-align:right"><h1>RAPPORT</h1>Du ${fdate(range.from, false)} au ${fdate(range.to, false)}</div></div>
      <table><tbody><tr><td>Ventes nettes</td><td class="r">${money(s.sales.net)}</td></tr><tr><td>Coût des marchandises</td><td class="r">${money(s.cost)}</td></tr><tr><td><b>Marge brute</b></td><td class="r"><b>${money(s.grossProfit)}</b></td></tr>
      <tr><td>Dépenses</td><td class="r">${money(s.expenses)}</td></tr><tr><td><b>Bénéfice net</b></td><td class="r"><b>${money(s.netProfit)}</b></td></tr><tr><td>Reste à encaisser</td><td class="r">${money(s.sales.due)}</td></tr><tr><td>Reste à payer fournisseurs</td><td class="r">${money(s.purchases.due)}</td></tr></tbody></table>
      <h3 style="margin-top:24px">Produits vendus</h3><table><thead><tr><th>Produit</th><th class="r">Qté</th><th class="r">CA</th><th class="r">Marge</th></tr></thead><tbody>${top.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${qtyf(t.qty)}</td><td class="r">${money(t.amount)}</td><td class="r">${money(t.margin)}</td></tr>`).join('')}</tbody></table></div>`, 'a4');
  });
  setPreset();
  await load();
};

// ======================================================================
// UTILISATEURS
// ======================================================================
VIEWS.users = async (c) => {
  setPage('Utilisateurs', 'Comptes et droits d\'accès', `<button class="btn primary" id="a-new">${icon('plus')} Nouvel utilisateur</button>`);
  const load = async () => {
    const rows = await API.call('users.list');
    c.innerHTML = `<div class="card"><table class="tbl"><thead><tr><th>Nom</th><th>Identifiant</th><th>Rôle</th><th>État</th><th>Créé le</th></tr></thead><tbody>
      ${rows.map((u) => `<tr class="click" data-id="${u.id}"><td><b>${esc(u.name)}</b></td><td>${esc(u.username)}</td><td>${u.role === 'admin' ? '<span class="tag info">Administrateur</span>' : '<span class="tag mute">Vendeur</span>'}</td>
      <td>${u.active ? '<span class="tag ok">Actif</span>' : '<span class="tag bad">Désactivé</span>'}</td><td class="muted">${fdate(u.created_at, false)}</td></tr>`).join('')}</tbody></table></div>
      <p style="color:var(--ink-3);margin-top:12px">Un <b>vendeur</b> peut vendre, acheter et gérer les produits, mais ne peut pas annuler une vente, supprimer, modifier les prix en caisse ni changer les paramètres.</p>`;
    $$('tr[data-id]', c).forEach((r) => r.addEventListener('click', () => userForm(rows.find((u) => u.id === Number(r.dataset.id)), load)));
  };
  $('#a-new').addEventListener('click', () => userForm({ active: 1, role: 'vendeur' }, load));
  await load();
};
function userForm(u, onSave) {
  modal({
    title: u.id ? u.name : 'Nouvel utilisateur',
    body: `<div class="grid-form"><div class="field"><label>Nom complet</label><input class="input" name="name" value="${esc(u.name || '')}"></div>
      <div class="field"><label>Identifiant</label><input class="input" name="username" value="${esc(u.username || '')}"></div>
      <div class="field"><label>Rôle</label><select class="input" name="role"><option value="vendeur">Vendeur</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrateur</option></select></div>
      <div class="field"><label>${u.id ? 'Nouveau mot de passe (laisser vide)' : 'Mot de passe'}</label><input class="input" type="password" name="password"></div>
      <label class="full" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> Compte actif</label></div>`,
    foot: '<button class="btn" data-close>Annuler</button><button class="btn primary" id="u-ok">Enregistrer</button>',
    onMount: (el, close) => $('#u-ok', el).addEventListener('click', async () => { await run(() => API.call('users.save', { ...formData(el), id: u.id }), 'Utilisateur enregistré'); close(); onSave(); }),
  });
}

// ======================================================================
// PARAMÈTRES
// ======================================================================
VIEWS.settings = async (c) => {
  setPage('Paramètres');
  const s = S.settings;
  const dis = isAdmin() ? '' : 'disabled';
  c.innerHTML = `<div class="dash-grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><div class="card-h"><h3>Entreprise</h3></div><form class="card-b grid-form" id="st">
      <div class="field full"><label>Nom de l'entreprise</label><input class="input" name="company_name" value="${esc(s.company_name)}" ${dis}></div>
      <div class="field"><label>Gérant</label><input class="input" name="owner_name" value="${esc(s.owner_name)}" ${dis}></div>
      <div class="field"><label>Téléphone / WhatsApp</label><input class="input" name="company_phone" value="${esc(s.company_phone)}" ${dis}></div>
      <div class="field"><label>Ville</label><input class="input" name="company_city" value="${esc(s.company_city)}" ${dis}></div>
      <div class="field"><label>Quartier / commune</label><input class="input" name="company_district" value="${esc(s.company_district)}" ${dis}></div>
      <div class="field"><label>Activité</label><select class="input" name="company_activity" ${dis}>${activityOptions(s.company_activity)}</select></div>
      <div class="field"><label>E-mail</label><input class="input" name="company_email" value="${esc(s.company_email)}" ${dis}></div>
      <div class="field full"><label>Adresse</label><input class="input" name="company_address" value="${esc(s.company_address)}" ${dis}></div>
      <div class="field"><label>Monnaie</label><input class="input" name="currency" value="${esc(s.currency)}" ${dis}></div>
      <div class="field"><label>Format d'impression en caisse</label><select class="input" name="ticket_format" ${dis}><option value="ticket">Ticket 80 mm</option><option value="a4" ${s.ticket_format === 'a4' ? 'selected' : ''}>Facture A4</option></select></div>
      <div class="field full"><label>Message en bas des factures</label><input class="input" name="invoice_footer" value="${esc(s.invoice_footer)}" ${dis}></div>
      ${isAdmin() ? '<div class="full"><button class="btn primary">Enregistrer</button></div>' : '<p class="full" style="color:var(--ink-3)">Seul l\'administrateur peut modifier ces informations.</p>'}</form></div>
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="card"><div class="card-h"><h3>Sauvegarde des données</h3></div><div class="card-b">
        <p style="margin-top:0;color:var(--ink-2)">SikaGest fait une copie vérifiée de vos données toutes les 3 heures et à la fermeture. Il garde l'historique sur 12 mois.</p>
        <div id="b-status" class="bk-status"></div>
        <p style="color:var(--ink-2)"><b>Important :</b> ces copies restent sur cet ordinateur. Faites aussi une copie <b>chaque semaine</b> sur une clé USB, gardée hors de la boutique.</p>
        <div class="toolbar" style="margin:0"><button class="btn primary" id="b-exp">Créer une sauvegarde…</button>${isAdmin() ? '<button class="btn" id="b-imp">Restaurer…</button>' : ''}<button class="btn ghost" id="b-auto">Voir les copies automatiques</button><button class="btn ghost" id="b-dir">Ouvrir le dossier des données</button></div>
        <p style="color:var(--ink-3);font-size:12.5px;margin-bottom:0" id="b-path"></p></div></div>
      <div class="card"><div class="card-h"><h3>Sauvegarde en ligne</h3></div><div class="card-b">
        <p style="margin-top:0;color:var(--ink-2)">Vos données sont chiffrées sur cet ordinateur puis envoyées en ligne quand Internet est disponible. Si l'ordinateur est perdu, volé ou en panne, réinstallez SikaGest et choisissez « Récupérer mes données » : vous retrouvez tout avec le téléphone de l'entreprise et votre mot de passe. Personne d'autre ne peut lire vos données, pas même votre fournisseur.</p>
        <div id="c-status" class="bk-status"></div>
        <div class="toolbar" style="margin:0" id="c-actions"></div></div></div>
      <div class="card"><div class="card-h"><h3>Mises à jour</h3></div><div class="card-b">
        <p style="margin-top:0">Version installée : <b>${esc(S.info.version)}</b>${S.info.portable ? ' (portable)' : ''}<br>
        Identifiant d'installation : <b style="font-family:ui-monospace,Consolas,monospace">${esc(s.install_code || '')}</b></p>
        <p id="u-msg" style="color:var(--ink-2)">Le logiciel vérifie automatiquement les nouvelles versions quand Internet est disponible.</p>
        <button class="btn" id="u-chk">Rechercher une mise à jour</button></div></div>
      <div class="card"><div class="card-h"><h3>Mon mot de passe</h3></div><form class="card-b grid-form" id="pw">
        <div class="field"><label>Mot de passe actuel</label><input class="input" type="password" name="current"></div>
        <div class="field"><label>Nouveau mot de passe</label><input class="input" type="password" name="password"></div>
        <div class="full"><button class="btn">Changer</button></div></form></div>
    </div></div>`;
  if (isAdmin()) $('#st').addEventListener('submit', async (e) => { e.preventDefault(); S.settings = await run(() => API.call('settings.save', formData(e.target)), 'Paramètres enregistrés'); if (window.sika) window.sika.syncNow(); route(); });
  $('#pw').addEventListener('submit', async (e) => { e.preventDefault(); await run(() => API.call('auth.changePassword', formData(e.target)), 'Mot de passe modifié'); e.target.reset(); });
  const desktop = !!window.sika;
  if (desktop) $('#b-path').textContent = `Emplacement : ${S.info.dataDir}`;
  const b = S.backup;
  $('#b-status').innerHTML = !desktop || !b ? '<div class="bk-row"><span>Sauvegardes</span><b>disponibles dans le logiciel installé</b></div>' : `
    <div class="bk-row"><span>Dernière copie automatique</span><b class="${b.lastError ? 'bad' : 'ok'}">${b.lastError ? 'échec : ' + esc(b.lastError) : esc(backupAgo(b.lastOk))}</b></div>
    <div class="bk-row"><span>Copies gardées sur ce PC</span><b>${b.count}${b.oldest ? ` (depuis le ${new Date(b.oldest).toLocaleDateString('fr-FR')})` : ''}</b></div>
    <div class="bk-row"><span>Dernière copie sur clé USB</span><b class="${b.daysSinceExternal >= 7 ? 'warn' : 'ok'}">${esc(backupAgo(b.lastExternal))}</b></div>`;
  $('#b-exp').addEventListener('click', exportBackup);
  renderCloudCard();
  $('#b-auto').addEventListener('click', () => desktop ? window.sika.openBackupDir() : toast('Disponible dans le logiciel installé', 'err'));
  if ($('#b-imp')) $('#b-imp').addEventListener('click', async () => { if (!desktop) return toast('Disponible dans le logiciel installé', 'err'); const r = await window.sika.backupImport(); if (r.ok) { toast('Données restaurées. Reconnectez-vous.', 'ok'); S.user = null; boot(); } else if (r.error) toast(r.error, 'err'); });
  $('#b-dir').addEventListener('click', () => desktop ? window.sika.openDataDir() : toast('Disponible dans le logiciel installé', 'err'));
  $('#u-chk').addEventListener('click', async () => {
    if (!desktop) return toast('Disponible dans le logiciel installé', 'err');
    $('#u-msg').textContent = 'Recherche en cours…';
    await window.sika.checkUpdates();
    const show = () => {
      const u = S.update || {};
      const msgs = { checking: 'Recherche en cours…', none: 'Vous avez la dernière version. ✔', downloading: `Téléchargement de la version ${u.version || ''}… ${u.percent || 0} %`,
        downloaded: `La version ${u.version} est prête. Cliquez sur le bouton vert en haut pour redémarrer.`, 'available-portable': `La version ${u.version} est disponible. Cliquez sur le bouton vert en haut pour la télécharger.`,
        error: u.message, dev: u.message };
      if ($('#u-msg')) $('#u-msg').textContent = msgs[u.state] || '';
    };
    window.sika.onUpdate(show); setTimeout(show, 400);
  });
};

// ---------- Sauvegarde en ligne (Paramètres) ----------
function renderCloudCard() {
  const box = $('#c-status'), act = $('#c-actions');
  if (!box) return;
  const c = S.cloud;
  if (!window.sika || !c) { box.innerHTML = '<div class="bk-row"><span>Sauvegarde en ligne</span><b>disponible dans le logiciel installé</b></div>'; act.innerHTML = ''; return; }
  const row = (k, v, cls = '') => `<div class="bk-row"><span>${k}</span><b class="${cls}">${v}</b></div>`;
  let html = '';
  if (!c.enabled) html = row('État', 'activation à la prochaine connexion d\'un administrateur', 'warn');
  else if (c.error) html = row('État', esc(c.error.message), c.error.code === 'no_phone' ? 'warn' : 'bad');
  else if (!c.active) html = row('État', c.offlineSince ? 'en attente d\'Internet' : 'activation en cours…', 'warn');
  else html = row('État', 'active ✔', 'ok');
  if (c.active) {
    html += row('Compte en ligne', esc(c.phone || ''));
    html += row('Dernier envoi', c.lastUpload ? esc(backupAgo(c.lastUpload)) : 'pas encore', c.lastUpload && (Date.now() - new Date(c.lastUpload)) < 3 * 864e5 ? 'ok' : 'warn');
    if (c.offlineSince) html += row('Internet', `indisponible depuis ${esc(backupAgo(c.offlineSince))}`, 'warn');
    if (c.unsent) html += row('Modifications récentes', c.offlineSince ? 'en attente d\'Internet' : 'envoi dans quelques minutes', 'warn');
  }
  box.innerHTML = html;
  act.innerHTML = `${c.active ? '<button class="btn" id="c-sync">Envoyer maintenant</button>' : ''}${isAdmin() ? '<button class="btn ghost" id="c-restore">Récupérer mes données en ligne…</button>' : ''}`;
  if ($('#c-sync')) $('#c-sync').addEventListener('click', async () => {
    const b = $('#c-sync'); b.disabled = true; b.textContent = 'Envoi en cours…';
    const r = await window.sika.cloudSync();
    S.cloud = r.ok ? r.data : await window.sika.cloudStatus();
    if (r.ok && !S.cloud.error && !S.cloud.offlineSince) toast('Sauvegarde envoyée en ligne', 'ok'); else toast((S.cloud.error && S.cloud.error.message) || 'Pas de connexion Internet. Nouvel essai automatique plus tard.', 'err');
    renderCloudCard();
  });
  if ($('#c-restore')) $('#c-restore').addEventListener('click', () => cloudRestoreModal({ replacing: true, phone: S.settings.company_phone || '' }));
}

// ---------- Export CSV (ouvrable dans Excel) ----------
function exportCsv(name, head, rows) {
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${name}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ======================================================================
// LICENCE
// ======================================================================
VIEWS.license = async (c) => {
  setPage('Licence', 'Activation de SikaGest');
  const L = await API.call('license.status');
  S.license = L; renderLicenseBanner();
  const v = vendor();
  const wa = waUrl(licenseRequestText());
  const stateTag = { trial: '<span class="tag info">Essai</span>', active: '<span class="tag ok">Activé</span>', expired: '<span class="tag bad">Expiré</span>' }[L.state];
  const detail = L.state === 'active'
    ? (L.lifetime ? 'Licence à vie : aucune date d\'expiration.' : `Valable jusqu'au <b>${fdate(L.expires, false)}</b> (${fdays(L.daysLeft)}).`)
    : L.state === 'trial' ? `Se termine le <b>${fdate(L.expires, false)}</b> (${L.daysLeft === 0 ? 'aujourd\'hui' : 'dans ' + fdays(L.daysLeft)}).`
    : `Terminé le <b>${fdate(L.expires, false)}</b>. Vos données sont conservées et consultables. Activez SikaGest pour enregistrer à nouveau.`;
  c.innerHTML = `<div class="dash-grid" style="grid-template-columns:1fr 1fr">
    <div class="card"><div class="card-b">
      <div class="lic-hero"><div class="kpi" style="box-shadow:none;border:0;padding:0"><div class="k-ico ${L.state === 'active' ? 'c-ok' : L.state === 'trial' ? 'c-info' : 'c-bad'}">${icon('key', '')}</div></div>
        <div><div class="big">${esc(L.plan)} ${stateTag}</div><div style="color:var(--ink-2)">${detail}</div></div></div>
      <div class="section-title">Votre code d'installation</div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="code-box" id="ic">${esc(L.installCode)}</span><button class="btn" id="ic-copy">Copier</button></div>
      <p style="color:var(--ink-3);font-size:12.5px">Ce code identifie cet ordinateur. Votre fournisseur en a besoin pour fabriquer votre clé.</p>
    </div></div>
    <div class="card"><div class="card-h"><h3>${L.state === 'active' ? 'Renouveler ou changer de formule' : 'Acheter une licence'}</h3></div><div class="card-b">
      <ol class="steps"><li>Contactez votre fournisseur${v.name ? ` <b>${esc(v.name)}</b>` : ''} et donnez-lui votre <b>code d'installation</b>.</li>
        <li>Payez la formule choisie (Mobile Money, Wave, espèces…).${[['Wave', v.wave], ['Orange Money', v.orange_money], ['MTN MoMo', v.mtn_momo]].filter((x) => x[1]).map((x) => `<br><b>${x[0]} : ${esc(x[1])}</b>`).join('')}</li><li>Vous recevez une <b>clé d'activation</b> : collez-la ci-dessous.</li></ol>
      <div class="toolbar" style="margin:14px 0 0">${wa ? `<a class="btn primary" href="${wa}" target="_blank" rel="noopener">${icon('whatsapp')} Contacter par WhatsApp</a>` : ''}${v.site ? `<a class="btn" href="${esc(v.site)}" target="_blank" rel="noopener">Voir les tarifs</a>` : ''}</div>
    </div></div></div>
    <div class="card"><div class="card-h"><h3>Activer avec une clé</h3></div><div class="card-b">
      <textarea class="input" id="lk" rows="3" style="width:100%;font-family:ui-monospace,Consolas,monospace" placeholder="Collez ici la clé d'activation reçue"></textarea>
      <div style="margin-top:12px;display:flex;gap:10px;align-items:center"><button class="btn primary" id="lk-ok">${icon('key')} Activer</button><span id="lk-msg"></span></div>
    </div></div>`;
  $('#ic-copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(L.installCode); toast('Code copié', 'ok'); } catch (e) { toast(L.installCode); } });
  $('#lk-ok').addEventListener('click', async () => {
    try {
      S.license = await API.call('license.activate', { key: $('#lk').value });
      toast(`SikaGest est activé : ${S.license.plan}${S.license.lifetime ? '' : ' jusqu\'au ' + fdate(S.license.expires, false)}.`, 'ok');
      if (window.sika && window.sika.syncNow) window.sika.syncNow();
      route();
    } catch (e) { $('#lk-msg').innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; }
  });
};
