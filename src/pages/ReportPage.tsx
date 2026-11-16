import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Download, FileText, Loader2, Printer } from 'lucide-react';
import { LOGO_DATA_URI, STORE_NAME } from '../constants/branding';
import { callApi } from '../services/api';
import type {
  ReportTable,
  ReportType,
  SalesCategorySummary,
  SalesGroupSummary,
  SalesMomComparison as SalesMomComparisonData,
  SalesTrendPoint,
  Session,
} from '../types/pos';
import { escapeHtml, exportToCsv, fmtDate, isoDate, rangeOf, rp } from '../utils/format';
import { Modal, printReportHtml } from '../components/ui/Dialog';
import { SalesCategoryCharts } from '../components/reports/SalesCategoryCharts';
import { SalesMomComparison } from '../components/reports/SalesMomComparison';
import { exportSalesReportPdf, formatMonthLabelId } from '../utils/reportPdf';

interface ReportPageProps {
  session: Session;
  onToast: (msg: string, type?: 'ok' | 'warn' | 'err' | 'info') => void;
}

const REPORT_TABS: [ReportType, string, boolean][] = [
  ['sales', 'Penjualan', false],
  ['purchase', 'Pembelian', false],
  ['expense', 'Operasional', false],
  ['profit', 'Laba Rugi', true],
  ['stock', 'Persediaan', true],
];

const ACTION_MAP: Record<ReportType, string> = {
  sales: 'reportSales',
  purchase: 'reportPurchases',
  expense: 'reportExpenses',
  profit: 'reportProfit',
  stock: 'reportStock',
};

const sumBy = <T extends Record<string, unknown>>(arr: T[], key: keyof T): number =>
  arr.reduce((acc, item) => acc + (Number(item[key]) || 0), 0);

function buildReportTable(type: ReportType, raw: Record<string, unknown>): ReportTable {
  if (type === 'sales') {
    const rows = (raw.rows || []) as {
      no: string;
      tgl: string;
      pihak: string;
      kelompok?: string;
      total: number;
    }[];
    const salesGroups = (raw.salesGroups || []) as SalesGroupSummary[];
    const salesCategories = (raw.salesCategories || []) as SalesCategorySummary[];
    const salesTrend = (raw.salesTrend || []) as SalesTrendPoint[];
    const grouped: Record<string, [number, number]> = {};
    rows.forEach((x) => {
      const key = x.pihak || '-';
      if (!grouped[key]) grouped[key] = [0, 0];
      grouped[key][0] += 1;
      grouped[key][1] += x.total;
    });
    const totalOmset = sumBy(rows, 'total');
    return {
      cols: [
        ['No. Nota', 't'],
        ['Tanggal', 't'],
        ['Konsumen', 't'],
        ['Kelompok', 't'],
        ['Total', 'r'],
      ],
      rows: rows.map((x) => [x.no, fmtDate(x.tgl), x.pihak || '-', x.kelompok || '-', x.total]),
      foot: ['Total', '', '', '', totalOmset],
      sum: {
        cols: [
          ['Per Konsumen', 't'],
          ['Jumlah Nota', 'n'],
          ['Total', 'r'],
        ],
        rows: Object.entries(grouped)
          .sort((a, b) => b[1][1] - a[1][1])
          .map(([k, v]) => [k, v[0], v[1]]),
      },
      salesGroups,
      salesCategories,
      salesTrend,
      totalOmset,
    };
  }

  if (type === 'purchase') {
    const rows = (raw.rows || []) as { no: string; tgl: string; pihak: string; total: number }[];
    const grouped: Record<string, [number, number]> = {};
    rows.forEach((x) => {
      const key = x.pihak || '-';
      if (!grouped[key]) grouped[key] = [0, 0];
      grouped[key][0] += 1;
      grouped[key][1] += x.total;
    });
    return {
      cols: [
        ['No. Nota', 't'],
        ['Tanggal', 't'],
        ['Supplier', 't'],
        ['Total', 'r'],
      ],
      rows: rows.map((x) => [x.no, fmtDate(x.tgl), x.pihak || '-', x.total]),
      foot: ['Total', '', '', sumBy(rows, 'total')],
      sum: {
        cols: [
          ['Per Supplier', 't'],
          ['Jumlah Nota', 'n'],
          ['Total', 'r'],
        ],
        rows: Object.entries(grouped)
          .sort((a, b) => b[1][1] - a[1][1])
          .map(([k, v]) => [k, v[0], v[1]]),
      },
    };
  }

  if (type === 'expense') {
    const rows = (raw.rows || []) as {
      nomor: string;
      tgl: string;
      kategori: string;
      keterangan: string;
      jumlah: number;
    }[];
    return {
      cols: [
        ['Nomor', 't'],
        ['Tanggal', 't'],
        ['Kategori', 't'],
        ['Keterangan', 't'],
        ['Jumlah', 'r'],
      ],
      rows: rows.map((x) => [x.nomor, fmtDate(x.tgl), x.kategori, x.keterangan || '-', x.jumlah]),
      foot: ['Total', '', '', '', sumBy(rows, 'jumlah')],
    };
  }

  if (type === 'profit') {
    const penjualan = Number(raw.penjualan) || 0;
    const hpp = Number(raw.hpp) || 0;
    const biaya = Number(raw.biaya) || 0;
    const labaKotor = penjualan - hpp;
    return {
      cols: [
        ['Keterangan', 't'],
        ['Jumlah', 'r'],
      ],
      rows: [
        ['Penjualan Bersih', penjualan],
        ['HPP Barang Terjual', -hpp],
        ['Laba Kotor', labaKotor],
        ['Biaya Operasional', -biaya],
        ['Laba Bersih', labaKotor - biaya],
      ],
    };
  }

  const rows = (raw.rows || []) as {
    kode: string;
    nama: string;
    stok: number;
    hpp: number;
    nilai: number;
  }[];
  return {
    cols: [
      ['Kode', 't'],
      ['Barang', 't'],
      ['Stok', 'n'],
      ['HPP', 'r'],
      ['Nilai Persediaan', 'r'],
    ],
    rows: rows.map((x) => [x.kode, x.nama, x.stok, x.hpp, x.nilai]),
    foot: ['Total', '', sumBy(rows, 'stok'), '', sumBy(rows, 'nilai')],
  };
}

