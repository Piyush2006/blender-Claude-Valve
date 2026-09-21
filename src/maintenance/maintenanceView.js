import * as store from './ticketStore.js';

/**
 * MAINTENANCE view: ticket list with status / priority / assignee filters and
 * a small summary strip. Rows open the ticket drawer (maintenanceUI).
 */
export function createMaintenanceView(container, { onOpenTicket, onBack }) {
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  const filters = { status: '', priority: '', assignee: '', q: '' };

  container.innerHTML = `
    <div class="mt-wrap">
      <section class="mt-summary" id="mt-summary"></section>
      <section class="card">
        <div class="card-head"><div><h2>Maintenance Tickets</h2></div><button class="btn" type="button" id="mt-back">← Back to Dashboard</button></div>
        <div class="mt-filters">
          <label>Status <select data-f="status"><option value="">All</option><option value="ACTIVE">Active (not closed)</option>${store.STATUS_FLOW.map((s) => `<option value="${s}">${s}</option>`).join('')}</select></label>
          <label>Priority <select data-f="priority"><option value="">All</option>${store.PRIORITIES.map((p) => `<option value="${p}">${p}</option>`).join('')}</select></label>
          <label>Assigned To <select data-f="assignee"><option value="">All</option><option value="__none">Unassigned</option>${store.USERS.map((u) => `<option value="${u.id}">${u.name}</option>`).join('')}</select></label>
          <span class="spacer"></span>
          <label>Search <input data-f="q" type="search" placeholder="ticket, component, issue"></label>
        </div>
        <div style="overflow-x:auto;margin-top:10px">
          <table class="ticket-table">
            <thead><tr><th>Ticket</th><th>Component</th><th>Issue</th><th>Priority</th><th>Assigned To</th><th>Status</th><th>Created</th><th>Due</th></tr></thead>
            <tbody id="mt-rows"></tbody>
          </table>
        </div>
      </section>
    </div>`;

  const rows = container.querySelector('#mt-rows');
  const summary = container.querySelector('#mt-summary');
  for (const sel of container.querySelectorAll('[data-f]')) {
    sel.addEventListener(sel.tagName === 'INPUT' ? 'input' : 'change', () => { filters[sel.dataset.f] = sel.value; render(); });
  }
  container.querySelector('#mt-back').addEventListener('click', () => onBack?.());
  rows.addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) onOpenTicket?.(tr.dataset.id); });

  function matches(t) {
    if (filters.status === 'ACTIVE' ? t.status === 'CLOSED' : filters.status && t.status !== filters.status) return false;
    if (filters.priority && t.priority !== filters.priority) return false;
    if (filters.assignee === '__none' ? !!t.assigneeId : filters.assignee && t.assigneeId !== filters.assignee) return false;
    if (filters.q) { const q = filters.q.toLowerCase(); if (!`${t.id} ${t.component} ${t.issue} ${t.assignee || ''}`.toLowerCase().includes(q)) return false; }
    return true;
  }

  function render() {
    const all = store.tickets();
    const today = new Date().toISOString().slice(0, 10);
    const counts = { open: 0, progress: 0, resolved: 0, closed: 0, overdue: 0 };
    for (const t of all) {
      if (t.status === 'OPEN' || t.status === 'ASSIGNED') counts.open++;
      else if (t.status === 'IN PROGRESS') counts.progress++;
      else if (t.status === 'RESOLVED') counts.resolved++;
      else counts.closed++;
      if (t.status !== 'CLOSED' && t.dueDate && t.dueDate < today) counts.overdue++;
    }
    summary.innerHTML = [
      ['Open / Assigned', counts.open, counts.open ? 'critical' : 'normal'], ['In Progress', counts.progress, counts.progress ? 'attention' : 'normal'],
      ['Resolved', counts.resolved, 'normal'], ['Closed', counts.closed, 'normal'], ['Overdue', counts.overdue, counts.overdue ? 'critical' : 'normal'],
    ].map(([l, v, lvl]) => `<div class="kpi-card mt-kpi" data-level="${lvl}"><div class="kpi-body"><div class="mt-kpi-label">${l}</div><div class="mt-kpi-value mono">${v}</div></div></div>`).join('');

    const list = all.filter(matches);
    rows.innerHTML = list.length ? list.map((t) => `
      <tr data-id="${t.id}">
        <td class="tid mono">${t.id}</td><td>${esc(t.component)}</td><td>${esc(t.issue)}</td>
        <td><span class="pr" data-pr="${t.priority}">${t.priority}</span></td><td>${esc(t.assignee || '—')}</td>
        <td><span class="st" data-st="${t.status}">${t.status}</span></td>
        <td class="mono">${dateFmt.format(new Date(t.createdAt))}</td>
        <td class="mono ${t.status !== 'CLOSED' && t.dueDate && t.dueDate < today ? 'overdue' : ''}">${t.dueDate || '—'}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="empty">No tickets match the current filters. Tickets are created from the Dashboard's Active Anomalies card.</td></tr>`;
  }

  store.onTicketsChange(render);
  render();
  return { render };
}

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
