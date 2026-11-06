import { api } from './client';

/** Отчёты, выпущенные Kars Avia для этой гостиницы (01.10.2026). */
export async function listAviaReports() {
  const { data } = await api.get('/avia-reports');
  return data;
}

/** Скачать файл выпущенного отчёта (xlsx). */
export async function downloadAviaReport(id, name) {
  const { data } = await api.get(`/avia-reports/${encodeURIComponent(id)}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'report.xlsx';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 4.2 · Заявки Kars Avia с этой гостиницей и отчёт по каждой. */
export async function listFapReports() {
  const { data } = await api.get('/avia-reports/fap');
  return data;
}

export async function getFapReport(id) {
  const { data } = await api.get(`/avia-reports/fap/${encodeURIComponent(id)}`);
  return data;
}

export async function sendFapReport(id, rows) {
  const { data } = await api.put(`/avia-reports/fap/${encodeURIComponent(id)}`, { rows });
  return data;
}

export async function sendFapInvoice(id, file, amount, number) {
  const form = new FormData();
  form.append('file', file);
  form.append('amount', String(amount));
  if (number) form.append('number', number);
  const { data } = await api.post(`/avia-reports/fap/${encodeURIComponent(id)}/invoice`, form);
  return data;
}
