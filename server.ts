import 'dotenv/config';
import path from 'node:path';
import express, { type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import { requireAuth, type AuthRequest } from './src/middleware/auth.ts';
import { signSessionToken } from './src/lib/session-token.ts';
import {
  AuthError,
  authenticateWithCredentials,
  deleteDbUser,
  isAuthInitialized,
  listDbUsers,
  registerInitialOwner,
  saveDbUser,
  type DbUserRecord,
} from './src/db/users.ts';
import {
  PosDomainError,
  adjustDbStock,
  cancelDbTransaction,
  createDbBackup,
  deleteDbExpense,
  deleteDbMaster,
  deleteDbProduct,
  deleteOldDbBackups,
  ensureDefaultMasterSeeded,
  exportDbBackupById,
  exportDbJson,
  getDbAutoBackupConfig,
  getDbDashboard,
  getDbExpenses,
  getDbGlobalSearchTransactions,
  getDbMaster,
  getDbProducts,
  getDbStoreQris,
  getDbTransactionNote,
  getDbTransactionsByDate,
  importDbJson,
  importDbProducts,
  listDbBackups,
  reportDbExpenses,
  reportDbProfit,
  reportDbSalesComparison,
  reportDbSalesOrPurchases,
  reportDbStock,
  restoreDbBackup,
  runAutoBackupIfDue,
  saveDbAutoBackupConfig,
  saveDbExpense,
  saveDbMaster,
  saveDbProduct,
  saveDbStoreQris,
  saveDbTransaction,
} from './src/db/pos.ts';
import type { PageId } from './src/types/pos.ts';

const PORT = Number(process.env.PORT) || 3000;

interface MarketInfoBody {
  kode?: string;
  productName?: string;
  category?: string;
  tipe?: string;
  currentHpp?: number;
  harga?: number;
  hargaA?: number;
  hargaMin?: number;
  forceRefresh?: boolean;
}

interface GroundingSource {
  title: string;
  uri: string;
}

interface MarketInfoPayload {
  summary: string;
  sources: GroundingSource[];
  queries: string[];
  fallback?: boolean;
  notice?: string;
}

const MARKET_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const marketInfoCache = new Map<string, { expiresAt: number; payload: MarketInfoPayload }>();

function getAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });
}

function buildSearchKeyword(productName: string, tipe: string): string {
  const cleanName = productName.replace(/[/\\]+/g, ' ').replace(/\s+/g, ' ').trim();
  const shortWords = cleanName.split(' ').slice(0, 7).join(' ');
  if (tipe && !cleanName.toLowerCase().includes(tipe.toLowerCase())) {
    return `${shortWords} ${tipe}`.trim();
  }
  return shortWords;
}

function formatRpServer(val: number): string {
  return `Rp ${Math.round(val).toLocaleString('id-ID')}`;
}

function buildMarketFallback(params: {
  productName: string;
  category: string;
  tipe: string;
  isOwner: boolean;
  currentHpp: number;
  harga: number;
  hargaA: number;
  hargaMin: number;
  notice: string;
}): MarketInfoPayload {
  const keyword = buildSearchKeyword(params.productName, params.tipe);
  const enc = encodeURIComponent(keyword);

  const lines: string[] = [];
  if (params.isOwner && params.currentHpp > 0) {
    const marginUmum = params.harga > 0 ? params.harga - params.currentHpp : 0;
    const pctUmum = params.harga > 0 ? Math.round((marginUmum / params.currentHpp) * 100) : 0;
    lines.push(
      `1. **Acuan Modal (HPP) Toko**: **${formatRpServer(params.currentHpp)}**${
        params.harga > 0
          ? ` dengan harga jual umum **${formatRpServer(params.harga)}** (margin ${formatRpServer(marginUmum)} / ~${pctUmum}%).`
          : '.'
      }`,
    );
  } else if (params.harga > 0) {
    lines.push(`1. **Harga Jual Toko Saat Ini**: Umum **${formatRpServer(params.harga)}**${params.hargaA > 0 ? `, Toko **${formatRpServer(params.hargaA)}**` : ''}.`);
  }

  if (params.isOwner && params.hargaA > 0 && params.currentHpp > 0) {
    lines.push(
      `2. **Batas Harga Grosir/Toko**: Harga Toko saat ini **${formatRpServer(params.hargaA)}**${
        params.hargaMin > 0 ? ` dan batas minimal **${formatRpServer(params.hargaMin)}**` : ''
      }. Pastikan penawaran supplier baru di bawah atau setara HPP (${formatRpServer(params.currentHpp)}).`,
    );
  } else {
    lines.push(
      `2. **Kata Kunci Pencarian Disarankan**: **${keyword}**${
        params.category ? ` (Kategori: ${params.category})` : ''
      }.`,
    );
  }

  lines.push(
    '3. **Cek Harga Langsung**: Klik tautan marketplace di bawah untuk membandingkan harga grosir dan stok terbaru secara langsung.',
  );

  return {
    summary: lines.join('\n'),
    sources: [
      {
        title: `Cari "${keyword}" di Tokopedia`,
        uri: `https://www.tokopedia.com/search?st=product&q=${enc}`,
      },
      {
        title: `Cari "${keyword}" di Shopee`,
        uri: `https://shopee.co.id/search?keyword=${enc}`,
      },
      {
        title: `Cari "${keyword}" di Lazada`,
        uri: `https://www.lazada.co.id/catalog/?q=${enc}`,
      },
      {
        title: `Cari harga grosir di Google`,
        uri: `https://www.google.com/search?q=${encodeURIComponent(`${keyword} harga grosir`)}`,
      },
    ],
    queries: [keyword],
    fallback: true,
    notice: params.notice,
  };
}