function renderReportTableHtml(table: ReportTable): string {
  const fmt = (val: string | number, type: 't' | 'n' | 'r') =>
    val === '' ? '' : type === 'r' ? rp(Number(val)) : type === 'n' ? String(val) : escapeHtml(val);

  return `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr>${table.cols
          .map(
            (c) =>
              `<th style="border-bottom:1px solid #666;padding:6px 4px;text-align:${c[1] === 't' ? 'left' : 'right'}">${escapeHtml(c[0])}</th>`,
          )
          .join('')}</tr>
      </thead>
      <tbody>
        ${table.rows
          .map(
            (r) =>
              `<tr>${r
                .map(
                  (v, i) =>
                    `<td style="border-bottom:1px solid #ddd;padding:5px 4px;text-align:${table.cols[i][1] === 't' ? 'left' : 'right'}">${fmt(v, table.cols[i][1])}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('')}
      </tbody>
      ${
        table.foot
          ? `<tfoot><tr>${table.foot
              .map(
                (v, i) =>
                  `<th style="border-top:2px solid #333;padding:6px 4px;text-align:${table.cols[i][1] === 't' ? 'left' : 'right'}">${fmt(v, table.cols[i][1])}</th>`,
              )
              .join('')}</tr></tfoot>`
          : ''
      }
    </table>
  `;
}

export function ReportPage({ session, onToast }: ReportPageProps) {
  const isOwner = session.role === 'owner';
  const visibleTabs = REPORT_TABS.filter(([, , ownerOnly]) => !ownerOnly || isOwner);

  const [tab, setTab] = useState<ReportType>('sales');
  const [defaultStart, defaultEnd] = rangeOf('month');
  const [dari, setDari] = useState(defaultStart);
  const [sampai, setSampai] = useState(defaultEnd);
  const [reportState, setReportState] = useState<{ tab: ReportType; table: ReportTable } | null>(
    null,
  );
  const report = reportState?.tab === tab ? reportState.table : null;
  const [loading, setLoading] = useState(false);
  const [showCatDetail, setShowCatDetail] = useState(false);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);
  const [pdfDay, setPdfDay] = useState(() => isoDate());
  const [pdfMonth, setPdfMonth] = useState(() => isoDate().slice(0, 7));
  const [exportingPdf, setExportingPdf] = useState<'daily' | 'monthly' | 'range' | null>(null);
  const [momBulan, setMomBulan] = useState(() => isoDate().slice(0, 7));
  const [momMonthsWindow, setMomMonthsWindow] = useState<6 | 12>(6);
  const [momData, setMomData] = useState<SalesMomComparisonData | null>(null);
  const [momLoading, setMomLoading] = useState(false);

  const loadMomComparison = useCallback(
    async (bulan: string, months: 6 | 12) => {
      setMomLoading(true);
      try {
        const res = await callApi<SalesMomComparisonData>(
          'reportSalesComparison',
          { bulan, months },
          session,
        );
        setMomData(res);
      } catch (err) {
        onToast((err as Error).message, 'err');
      } finally {
        setMomLoading(false);
      }
    },
    [session, onToast],
  );

  const runReport = useCallback(
    async (targetTab: ReportType, start: string, end: string) => {
      if (targetTab !== 'stock' && start > end) {
        onToast('Tanggal awal melebihi tanggal akhir', 'warn');
        return;
      }
      setLoading(true);
      try {
        const res = await callApi<Record<string, unknown>>(
          ACTION_MAP[targetTab],
          { dari: start, sampai: end },
          session,
        );
        setReportState({ tab: targetTab, table: buildReportTable(targetTab, res) });
      } catch (err) {
        onToast((err as Error).message, 'err');
      } finally {
        setLoading(false);
      }
    },
    [session, onToast],
  );

  const dateRangeRef = useRef({ dari, sampai });
  dateRangeRef.current = { dari, sampai };

  useEffect(() => {
    runReport(tab, dateRangeRef.current.dari, dateRangeRef.current.sampai);
  }, [tab, runReport]);

  useEffect(() => {
    if (tab !== 'sales') return;
    loadMomComparison(momBulan, momMonthsWindow);
  }, [tab, momBulan, momMonthsWindow, loadMomComparison]);

  const applyPreset = (preset: 'today' | 'week' | 'month') => {
    const [a, z] = rangeOf(preset);
    setDari(a);
    setSampai(z);
    runReport(tab, a, z);
  };

  const formatCell = (val: string | number, type: 't' | 'n' | 'r') => {
    if (val === '') return '';
    if (type === 'r') return rp(Number(val));
    return String(val);
  };

  const tabTitle = visibleTabs.find(([id]) => id === tab)?.[1] || '';

  const handlePrint = () => {
    if (!report) return;
    const periodText =
      tab === 'stock'
        ? 'Posisi stok saat ini'
        : `Periode ${fmtDate(dari)} s/d ${fmtDate(sampai)}`;
    const totalOmset = report.totalOmset || 0;
    const groupHtml =
      tab === 'sales' && report.salesGroups && report.salesGroups.length > 0
        ? `
          <h4 style="margin:12px 0 6px;font-size:13px">Catatan Kelompok Penjualan</h4>
          ${renderReportTableHtml({
            cols: [
              ['Kelompok Penjualan', 't'],
              ['Qty', 'n'],
              ['Nota', 'n'],
              ['Porsi', 't'],
              ['Omset', 'r'],
            ],
            rows: report.salesGroups.map((g) => [
              g.categories.length > 0 ? `${g.label} (${g.categories.join(', ')})` : g.label,
              g.qty,
              g.notaCount,
              totalOmset > 0 ? `${Math.round((g.omset / totalOmset) * 100)}%` : '0%',
              g.omset,
            ]),
            foot: ['Total Omset', '', '', '100%', totalOmset],
          })}
          <br />
        `
        : '';

    const html = `
      <div style="color:#000">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
          <img src="${LOGO_DATA_URI}" alt="" style="width:48px;height:48px;object-fit:contain" />
          <div>
            <h2 style="margin:0;font-size:16px">${STORE_NAME}</h2>
            <div style="font-size:13px;font-weight:600">Laporan ${tabTitle}</div>
            <div style="font-size:11px;color:#444">${periodText}</div>
          </div>
        </div>
        ${groupHtml}
        <h4 style="margin:8px 0 4px;font-size:13px">Daftar Transaksi</h4>
        ${renderReportTableHtml(report)}
        ${report.sum ? `<br /><h4 style="margin:8px 0 4px;font-size:13px">Ringkasan</h4>${renderReportTableHtml(report.sum)}` : ''}
      </div>
    `;
    printReportHtml(html);
  };

  const handleExportCsv = () => {
    if (!report) return;
    const csvRows: (string | number)[][] = [...report.rows];
    if (tab === 'sales' && report.salesGroups && report.salesGroups.length > 0) {
      const totalOmset = report.totalOmset || 0;
      csvRows.push(['', '', '', '', '']);
      csvRows.push(['CATATAN KELOMPOK PENJUALAN', 'Qty', 'Jumlah Nota', 'Porsi (%)', 'Omset']);
      report.salesGroups.forEach((g) => {
        const pct = totalOmset > 0 ? `${Math.round((g.omset / totalOmset) * 100)}%` : '0%';
        csvRows.push([g.label, g.qty, g.notaCount, pct, g.omset]);
      });
    }
    exportToCsv(
      `laporan-${tab}.csv`,
      report.cols.map((c) => c[0]),
      csvRows,
    );
    onToast('Laporan CSV diunduh', 'ok');
  };

  const handleExportSalesPdf = async (mode: 'daily' | 'monthly' | 'range') => {
    if (!isOwner) return;
    let startDate = dari;
    let endDate = sampai;

    if (mode === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(pdfDay)) {
        onToast('Pilih tanggal laporan harian yang valid', 'warn');
        return;
      }
      startDate = pdfDay;
      endDate = pdfDay;
    } else if (mode === 'monthly') {
      if (!/^\d{4}-\d{2}$/.test(pdfMonth)) {
        onToast('Pilih bulan laporan yang valid', 'warn');
        return;
      }
      const [yr, mo] = pdfMonth.split('-').map(Number);
      const lastDay = new Date(yr, mo, 0).getDate();
      startDate = `${pdfMonth}-01`;
      endDate = `${pdfMonth}-${String(lastDay).padStart(2, '0')}`;
    } else if (startDate > endDate) {
      onToast('Tanggal awal melebihi tanggal akhir', 'warn');
      return;
    }

    setExportingPdf(mode);
    try {
      const res = await callApi<{
        rows?: {
          no: string;
          tgl: string;
          pihak: string;
          kelompok?: string;
          total: number;
        }[];
        salesGroups?: SalesGroupSummary[];
        salesCategories?: SalesCategorySummary[];
      }>('reportSales', { dari: startDate, sampai: endDate }, session);

      const filename = exportSalesReportPdf({
        mode,
        dari: startDate,
        sampai: endDate,
        monthLabel: mode === 'monthly' ? formatMonthLabelId(pdfMonth) : undefined,
        exportedBy: session.user || 'Owner',
        rows: res.rows || [],
        salesGroups: res.salesGroups || [],
        salesCategories: res.salesCategories || [],
      });
      onToast(`File PDF berhasil diunduh: ${filename}`, 'ok');
      setPdfModalOpen(false);
    } catch (err) {
      onToast((err as Error).message || 'Gagal membuat file PDF', 'err');
    } finally {
      setExportingPdf(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Segmented Report Tabs */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        {visibleTabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              setShowCatDetail(false);
            }}
            className={`shrink-0 min-h-[42px] px-4 rounded-xl border text-sm font-semibold whitespace-nowrap transition-colors ${
              tab === id
                ? 'bg-red-600 border-red-600 text-white shadow-sm shadow-red-600/20'
                : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter Card */}
      {tab !== 'stock' && (
        <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {(
              [
                ['today', 'Hari ini'],
                ['week', 'Minggu ini'],
                ['month', 'Bulan ini'],
              ] as const
            ).map(([preset, label]) => (
              <button
                key={preset}
                type="button"
                onClick={() => applyPreset(preset)}
                className="min-h-[38px] px-3.5 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-xs font-semibold"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Dari Tanggal
              </label>
              <input
                type="date"
                value={dari}
                onChange={(e) => setDari(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 dark:text-zinc-300 mb-1">
                Sampai Tanggal
              </label>
              <input
                type="date"
                value={sampai}
                onChange={(e) => setSampai(e.target.value)}
                className="w-full min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
              />
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => runReport(tab, dari, sampai)}
              className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold shadow-sm shadow-red-600/20"
            >
              {loading ? 'Memuat...' : 'Tampilkan'}
            </button>
          </div>
        </div>
      )}

      {/* Visualisasi Persentase & Tren Omset Kategori (Khusus Laporan Penjualan) */}
      {tab === 'sales' && report && report.salesGroups && report.salesGroups.length > 0 && (
        <SalesCategoryCharts
          groups={report.salesGroups}
          trend={report.salesTrend || []}
          totalOmset={report.totalOmset || 0}
        />
      )}

      {/* Perbandingan Penjualan Bulanan (Month-over-Month) */}
      {tab === 'sales' && (
        <SalesMomComparison
          data={momData}
          loading={momLoading}
          bulan={momBulan}
          monthsWindow={momMonthsWindow}
          onBulanChange={setMomBulan}
          onMonthsWindowChange={setMomMonthsWindow}
        />
      )}

      {/* Output Card */}
      <div className="rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm shadow-zinc-900/[0.03] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-zinc-900 dark:text-white">
            Laporan {tabTitle}
          </h2>
          <div className="flex flex-wrap gap-2">
            {isOwner && tab === 'sales' && (
              <button
                type="button"
                onClick={() => setPdfModalOpen(true)}
                className="min-h-[40px] px-3.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm shadow-red-600/20"
              >
                <FileText className="w-4 h-4" /> Ekspor PDF
              </button>
            )}
            <button
              type="button"
              disabled={!report}
              onClick={handleExportCsv}
              className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5"
            >
              <Download className="w-4 h-4" /> Ekspor CSV
            </button>
            <button
              type="button"
              disabled={!report}
              onClick={handlePrint}
              className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold flex items-center gap-1.5"
            >
              <Printer className="w-4 h-4" /> Cetak
            </button>
          </div>
        </div>

        {loading && !report ? (
          <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Loader2 className="w-6 h-6 animate-spin text-red-600" />
            <span className="text-xs font-medium">Memuat laporan {tabTitle}...</span>
          </div>
        ) : !report ? (
          <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            Data laporan belum tersedia. Tekan Tampilkan untuk memuat ulang.
          </div>
        ) : (
          <div className={`space-y-6 transition-opacity ${loading ? 'opacity-60' : 'opacity-100'}`}>
            {/* Sales Group Revenue Breakdown (only in Laporan Penjualan) */}
            {tab === 'sales' && report.salesGroups && report.salesGroups.length > 0 && (
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/50 p-4 space-y-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-zinc-900 dark:text-white">
                      Catatan Kelompok Penjualan
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Pembagian omset berdasarkan jenis barang terjual pada periode ini.
                    </p>
                  </div>
                  <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300 font-data">
                    Total Omset:{' '}
                    <span className="text-sm font-extrabold text-red-600 dark:text-red-400">
                      {rp(report.totalOmset || 0)}
                    </span>
                  </div>
                </div>

                <div className="divide-y divide-zinc-200/80 dark:divide-zinc-800">
                  {report.salesGroups.map((g) => {
                    const total = report.totalOmset || 0;
                    const pct = total > 0 ? Math.round((g.omset / total) * 100) : 0;
                    return (
                      <div key={g.group} className="py-2.5 first:pt-1 last:pb-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-zinc-900 dark:text-white">
                              {g.label}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 leading-snug break-words [overflow-wrap:anywhere]">
                              {g.qty > 0 || g.notaCount > 0 ? (
                                <>
                                  <span className="font-data">{g.qty} item terjual</span>
                                  <span aria-hidden="true"> · </span>
                                  <span className="font-data">{g.notaCount} nota</span>
                                  {g.categories.length > 0 && (
                                    <>
                                      <span aria-hidden="true"> · </span>
                                      <span>{g.categories.join(', ')}</span>
                                    </>
                                  )}
                                </>
                              ) : (
                                <span>Belum ada penjualan pada periode ini</span>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0 whitespace-nowrap">
                            <div className="text-sm font-extrabold font-data text-zinc-900 dark:text-white">
                              {rp(g.omset)}
                            </div>
                            <div className="text-[11px] font-medium font-data text-zinc-500 dark:text-zinc-400">
                              {pct}% dari omset
                            </div>
                          </div>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-zinc-200/80 dark:bg-zinc-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              g.omset > 0 ? 'bg-red-600 dark:bg-red-500' : 'bg-transparent'
                            }`}
                            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>

                {report.salesCategories && report.salesCategories.length > 0 && (
                  <div className="pt-2 border-t border-zinc-200/80 dark:border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setShowCatDetail((v) => !v)}
                      className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline inline-flex items-center gap-1"
                    >
                      {showCatDetail ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                      {showCatDetail
                        ? 'Sembunyikan rincian kategori produk'
                        : `Lihat rincian per kategori produk (${report.salesCategories.length})`}
                    </button>

                    {showCatDetail && (
                      <div className="mt-2.5 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                              <th className="py-1.5 pr-3 text-left font-semibold">Kategori</th>
                              <th className="py-1.5 px-2 text-left font-semibold">Kelompok</th>
                              <th className="py-1.5 px-2 text-right font-semibold">Qty</th>
                              <th className="py-1.5 px-2 text-right font-semibold">Nota</th>
                              <th className="py-1.5 pl-2 text-right font-semibold">Omset</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-200/60 dark:divide-zinc-800/80">
                            {report.salesCategories.map((c) => (
                              <tr key={`${c.group}-${c.kategori}`}>
                                <td className="py-1.5 pr-3 font-medium text-zinc-800 dark:text-zinc-200 break-words [overflow-wrap:anywhere]">
                                  {c.kategori}
                                </td>
                                <td className="py-1.5 px-2 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                                  {c.group}
                                </td>
                                <td className="py-1.5 px-2 text-right font-data whitespace-nowrap">
                                  {c.qty}
                                </td>
                                <td className="py-1.5 px-2 text-right font-data whitespace-nowrap">
                                  {c.notaCount}
                                </td>
                                <td className="py-1.5 pl-2 text-right font-data font-bold text-zinc-900 dark:text-white whitespace-nowrap">
                                  {rp(c.omset)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Desktop / Tablet Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                    {report.cols.map(([label, align], i) => (
                      <th
                        key={i}
                        className={`py-2.5 px-3 font-semibold whitespace-nowrap ${
                          align === 't' ? 'text-left' : 'text-right'
                        }`}
                      >
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {report.rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={report.cols.length}
                        className="py-8 text-center text-zinc-500"
                      >
                        Tidak ada data pada rentang ini.
                      </td>
                    </tr>
                  ) : (
                    report.rows.map((row, rIdx) => {
                      const isEmptyStockRow = tab === 'stock' && Number(row[2]) <= 0;
                      return (
                        <tr
                          key={rIdx}
                          className={
                            isEmptyStockRow
                              ? 'bg-rose-50/90 dark:bg-rose-950/35 hover:bg-rose-100/80 dark:hover:bg-rose-950/50'
                              : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                          }
                        >
                          {row.map((val, cIdx) => {
                            const align = report.cols[cIdx][1];
                            const isProfitRow = tab === 'profit' && rIdx === report.rows.length - 1;
                            const isEmptyStockCell =
                              isEmptyStockRow && (cIdx === 1 || cIdx === 2);
                            return (
                              <td
                                key={cIdx}
                                className={`py-2.5 px-3 whitespace-nowrap ${
                                  align === 't' ? 'text-left' : 'text-right font-data'
                                } ${
                                  isProfitRow
                                    ? 'font-extrabold text-base text-red-600 dark:text-red-400'
                                    : isEmptyStockCell
                                      ? 'font-semibold text-rose-700 dark:text-rose-300'
                                      : ''
                                }`}
                              >
                                {formatCell(val, align)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {report.foot && (
                  <tfoot>
                    <tr className="border-t-2 border-zinc-200 dark:border-zinc-700 font-bold">
                      {report.foot.map((val, cIdx) => {
                        const align = report.cols[cIdx][1];
                        return (
                          <td
                            key={cIdx}
                            className={`py-3 px-3 whitespace-nowrap ${
                              align === 't' ? 'text-left' : 'text-right font-data'
                            }`}
                          >
                            {formatCell(val, align)}
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            {/* Mobile Card List */}
            <div className="md:hidden space-y-3">
              {report.rows.length === 0 ? (
                <div className="py-8 text-center text-sm text-zinc-500">
                  Tidak ada data pada rentang ini.
                </div>
              ) : tab === 'profit' ? (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {report.rows.map((row, rIdx) => {
                    const isLast = rIdx === report.rows.length - 1;
                    return (
                      <div
                        key={rIdx}
                        className={`py-3 flex items-center justify-between gap-3 ${
                          isLast ? 'font-extrabold text-base pt-3.5' : 'text-sm'
                        }`}
                      >
                        <span className="text-zinc-700 dark:text-zinc-200">{String(row[0])}</span>
                        <span
                          className={`font-data font-bold shrink-0 ${
                            isLast
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-zinc-900 dark:text-white'
                          }`}
                        >
                          {rp(Number(row[1]))}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {report.rows.map((row, rIdx) => {
                    const lastIdx = row.length - 1;
                    const lastAlign = report.cols[lastIdx]?.[1] || 'r';
                    const isEmptyStockRow = tab === 'stock' && Number(row[2]) <= 0;
                    return (
                      <div
                        key={rIdx}
                        className={`py-3 px-2 -mx-2 rounded-lg flex items-start justify-between gap-3 ${
                          isEmptyStockRow ? 'bg-rose-50/90 dark:bg-rose-950/35' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div
                            className={`text-sm font-semibold leading-snug break-words [overflow-wrap:anywhere] ${
                              isEmptyStockRow
                                ? 'text-rose-700 dark:text-rose-300'
                                : 'text-zinc-900 dark:text-white'
                            }`}
                          >
                            {tab === 'stock'
                              ? String(row[1])
                              : tab === 'expense'
                                ? String(row[2])
                                : String(row[2])}
                          </div>
                          <div className="text-xs text-zinc-500 dark:text-zinc-400 font-data leading-snug break-words [overflow-wrap:anywhere]">
                            {tab === 'stock'
                              ? `${row[0]} · Stok ${row[2]} · HPP ${rp(Number(row[3]))}`
                              : tab === 'expense'
                                ? `${row[1]} · ${row[3] !== '-' ? row[3] : row[0]}`
                                : tab === 'sales'
                                  ? `${row[0]} · ${row[1]} · ${row[3]}`
                                  : `${row[0]} · ${row[1]}`}
                          </div>
                        </div>
                        <div className="font-data font-bold text-sm text-zinc-900 dark:text-white shrink-0 whitespace-nowrap">
                          {formatCell(row[lastIdx], lastAlign)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {report.foot && (
                <div className="pt-3 border-t-2 border-zinc-200 dark:border-zinc-700 flex items-center justify-between text-sm font-bold">
                  <span>{String(report.foot[0] || 'Total')}</span>
                  <span className="font-data text-base text-red-600 dark:text-red-400">
                    {formatCell(
                      report.foot[report.foot.length - 1],
                      report.cols[report.cols.length - 1]?.[1] || 'r',
                    )}
                  </span>
                </div>
              )}
            </div>

            {report.sum && report.sum.rows.length > 0 && (
              <div className="pt-2">
                <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                  Ringkasan
                </h3>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400">
                        {report.sum.cols.map(([label, align], i) => (
                          <th
                            key={i}
                            className={`py-2 px-3 font-semibold whitespace-nowrap ${
                              align === 't' ? 'text-left' : 'text-right'
                            }`}
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                      {report.sum.rows.map((row, rIdx) => (
                        <tr key={rIdx} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                          {row.map((val, cIdx) => {
                            const align = report.sum!.cols[cIdx][1];
                            return (
                              <td
                                key={cIdx}
                                className={`py-2 px-3 whitespace-nowrap ${
                                  align === 't' ? 'text-left' : 'text-right font-data font-semibold'
                                }`}
                              >
                                {formatCell(val, align)}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden divide-y divide-zinc-100 dark:divide-zinc-800">
                  {report.sum.rows.map((row, rIdx) => (
                    <div key={rIdx} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-zinc-900 dark:text-white truncate">
                          {String(row[0])}
                        </div>
                        <div className="text-xs text-zinc-500 dark:text-zinc-400 font-data">
                          {String(row[1])} nota
                        </div>
                      </div>
                      <div className="font-data font-bold text-sm text-zinc-900 dark:text-white shrink-0">
                        {rp(Number(row[2]))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {pdfModalOpen && isOwner && (
        <Modal
          title="Ekspor Laporan Penjualan (PDF)"
          onClose={() => {
            if (!exportingPdf) setPdfModalOpen(false);
          }}
          maxWidth="max-w-md"
        >
          <div className="space-y-4">
            <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
              Unduh laporan penjualan berformat PDF A4 lengkap dengan ringkasan omset, catatan kelompok
              (LCD, Sparepart, Aksesoris), rincian kategori, dan daftar nota transaksi.
            </p>

            {/* Daily PDF Export */}
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <div className="text-xs font-bold text-zinc-900 dark:text-white">
                1. Laporan Penjualan Harian
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="date"
                  value={pdfDay}
                  disabled={exportingPdf !== null}
                  onChange={(e) => setPdfDay(e.target.value)}
                  aria-label="Tanggal laporan harian"
                  className="flex-1 min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <button
                  type="button"
                  disabled={exportingPdf !== null}
                  onClick={() => handleExportSalesPdf('daily')}
                  className="min-h-[42px] px-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-xs font-semibold whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {exportingPdf === 'daily' ? 'Membuat PDF...' : 'Unduh PDF Harian'}
                </button>
              </div>
            </div>

            {/* Monthly PDF Export */}
            <div className="p-3.5 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2.5">
              <div className="text-xs font-bold text-zinc-900 dark:text-white">
                2. Laporan Penjualan Bulanan
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="month"
                  value={pdfMonth}
                  disabled={exportingPdf !== null}
                  onChange={(e) => setPdfMonth(e.target.value)}
                  aria-label="Bulan laporan bulanan"
                  className="flex-1 min-h-[42px] px-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-sm focus:outline-none focus:ring-2 focus:ring-red-600"
                />
                <button
                  type="button"
                  disabled={exportingPdf !== null}
                  onClick={() => handleExportSalesPdf('monthly')}
                  className="min-h-[42px] px-4 rounded-xl bg-zinc-900 dark:bg-white hover:bg-zinc-800 dark:hover:bg-zinc-100 disabled:opacity-60 text-white dark:text-zinc-900 text-xs font-semibold whitespace-nowrap flex items-center justify-center gap-1.5"
                >
                  <FileText className="w-3.5 h-3.5" />
                  {exportingPdf === 'monthly' ? 'Membuat PDF...' : 'Unduh PDF Bulanan'}
                </button>
              </div>
            </div>

            {/* Current Filter Range PDF Export */}
            <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                Periode aktif: <strong className="text-zinc-700 dark:text-zinc-200">{fmtDate(dari)}</strong> s/d{' '}
                <strong className="text-zinc-700 dark:text-zinc-200">{fmtDate(sampai)}</strong>
              </div>
              <button
                type="button"
                disabled={exportingPdf !== null}
                onClick={() => handleExportSalesPdf('range')}
                className="min-h-[40px] px-3.5 rounded-xl border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-60 text-xs font-semibold flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                {exportingPdf === 'range' ? 'Membuat PDF...' : 'Unduh PDF Periode Ini'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
