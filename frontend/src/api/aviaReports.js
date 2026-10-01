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