function hasPagePerm(user: DbUserRecord, page: PageId): boolean {
  if (user.role === 'owner' || user.perms === '*') return true;
  return Array.isArray(user.perms) && user.perms.includes(page);
}

function requireOwner(user: DbUserRecord): void {
  if (user.role !== 'owner') {
    throw new PosDomainError('Hanya owner yang boleh mengakses fitur ini', 403);
  }
}

function requirePerm(user: DbUserRecord, page: PageId): void {
  if (!hasPagePerm(user, page)) {
    throw new PosDomainError('Anda tidak memiliki akses ke fitur ini', 403);
  }
}

function sendPosError(res: Response, err: unknown) {
  if (err instanceof PosDomainError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }
  const message =
    err instanceof Error && err.message
      ? err.message
      : 'Terjadi kesalahan pada server.';
  res.status(500).json({ error: message });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Lightweight connectivity health check (no-store so intermittent drops are detected accurately)
  app.get('/api/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json({ ok: true, ts: Date.now() });
  });

  // Check if initial owner setup has already been completed
  app.get('/api/auth/status', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    const initialized = await isAuthInitialized();
    res.json({ initialized });
  });

  // One-time initial Owner setup (only allowed when no active password account exists yet)
  app.post('/api/auth/setup', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        email?: string;
        username?: string;
        password?: string;
        deviceType?: 'mobile' | 'desktop';
      };
      const dbUser = await registerInitialOwner(body);
      await ensureDefaultMasterSeeded();
      const deviceType: 'mobile' | 'desktop' = body.deviceType === 'desktop' ? 'desktop' : 'mobile';
      const { token, expiresAt } = await signSessionToken(dbUser.id, dbUser.email, deviceType);
      res.json({
        token,
        expiresAt,
        deviceType,
        user: dbUser.username,
        email: dbUser.email,
        role: dbUser.role === 'owner' ? 'owner' : 'admin',
        perms: dbUser.perms === '*' ? '*' : dbUser.perms,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      sendPosError(res, err);
    }
  });

  // Username + Password login (20-minute mobile idle TTL, persistent on desktop)
  app.post('/api/auth/login', async (req, res) => {
    try {
      const body = (req.body || {}) as {
        email?: string;
        username?: string;
        password?: string;
        deviceType?: 'mobile' | 'desktop';
      };
      const dbUser = await authenticateWithCredentials(body);
      await ensureDefaultMasterSeeded();
      const deviceType: 'mobile' | 'desktop' = body.deviceType === 'desktop' ? 'desktop' : 'mobile';
      const { token, expiresAt } = await signSessionToken(dbUser.id, dbUser.email, deviceType);
      res.json({
        token,
        expiresAt,
        deviceType,
        user: dbUser.username,
        email: dbUser.email,
        role: dbUser.role === 'owner' ? 'owner' : 'admin',
        perms: dbUser.perms === '*' ? '*' : dbUser.perms,
      });
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      sendPosError(res, err);
    }
  });

  // Authenticated session bootstrap / sync (Google Sign-In)
  app.post('/api/auth/session', requireAuth, async (req: AuthRequest, res) => {
    try {
      await ensureDefaultMasterSeeded();
      const dbUser = req.dbUser!;
      res.json({
        user: dbUser.username,
        email: dbUser.email,
        role: dbUser.role === 'owner' ? 'owner' : 'admin',
        perms: dbUser.perms === '*' ? '*' : dbUser.perms,
      });
    } catch (err) {
      sendPosError(res, err);
    }
  });

  // Main PostgreSQL POS API dispatcher
  app.post('/api/pos', requireAuth, async (req: AuthRequest, res) => {
    const dbUser = req.dbUser!;
    const isOwner = dbUser.role === 'owner';
    const action = String(req.body?.action || '').trim();
    const data =
      req.body?.data && typeof req.body.data === 'object'
        ? (req.body.data as Record<string, unknown>)
        : {};

    try {
      let result: unknown;

      switch (action) {
        case 'logout':
          result = true;
          break;

        case 'dashboard':
          runAutoBackupIfDue(false).catch(() => {});
          result = await getDbDashboard();
          break;

        case 'getProducts':
          result = await getDbProducts(isOwner);
          break;

        case 'saveProduct':
          requirePerm(dbUser, 'product');
          result = await saveDbProduct(data, isOwner);
          break;

        case 'deleteProduct':
          requirePerm(dbUser, 'product');
          result = await deleteDbProduct(String(data.kode || ''));
          break;

        case 'adjustStock':
          requirePerm(dbUser, 'product');
          result = await adjustDbStock(String(data.kode || ''), data.delta, data.alasan);
          break;

        case 'importProducts':
          requirePerm(dbUser, 'product');
          result = await importDbProducts(data.rows, data.offset, isOwner);
          break;

        case 'getMaster':
          result = await getDbMaster(data.t);
          break;

        case 'saveMaster':
          requirePerm(dbUser, 'master');
          result = await saveDbMaster(data.t, data.nama, data.id);
          break;

        case 'deleteMaster':
          requirePerm(dbUser, 'master');
          result = await deleteDbMaster(data.t, data.id);
          break;

        case 'saveSale':
          requirePerm(dbUser, 'sales');
          result = await saveDbTransaction('sales', data, dbUser);
          break;

        case 'savePurchase':
          requirePerm(dbUser, 'purchase');
          result = await saveDbTransaction('purchase', data, dbUser);
          break;

        case 'cancelSale':
          requireOwner(dbUser);
          result = await cancelDbTransaction('sales', data.no, data.alasan);
          break;

        case 'cancelPurchase':
          requireOwner(dbUser);
          result = await cancelDbTransaction('purchase', data.no, data.alasan);
          break;

        case 'getSales':
          requirePerm(dbUser, 'sales');
          result = await getDbTransactionsByDate('sales', data.tgl);
          break;

        case 'getPurchases':
          requirePerm(dbUser, 'purchase');
          result = await getDbTransactionsByDate('purchase', data.tgl);
          break;

        case 'getSale':
          result = await getDbTransactionNote('sales', data.no);
          break;

        case 'getPurchase':
          requirePerm(dbUser, 'purchase');
          result = await getDbTransactionNote('purchase', data.no);
          break;

        case 'searchGlobalTransactions': {
          const allowedKinds: ('sales' | 'purchase')[] = [];
          if (hasPagePerm(dbUser, 'sales') || hasPagePerm(dbUser, 'report') || isOwner) {
            allowedKinds.push('sales');
          }
          if (hasPagePerm(dbUser, 'purchase') || hasPagePerm(dbUser, 'report') || isOwner) {
            allowedKinds.push('purchase');
          }
          result = await getDbGlobalSearchTransactions(allowedKinds, 600);
          break;
        }

        case 'getExpenses':
          requirePerm(dbUser, 'expense');
          result = await getDbExpenses(data.dari, data.sampai);
          break;

        case 'saveExpense':
          requirePerm(dbUser, 'expense');
          result = await saveDbExpense(data, dbUser);
          break;

        case 'deleteExpense':
          requirePerm(dbUser, 'expense');
          result = await deleteDbExpense(data.nomor);
          break;

        case 'reportSales':
          requirePerm(dbUser, 'report');
          result = await reportDbSalesOrPurchases('sales', data.dari, data.sampai);
          break;

        case 'reportSalesComparison':
          requirePerm(dbUser, 'report');
          result = await reportDbSalesComparison(data.bulan, data.months);
          break;

        case 'reportPurchases':
          requirePerm(dbUser, 'report');
          result = await reportDbSalesOrPurchases('purchase', data.dari, data.sampai);
          break;

        case 'reportExpenses':
          requirePerm(dbUser, 'report');
          result = await reportDbExpenses(data.dari, data.sampai);
          break;

        case 'reportProfit':
          requireOwner(dbUser);
          result = await reportDbProfit(data.dari, data.sampai);
          break;

        case 'reportStock':
          requireOwner(dbUser);
          result = await reportDbStock();
          break;

        case 'backup':
          requireOwner(dbUser);
          result = await createDbBackup('backup');
          break;

        case 'listBackups':
          requireOwner(dbUser);
          result = await listDbBackups(30);
          break;

        case 'deleteOldBackups':
          requireOwner(dbUser);
          result = await deleteOldDbBackups(10);
          break;

        case 'restore':
          requireOwner(dbUser);
          result = await restoreDbBackup(data.id, data.konfirmasi, dbUser);
          break;

        case 'downloadBackup':
          requireOwner(dbUser);
          result = await exportDbBackupById(data.id);
          break;

        case 'getAutoBackupConfig':
          requireOwner(dbUser);
          result = await getDbAutoBackupConfig();
          break;

        case 'saveAutoBackupConfig':
          requireOwner(dbUser);
          result = await saveDbAutoBackupConfig(data);
          break;

        case 'runAutoBackupNow':
          requireOwner(dbUser);
          result = await runAutoBackupIfDue(true);
          break;

        case 'exportJson':
          requireOwner(dbUser);
          result = await exportDbJson();
          break;

        case 'importJson':
          requireOwner(dbUser);
          result = await importDbJson(data.json, dbUser);
          break;

        case 'getStoreQris':
          result = await getDbStoreQris();
          break;

        case 'saveStoreQris':
          requireOwner(dbUser);
          result = await saveDbStoreQris(data.qris);
          break;

        case 'getUsers':
          requireOwner(dbUser);
          result = await listDbUsers();
          break;

        case 'saveUser':
          requireOwner(dbUser);
          result = await saveDbUser(
            {
              email: typeof data.email === 'string' ? data.email : undefined,
              username: typeof data.username === 'string' ? data.username : undefined,
              password: typeof data.password === 'string' ? data.password : undefined,
              role: typeof data.role === 'string' ? data.role : undefined,
              perms: data.perms,
              aktif: data.aktif !== false,
            },
            dbUser,
          );
          break;

        case 'deleteUser':
          requireOwner(dbUser);
          await deleteDbUser(String(data.email || ''), dbUser);
          result = true;
          break;

        default:
          throw new PosDomainError(`Aksi "${action}" tidak dikenal`, 400);
      }

      res.json({ data: result });
    } catch (err) {
      sendPosError(res, err);
    }
  });

  // Search Grounding market price lookup for restock items
  app.post('/api/restock-market-info', requireAuth, async (req: AuthRequest, res) => {
    const body = (req.body || {}) as MarketInfoBody;
    const productName = String(body.productName || '').trim();
    if (!productName) {
      res.status(400).json({ error: 'Nama produk wajib diisi.' });
      return;
    }

    const isOwner = req.dbUser?.role === 'owner';
    const category = String(body.category || '').trim();
    const tipe = String(body.tipe || '').trim();
    const currentHpp =
      isOwner && typeof body.currentHpp === 'number' && body.currentHpp > 0 ? body.currentHpp : 0;
    const harga = typeof body.harga === 'number' && body.harga > 0 ? body.harga : 0;
    const hargaA = typeof body.hargaA === 'number' && body.hargaA > 0 ? body.hargaA : 0;
    const hargaMin = typeof body.hargaMin === 'number' && body.hargaMin > 0 ? body.hargaMin : 0;

    const cacheKey = `${isOwner ? 'owner' : 'admin'}:${productName.toLowerCase()}:${currentHpp}`;
    if (!body.forceRefresh) {
      const cached = marketInfoCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        res.json(cached.payload);
        return;
      }
    }

    const ai = getAiClient();
    if (!ai) {
      res.json(
        buildMarketFallback({
          productName,
          category,
          tipe,
          isOwner,
          currentHpp,
          harga,
          hargaA,
          hargaMin,
          notice:
            'Pencarian otomatis AI belum aktif. Berikut ringkasan harga toko dan tautan cek harga langsung ke marketplace.',
        }),
      );
      return;
    }

    const contextParts = [
      `Produk: ${productName}`,
      category ? `Kategori: ${category}` : '',
      tipe ? `Tipe/Merek: ${tipe}` : '',
      currentHpp > 0 ? `HPP Toko saat ini: ${formatRpServer(currentHpp)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const prompt = [
      'Cari referensi harga pasar & harga grosir terbaru di Indonesia serta ketersediaan stok online untuk kebutuhan restok toko:',
      contextParts,
      '',
      'Berikan ringkasan singkat dan padat dalam bahasa Indonesia (maksimal 4 poin singkat):',
      '1. Perkiraan kisaran harga pasar / grosir saat ini di Indonesia (dalam Rupiah).',
      '2. Ketersediaan umum di marketplace/distributor dan catatan varian/keaslian jika relevan.',
      currentHpp > 0
        ? '3. Perbandingan singkat dengan HPP toko saat ini apakah wajar atau perlu cek ulang.'
        : '3. Tips singkat memilih supplier untuk restok item ini.',
      'Jangan gunakan kalimat pembuka yang panjang; langsung sajikan poin ringkas.',
    ].join('\n');

    const runWithModel = async (model: string) => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const summary = (response.text || '').trim();
      const metadata = response.candidates?.[0]?.groundingMetadata;
      const rawChunks = metadata?.groundingChunks || [];
      const seenUris = new Set<string>();
      const sources: GroundingSource[] = [];

      for (const chunk of rawChunks) {
        const uri = chunk.web?.uri?.trim();
        if (!uri || seenUris.has(uri)) continue;
        seenUris.add(uri);
        sources.push({
          title: chunk.web?.title?.trim() || uri,
          uri,
        });
      }

      const queries = Array.isArray(metadata?.webSearchQueries)
        ? metadata.webSearchQueries.filter(
            (q): q is string => typeof q === 'string' && Boolean(q.trim()),
          )
        : [];

      const keyword = buildSearchKeyword(productName, tipe);
      const fallbackMarketplaceLinks: GroundingSource[] =
        sources.length > 0
          ? sources
          : [
              {
                title: `Cari "${keyword}" di Tokopedia`,
                uri: `https://www.tokopedia.com/search?st=product&q=${encodeURIComponent(keyword)}`,
              },
              {
                title: `Cari "${keyword}" di Shopee`,
                uri: `https://shopee.co.id/search?keyword=${encodeURIComponent(keyword)}`,
              },
            ];

      return {
        summary: summary || 'Tidak ada ringkasan harga pasar yang ditemukan.',
        sources: fallbackMarketplaceLinks,
        queries: queries.length > 0 ? queries : [keyword],
      } satisfies MarketInfoPayload;
    };

    try {
      let result: MarketInfoPayload;
      try {
        result = await runWithModel('gemini-4-hydrogen');
      } catch {
        result = await runWithModel('gemini-3.1-flash-lite');
      }
      marketInfoCache.set(cacheKey, {
        expiresAt: Date.now() + MARKET_CACHE_TTL_MS,
        payload: result,
      });
      res.json(result);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      const isQuota =
        rawMsg.includes('429') ||
        rawMsg.includes('RESOURCE_EXHAUSTED') ||
        rawMsg.toLowerCase().includes('quota') ||
        rawMsg.toLowerCase().includes('rate');

      console.warn('Market info AI fallback triggered:', rawMsg.slice(0, 200));

      res.json(
        buildMarketFallback({
          productName,
          category,
          tipe,
          isOwner,
          currentHpp,
          harga,
          hargaA,
          hargaMin,
          notice: isQuota
            ? 'Kuota pencarian AI sedang penuh untuk saat ini. Ditampilkan acuan harga toko & tautan cek harga langsung ke marketplace.'
            : 'Pencarian otomatis sedang sibuk. Gunakan acuan harga toko & tautan marketplace di bawah untuk cek harga terbaru.',
        }),
      );
    }
  });

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`SAHABAT POS server listening on http://0.0.0.0:${PORT}`);

    // Daily automatic database backup scheduler (WIB)
    setTimeout(() => {
      runAutoBackupIfDue(false).catch((err) => {
        console.warn('Initial auto-backup check failed:', err);
      });
    }, 5000);

    setInterval(() => {
      runAutoBackupIfDue(false).catch((err) => {
        console.warn('Scheduled auto-backup check failed:', err);
      });
    }, 60_000);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
