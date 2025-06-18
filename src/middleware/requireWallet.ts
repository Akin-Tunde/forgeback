// src/middleware/requireWallet.ts
import { Request, Response, NextFunction } from 'express';
import { Session } from 'express-session'; // Add import
import { SessionData } from '../types/commands';
import { getWalletByUserId } from '../lib/database';

interface AuthRequest extends Request {
  session: Session & Partial<SessionData>;
}

export const requireWallet = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const { command } = req.body;
  const allowedCommands = ['/start', '/create', '/import', '/wallet', '/help'];

  if (allowedCommands.includes(command)) {
    return next();
  }

  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ response: "❌ Unable to identify user. Please use /start." });
    return;
  }

  const wallet = await getWalletByUserId(userId);
  if (!wallet) {
    res.status(403).json({
      response: "❌ No wallet found. Please create or import a wallet using /create or /import.",
    });
    return;
  }

  next();
};