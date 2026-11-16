import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { STORE_NAME } from '../constants/branding';
import type { SalesCategorySummary, SalesGroupSummary } from '../types/pos';
import { fmtDate, rp } from './format';

export interface SalesPdfPayload {
  mode: 'daily' | 'monthly' | 'range';
  dari: string;
  sampai: string;
  monthLabel?: string;
  exportedBy: string;
  rows: {
    no: string;
    tgl: string;
    pihak: string;
    kelompok?: string;
    total: number;
  }[];
  salesGroups: SalesGroupSummary[];
  salesCategories: SalesCategorySummary[];
}

function getAutoTableFinalY(doc: jsPDF, fallback: number): number {
  const withLast = doc as jsPDF & { lastAutoTable?: { finalY?: number } };
  return typeof withLast.lastAutoTable?.finalY === 'number'
    ? withLast.lastAutoTable.finalY
    : fallback;
}

export function formatMonthLabelId(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr);
  const monthIdx = Number(mStr) - 1;
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember',
  ];
  if (!Number.isFinite(year) || monthIdx < 0 || monthIdx > 11) return ym;
  return `${months[monthIdx]} ${year}`;
}

export function exportSalesReportPdf(payload: SalesPdfPayload): string {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2;

  const totalOmset = payload.rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const totalQty = payload.salesGroups.reduce((sum, g) => sum + (Number(g.qty) || 0), 0);

  const reportTitle =
    payload.mode === 'daily'
      ? 'Laporan Penjualan Harian'
      : payload.mode === 'monthly'
        ? 'Laporan Penjualan Bulanan'
        : 'Laporan Penjualan';

  const periodText =
    payload.mode === 'daily'
      ? `Tanggal: ${fmtDate(payload.dari)}`
      : payload.mode === 'monthly'
        ? `Bulan: ${payload.monthLabel || formatMonthLabelId(payload.dari.slice(0, 7))} (${fmtDate(payload.dari)} s/d ${fmtDate(payload.sampai)})`
        : `Periode: ${fmtDate(payload.dari)} s/d ${fmtDate(payload.sampai)}`;

  const printedAt = new Date().toLocaleString('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  // Top crimson accent bar
  doc.setFillColor(220, 38, 38);
  doc.rect(0, 0, pageWidth, 4, 'F');

  // Header left: Store & Report title
  doc.setTextColor(24, 24, 27);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(STORE_NAME, marginX, 14);

  doc.setFontSize(11);
  doc.setTextColor(220, 38, 38);
  doc.text(reportTitle, marginX, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(82, 82, 91);
  doc.text(periodText, marginX, 25.5);

  // Header right: Owner & timestamp
  doc.setFontSize(8.5);
  doc.text(`Dicetak oleh: ${payload.exportedBy} (Owner)`, pageWidth - marginX, 14, {
    align: 'right',
  });
  doc.text(`Waktu cetak: ${printedAt}`, pageWidth - marginX, 19.5, { align: 'right' });

  doc.setDrawColor(228, 228, 231);
  doc.setLineWidth(0.3);
  doc.line(marginX, 29, pageWidth - marginX, 29);

  // KPI Summary Boxes (3 equal columns)
  const boxTop = 33;
  const boxHeight = 16;
  const boxGap = 4;
  const boxWidth = (contentWidth - boxGap * 2) / 3;
  const summaryBoxes = [
    { label: 'Total Omset Penjualan', value: rp(totalOmset), accent: true },
    { label: 'Jumlah Transaksi', value: `${payload.rows.length} nota`, accent: false },
    { label: 'Total Item Terjual', value: `${totalQty} item`, accent: false },
  ];

  summaryBoxes.forEach((box, idx) => {
    const x = marginX + idx * (boxWidth + boxGap);
    doc.setFillColor(250, 250, 250);
    doc.setDrawColor(228, 228, 231);
    doc.roundedRect(x, boxTop, boxWidth, boxHeight, 2, 2, 'FD');

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(113, 113, 122);
    doc.text(box.label, x + 3.5, boxTop + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    if (box.accent) {
      doc.setTextColor(220, 38, 38);
    } else {
      doc.setTextColor(24, 24, 27);
    }
    doc.text(box.value, x + 3.5, boxTop + 12.5);
  });

  let cursorY = boxTop + boxHeight + 8;

  // Section 1: Catatan Kelompok Penjualan
  if (payload.salesGroups.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(24, 24, 27);
    doc.text('Catatan Kelompok Penjualan', marginX, cursorY);

    autoTable(doc, {
      startY: cursorY + 2.5,
      margin: { left: marginX, right: marginX },
      head: [['Kelompok Penjualan', 'Kategori Produk', 'Qty', 'Nota', 'Porsi', 'Omset']],
      body: payload.salesGroups.map((g) => {
        const pct = totalOmset > 0 ? Math.round((g.omset / totalOmset) * 100) : 0;
        return [
          g.label,
          g.categories.length > 0 ? g.categories.join(', ') : '-',
          String(g.qty),
          String(g.notaCount),
          `${pct}%`,
          rp(g.omset),
        ];
      }),
      foot: [['Total Omset', '', String(totalQty), String(payload.rows.length), '100%', rp(totalOmset)]],
      styles: {
        fontSize: 8.5,
        cellPadding: 2.5,
        textColor: [24, 24, 27],
        lineColor: [228, 228, 231],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [24, 24, 27],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      footStyles: {
        fillColor: [244, 244, 245],
        textColor: [24, 24, 27],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 38, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 14 },
        3: { halign: 'right', cellWidth: 14 },
        4: { halign: 'right', cellWidth: 16 },
        5: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
      },
    });

    cursorY = getAutoTableFinalY(doc, cursorY + 30) + 8;
  }

  // Section 2: Rincian per Kategori Produk (if available)
  if (payload.salesCategories.length > 0) {
    if (cursorY > pageHeight - 40) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(24, 24, 27);
    doc.text('Rincian per Kategori Produk', marginX, cursorY);

    autoTable(doc, {
      startY: cursorY + 2.5,
      margin: { left: marginX, right: marginX },
      head: [['Kategori', 'Kelompok', 'Qty', 'Nota', 'Omset']],
      body: payload.salesCategories.map((c) => [
        c.kategori,
        c.group,
        String(c.qty),
        String(c.notaCount),
        rp(c.omset),
      ]),
      styles: {
        fontSize: 8.5,
        cellPadding: 2.2,
        textColor: [24, 24, 27],
        lineColor: [228, 228, 231],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [63, 63, 70],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { cellWidth: 32 },
        2: { halign: 'right', cellWidth: 16 },
        3: { halign: 'right', cellWidth: 16 },
        4: { halign: 'right', cellWidth: 34, fontStyle: 'bold' },
      },
    });

    cursorY = getAutoTableFinalY(doc, cursorY + 25) + 8;
  }

  // Section 3: Daftar Transaksi Penjualan
  if (cursorY > pageHeight - 45) {
    doc.addPage();
    cursorY = 16;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(24, 24, 27);
  doc.text('Daftar Transaksi Penjualan', marginX, cursorY);

  autoTable(doc, {
    startY: cursorY + 2.5,
    margin: { left: marginX, right: marginX },
    head: [['No. Nota', 'Tanggal', 'Konsumen', 'Kelompok', 'Total']],
    body:
      payload.rows.length > 0
        ? payload.rows.map((r) => [
            r.no,
            fmtDate(r.tgl),
            r.pihak || 'Umum',
            r.kelompok || '-',
            rp(r.total),
          ])
        : [['-', '-', 'Tidak ada transaksi penjualan pada periode ini.', '-', 'Rp 0']],
    foot: [['Total', '', `${payload.rows.length} nota`, '', rp(totalOmset)]],
    styles: {
      fontSize: 8.5,
      cellPadding: 2.2,
      textColor: [24, 24, 27],
      lineColor: [228, 228, 231],
      lineWidth: 0.2,
    },
    headStyles: {
      fillColor: [220, 38, 38],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
    },
    footStyles: {
      fillColor: [244, 244, 245],
      textColor: [24, 24, 27],
      fontStyle: 'bold',
    },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 26 },
      2: { cellWidth: 40 },
      3: { cellWidth: 'auto' },
      4: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
    },
  });

  cursorY = getAutoTableFinalY(doc, cursorY + 30) + 8;

  // Section 4: Ringkasan per Konsumen
  if (payload.rows.length > 0) {
    const grouped: Record<string, [number, number]> = {};
    payload.rows.forEach((x) => {
      const key = x.pihak || 'Umum';
      if (!grouped[key]) grouped[key] = [0, 0];
      grouped[key][0] += 1;
      grouped[key][1] += x.total;
    });
    const consumerRows = Object.entries(grouped)
      .sort((a, b) => b[1][1] - a[1][1])
      .map(([k, v]) => [k, String(v[0]), rp(v[1])]);

    if (cursorY > pageHeight - 40) {
      doc.addPage();
      cursorY = 16;
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(24, 24, 27);
    doc.text('Ringkasan per Konsumen', marginX, cursorY);

    autoTable(doc, {
      startY: cursorY + 2.5,
      margin: { left: marginX, right: marginX },
      head: [['Konsumen', 'Jumlah Nota', 'Total']],
      body: consumerRows,
      styles: {
        fontSize: 8.5,
        cellPadding: 2.2,
        textColor: [24, 24, 27],
        lineColor: [228, 228, 231],
        lineWidth: 0.2,
      },
      headStyles: {
        fillColor: [63, 63, 70],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
      },
      columnStyles: {
        0: { cellWidth: 'auto', fontStyle: 'bold' },
        1: { halign: 'right', cellWidth: 28 },
        2: { halign: 'right', cellWidth: 36, fontStyle: 'bold' },
      },
    });
  }

  // Page numbering footer on all pages
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(113, 113, 122);
    doc.text(`${STORE_NAME} · Arsip Laporan Penjualan`, marginX, pageHeight - 8);
    doc.text(`Halaman ${i} dari ${pageCount}`, pageWidth - marginX, pageHeight - 8, {
      align: 'right',
    });
  }

  const filename =
    payload.mode === 'daily'
      ? `laporan-penjualan-harian-${payload.dari}.pdf`
      : payload.mode === 'monthly'
        ? `laporan-penjualan-bulanan-${payload.dari.slice(0, 7)}.pdf`
        : `laporan-penjualan-${payload.dari}_sd_${payload.sampai}.pdf`;

  doc.save(filename);
  return filename;
}
