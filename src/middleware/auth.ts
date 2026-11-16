import type { NextFunction, Request, Response } from 'express';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { signSessionToken, verifySessionToken } from '../lib/session-token.ts';
import { getDbUserByIdAndEmail, getOrCreateUser, type DbUserRecord } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
  dbUser?: DbUserRecord;
  authMode?: 'credentials' | 'google';
}

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Sesi login tidak ditemukan. Silakan masuk kembali.' });
    return;
  }

  const token = authHeader.split('Bearer ')[1]?.trim();
  if (!token) {
    res.status(401).json({ error: 'Token autentikasi tidak valid.' });
    return;
  }

  // 1) Credential session token (20-minute sliding idle TTL on mobile, persistent on desktop)
  if (token.startsWith('sp.')) {
    try {
      const payload = await verifySessionToken(token);
      if (!payload) {
        res.status(401).json({ error: 'Sesi login telah berakhir. Silakan login ulang.' });
        return;
      }

      const dbUser = await getDbUserByIdAndEmail(payload.uid, payload.email);
      if (!dbUser) {
        res.status(401).json({ error: 'Akun tidak ditemukan. Silakan login ulang.' });
        return;
      }

      if (!dbUser.aktif) {
        res.status(403).json({
          error: `Akun (${dbUser.email}) belum diaktifkan oleh Owner. Hubungi Owner untuk mengaktifkan akses.`,
        });
        return;
      }

      req.dbUser = dbUser;
      req.authMode = 'credentials';

      // Sliding renewal: every 2m on mobile (20m idle window) or every 12h on desktop
      const isDesktop = payload.dev === 'd';
      const refreshThresholdMs = isDesktop ? 12 * 60 * 60 * 1000 : 2 * 60 * 1000;
      if (Date.now() - payload.iat > refreshThresholdMs) {
        const refreshed = await signSessionToken(
          dbUser.id,
          dbUser.email,
          isDesktop ? 'desktop' : 'mobile',
        );
        res.setHeader('X-Refreshed-Token', refreshed.token);
      }

      next();
      return;
    } catch (error) {
      console.error('Error verifying credential session token:', error);
      res.status(500).json({ error: 'Gagal memverifikasi sesi di database.' });
      return;
    }
  }

  // 2) Firebase ID token (Google Sign-In)
  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    req.user = decodedToken;

    const email = decodedToken.email || '';
    const dbUser = await getOrCreateUser(decodedToken.uid, email);
    req.dbUser = dbUser;
    req.authMode = 'google';

    if (!dbUser.aktif) {
      res.status(403).json({
        error: `Akun Google (${dbUser.email}) belum diaktifkan oleh Owner. Hubungi Owner untuk mengaktifkan akses di menu Akun.`,
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Error verifying Firebase ID token:', error);
    const message =
      error instanceof Error && error.message.includes('database')
        ? error.message
        : 'Sesi login berakhir atau tidak valid. Silakan masuk ulang.';
    const status = message.includes('database') ? 500 : 401;
    res.status(status).json({ error: message });
  }
};
