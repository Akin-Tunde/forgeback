import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import dotenv from "dotenv";
import cors from "cors";
import { SupabaseSessionStore, sessionStore } from "./src/lib/database"; 

import { initDatabase, closeDatabase } from "./src/lib/database";
import { verifyEncryptionKey } from "./src/lib/encryption";
import {ExtendedSession, CommandContext, SessionData } from "./src/types/commands";
import { verifyFarcasterSignature } from "./src/lib/farcaster";
import { getWallet } from "./src/lib/token-wallet"; // Import getWallet

// Import commands
import { startHandler, helpHandler } from "./src/commands/start-help";
import { walletHandler, createHandler } from "./src/commands/wallet";
import {
  importHandler,
  exportHandler,
  handlePrivateKeyInput,
  handleExportConfirmation,
} from "./src/commands/import-export";
import {
  balanceHandler,
  historyHandler,
  handleTimeframeChange,
} from "./src/commands/balance-history";
import {
  buyHandler,
  handleTokenSelection,
  handleCustomTokenInput,
  handleBuyAmountInput,
  handleBuyConfirmation,
} from "./src/commands/buy";
import {
  sellHandler,
  handleSellTokenSelection,
  handleSellCustomTokenInput,
  handleSellAmountInput,
  handleSellConfirmation,
} from "./src/commands/sell";
import {
  settingsHandler,
  handleSettingsOption,
  updateSlippage,
  updateGasPriority,
} from "./src/commands/settings";
import { depositHandler } from "./src/commands/deposit";
import {
  withdrawHandler,
  handleWithdrawAddress,
  handleWithdrawAmount,
  handleWithdrawConfirmation,
} from "./src/commands/withdraw";
import { isValidAddress } from "./src/utils/validators";


// Extend express-session to include SessionData
declare module "express-session" {
  interface SessionData {
    userId: string;
    currentAction?: string;
    tempData: Record<string, any>;
    settings: { slippage: number; gasPriority: string };
    walletAddress?: string;
    fid?: string;
    username?: string; // Added
    displayName?: string; // Added
  }
}
// Add before app.listen
async function startServer() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}
// Load environment variables
dotenv.config();

// Initialize database
initDatabase();

// Verify encryption key
if (!verifyEncryptionKey()) {
  console.error(
    "⛔ ERROR: Wallet encryption key is not properly configured. Set a 32-character WALLET_ENCRYPTION_KEY in your .env file."
  );
  process.exit(1);
}

// Verify session secret
if (!process.env.SESSION_SECRET) {
  console.error("⛔ ERROR: SESSION_SECRET is not set in .env file.");
  process.exit(1);
}

// ✅ Create Express app
const app = express();

// ✅ Use CORS middleware BEFORE anything else
app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = [
      "https://mini-testf.netlify.app",
      "http://localhost:3000",
      "http://localhost:5173", // Add this if your frontend runs on port 5173
    ]
    if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin || "*");
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true, // Allow cookies to be sent
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware
app.use(express.json());

app.use(
  session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      httpOnly: true,
     secure: process.env.NODE_ENV === "production" ? true : false, 
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
       path: "/",
      domain: process.env.NODE_ENV === "production" ? undefined : "localhost",
    },
  })
);

// Log Set-Cookie headers for debugging
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    const setCookie = res.getHeader("Set-Cookie");
    if (setCookie) {
      console.log("[Response] Set-Cookie:", setCookie, "for path:", req.path);
    }
    return originalSend.call(this, body);
  };
  next();
});

app.get("/", (req, res) => {
  res.send("🔧 ForgeBot backend is running.");
});

// Farcaster authentication middleware

const authenticateFarcaster = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const fid = req.body.fid;
  const username = req.body.username;
  const displayName = req.body.displayName;
  console.log("authenticateFarcaster: fid =", fid);
  console.log("authenticateFarcaster: username =", username);
  console.log("authenticateFarcaster: displayName =", displayName);

  if (!fid) {
    console.log(
      "authenticateFarcaster: No FID provided, skipping authentication"
    );
    return next(); // Proceed without setting session data
  }

  // Set session data
  req.session.userId = fid.toString();
  req.session.fid = fid.toString();
  req.session.username = username || undefined; // Store undefined if not provided
  req.session.displayName = displayName || undefined;
  console.log(
    "authenticateFarcaster: Set session.userId =",
    req.session.userId
  );
  console.log("authenticateFarcaster: Set session.fid =", req.session.fid);
  console.log(
    "authenticateFarcaster: Set session.username =",
    req.session.username
  );
  console.log(
    "authenticateFarcaster: Set session.displayName =",
    req.session.displayName
  );

  // Explicitly save the session
  req.session.save((err) => {
    if (err) {
      console.error("Error saving session:", err);
      return res.status(500).send("Failed to save session");
    }
    next();
  });
};
// Initialize session data middleware
const ensureSessionData = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  console.log(
    "ensureSessionData: req.session.userId =",
    req.session.userId,
    "req.body.fid =",
    req.body.fid
  );
  if (!req.session.userId && !req.body.fid) {
    req.session.userId = `guest_${Date.now()}`;
    console.log("ensureSessionData: Set guest userId =", req.session.userId);
  }
  if (!req.session.currentAction) {
    req.session.currentAction = undefined;
    req.session.tempData = {};
    req.session.settings = { slippage: 1.0, gasPriority: "medium" };
  }
  next();
};

// API Routes
app.post(
  "/api/start",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const result = await startHandler.handler({
      session: req.session as ExtendedSession,
    });
    res.json(result);
    return;
  }
);

app.post("/api/help", async (_req: Request, res: Response): Promise<void> => {
  const result = await helpHandler.handler(); // TS2554
  res.json(result);
  return;
});

app.post(
  "/api/wallet",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const result = await walletHandler.handler({
      session: req.session as ExtendedSession,
    });
    res.json(result);
    return;
  }
);

app.post(
  "/api/create",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const result = await createHandler.handler({
      session: req.session as ExtendedSession,
    });
    res.json(result);
    return;
  }
);

app.post(
  "/api/import",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { args, callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback === "confirm_import_wallet") {
      req.session.walletAddress = undefined;
      result = await importHandler.handler({
        session: req.session as ExtendedSession,
        wallet, // Pass wallet, though importHandler itself might not use it directly for this path
      });
    } else if (req.session.currentAction === "import_wallet") {
      result = await handlePrivateKeyInput({
        session: req.session as ExtendedSession,
        args,
      });
    } else {
      result = await importHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/export",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback === "confirm_yes" || callback === "confirm_no") {
      result = await handleExportConfirmation(
        { session: req.session as ExtendedSession, wallet },
        callback === "confirm_yes"
      );
    } else {
      result = await exportHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/balance",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const result = await balanceHandler.handler({
      session: req.session as ExtendedSession,
      wallet: req.session.userId
        ? (await getWallet(req.session.userId)) || undefined
        : undefined,
    });
    res.json(result);
    return;
  }
);

app.post(
  "/api/history",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback?.startsWith("history_")) {
      const timeframe = callback.replace("history_", "") as
        | "day"
        | "week"
        | "month";
      result = await handleTimeframeChange({
        session: req.session as ExtendedSession,
        wallet,
        args: timeframe,
      });
    } else {
      result = await historyHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/buy",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { args, callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback?.startsWith("token_")) {
      const tokenSymbol = callback.replace("token_", "");
      result = await handleTokenSelection({
        session: req.session as ExtendedSession,
        wallet,
        args: tokenSymbol,
      });
    } else if (req.session.currentAction === "buy_custom_token") {
      result = await handleCustomTokenInput({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else if (req.session.currentAction === "buy_amount") {
      result = await handleBuyAmountInput({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else if (callback === "confirm_yes" || callback === "confirm_no") {
      result = await handleBuyConfirmation(
        { session: req.session as ExtendedSession, wallet },
        callback === "confirm_yes"
      );
    } else {
      result = await buyHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/sell",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { args, callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback?.startsWith("sell_token_")) {
      const tokenAddress = callback.replace("sell_token_", "");
      result = await handleSellTokenSelection({
        session: req.session as ExtendedSession,
        wallet,
        args: tokenAddress,
      });
    } else if (req.session.currentAction === "sell_custom_token") {
      result = await handleSellCustomTokenInput({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else if (req.session.currentAction === "sell_amount") {
      result = await handleSellAmountInput({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else if (callback === "confirm_yes" || callback === "confirm_no") {
      result = await handleSellConfirmation(
        { session: req.session as ExtendedSession, wallet },
        callback === "confirm_yes"
      );
    } else {
      result = await sellHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/settings",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { callback } = req.body;
    // Settings handlers typically don't need the wallet object directly, they operate on session.settings
    let result;
    if (callback?.startsWith("settings_")) {
      const option = callback.replace("settings_", "") as
        | "slippage"
        | "gasPriority";
      result = await handleSettingsOption(
        { session: req.session as ExtendedSession },
        option
      );
    } else if (callback?.startsWith("slippage_")) {
      const slippage = parseFloat(callback.replace("slippage_", ""));
      result = await updateSlippage(
        { session: req.session as ExtendedSession },
        slippage
      );
    } else if (callback?.startsWith("gas_")) {
      const priority = callback.replace("gas_", "") as
        | "low"
        | "medium"
        | "high";
      result = await updateGasPriority(
        { session: req.session as ExtendedSession },
        priority
      );
    } else if (callback === "back") {
      result = {
        response:
          "🤖 Base MEV-Protected Trading Bot\n\nWhat would you like to do?",
        buttons: [
          [
            { label: "💰 Balance", callback: "check_balance" },
            { label: "📊 History", callback: "check_history" },
          ],
          [
            { label: "💱 Buy Token", callback: "buy_token" },
            { label: "💱 Sell Token", callback: "sell_token" },
          ],
          [{ label: "⚙️ Settings", callback: "open_settings" }],
        ],
      };
    } else {
      result = await settingsHandler.handler({
        session: req.session as ExtendedSession,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/deposit",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const result = await depositHandler.handler({
      // depositHandler might need wallet to display address
      session: req.session as ExtendedSession,
      wallet: req.session.userId
        ? (await getWallet(req.session.userId)) || undefined
        : undefined,
    });
    res.json(result);
    return;
  }
);

app.post(
  "/api/withdraw",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { args, callback } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    if (callback?.startsWith("withdraw_confirm_")) {
      result = await handleWithdrawConfirmation(
        { session: req.session as ExtendedSession, wallet },
        callback === "withdraw_confirm_true"
      );
    } else if (req.session.currentAction === "withdraw_amount") {
      result = await handleWithdrawAmount({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else if (req.session.currentAction === "withdraw_address") {
      result = await handleWithdrawAddress({
        session: req.session as ExtendedSession,
        wallet,
        args,
      });
    } else {
      result = await withdrawHandler.handler({
        session: req.session as ExtendedSession,
        wallet,
      });
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/cancel",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    if (req.session.currentAction) {
      req.session.currentAction = undefined;
      req.session.tempData = {};
      res.json({ response: "✅ Operation cancelled." });
      return;
    } else {
      res.json({ response: "There is no active operation to cancel." });
      return;
    }
  }
);

// Handle text inputs for workflows
app.post(
  "/api/input",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { args } = req.body;
    const wallet = req.session.userId
      ? (await getWallet(req.session.userId)) || undefined
      : undefined;
    let result;
    switch (req.session.currentAction) {
      case "import_wallet":
        result = await handlePrivateKeyInput({
          session: req.session as ExtendedSession,
          wallet, // Though likely not used by this specific handler
          args,
        });
        break;
      case "buy_custom_token":
        result = await handleCustomTokenInput({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      case "buy_amount":
        result = await handleBuyAmountInput({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      case "sell_custom_token":
        result = await handleSellCustomTokenInput({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      case "sell_amount":
        result = await handleSellAmountInput({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      case "withdraw_address":
        result = await handleWithdrawAddress({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      case "withdraw_amount":
        result = await handleWithdrawAmount({
          session: req.session as ExtendedSession,
          wallet,
          args,
        });
        break;
      default:
        if (isValidAddress(args)) {
          req.session.currentAction = "buy_custom_token"; // Prompt for buy flow
          result = await handleCustomTokenInput({
            session: req.session as ExtendedSession,
            wallet,
            args,
          });
        } else {
          result = {
            response:
              "🤖 Hello! Here are some things you can do:\n\n" +
              "/wallet - View your wallet\n" +
              "/balance - Check your balances\n" +
              "/buy - Buy tokens with ETH\n" +
              "/sell - Sell tokens for ETH\n" +
              "/deposit - Get your deposit address\n" +
              "/withdraw - Withdraw ETH to another address\n" +
              "/settings - Change trading settings\n" +
              "/help - Show this help message",
            buttons: [
              [
                { label: "💰 Balance", callback: "check_balance" },
                { label: "💱 Buy/Sell", callback: "buy_token" },
              ],
              [
                { label: "📥 Deposit", callback: "deposit" },
                { label: "📤 Withdraw", callback: "withdraw" },
              ],
            ],
          };
        }
    }
    res.json(result);
    return;
  }
);

app.post(
  "/api/command",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { command, args, fid } = req.body;
    const session = req.session as ExtendedSession;
    const wallet = session.userId
      ? (await getWallet(session.userId)) || undefined
      : undefined;
    let result;

    console.log(`[Command] Received: command=${command}, args=${JSON.stringify(args)}, currentAction=${session.currentAction}, userId=${session.userId}, fid=${fid}`);

    try {
      if (session.currentAction === "buy_custom_token" && command) {
        console.log("[Command] Handling buy_custom_token input as command:", command);
        result = await handleCustomTokenInput({ session, args: command });
      } else if (session.currentAction === "buy_amount" && command) {
        console.log("[Command] Handling buy_amount input as command:", command);
        result = await handleBuyAmountInput({ session, args: command });
      } else if (session.currentAction === "import_wallet" && command) {
        console.log("[Command] Handling private key input as command:", command);
        result = await handlePrivateKeyInput({ session, args: command, wallet });
      } else {
        switch (command) {
          case "/start":
            result = await startHandler.handler({ session });
            break;
          case "/balance":
            result = await balanceHandler.handler({ session, wallet });
            break;
          case "/buy":
            result = await buyHandler.handler({ session, wallet });
            break;
          case "/sell":
            result = await sellHandler.handler({ session, wallet });
            break;
          case "/deposit":
            result = await depositHandler.handler({ session, wallet });
            break;
          case "/withdraw":
            result = await withdrawHandler.handler({ session });
            break;
          case "/wallet":
            result = await walletHandler.handler({ session });
            break;
          case "/settings":
            result = await settingsHandler.handler({ session });
            break;
          case "/help":
            result = await helpHandler.handler();
            break;
          case "/create":
            result = await createHandler.handler({ session });
            break;
          case "/import":
            result = await importHandler.handler({ session, wallet });
            break;
          case "/export":
            result = await exportHandler.handler({ session, wallet });
            break;
          case "/cancel":
            session.currentAction = undefined;
            session.tempData = {};
            await session.save();
            result = { response: "Operation cancelled." };
            break;
          default:
            console.error("[Command] Unknown command:", command);
            result = { response: `Unknown command: ${command}\nPlease try /help.` };
            break;
        }
      }
    } catch (error) {
      console.error("[Command] Error processing command:", command, error);
      result = { response: "❌ An error occurred. Please try again later." };
    }

    await session.save();
    console.log("[Command] Session saved for userId:", session.userId);
    res.json(result);
    return;
  }
);

// /api/callback route
app.post(
  "/api/callback",
  authenticateFarcaster,
  ensureSessionData,
  async (req: Request, res: Response): Promise<void> => {
    const { callback, args } = req.body;
    const session = req.session as ExtendedSession;
    const wallet = session.userId
      ? (await getWallet(session.userId)) || undefined
      : undefined;
    let result;

    console.log(
      `[Callback] Received: callback=${callback}, args=${JSON.stringify(args)}, ` +
      `currentAction=${session.currentAction}, userId=${session.userId}, ` +
      `walletAddress=${session.walletAddress}, sessionId=${req.sessionID}, ` +
      `wallet=${wallet ? 'exists' : 'undefined'}, tempData=${JSON.stringify(session.tempData)}, ` +
      `cookies=${JSON.stringify(req.cookies)}`
    );

    try {
      // Early validation for session state
      if (!session.userId) {
        console.error("[Callback] No userId in session, fid:", req.body.fid, "sessionId:", req.sessionID);
        result = { response: "❌ Session expired. Please restart with /start." };
      } else if (session.currentAction === "buy_amount" && args && (callback === null || callback === undefined)) {
        console.log("[Callback] Handling buy amount input:", args, "for userId:", session.userId);
        if (!session.tempData || !session.tempData.toToken || !session.tempData.walletAddress || !session.tempData.balance) {
          console.warn("[Callback] Invalid session.tempData for buy_amount, userId:", session.userId, "tempData:", session.tempData, "sessionId:", req.sessionID);
          session.currentAction = undefined;
          session.tempData = {};
          await session.save();
          result = { response: "❌ Invalid session state. Please restart with /buy." };
        } else {
          result = await handleBuyAmountInput({ session, args, wallet });
        }
      } else if (session.currentAction === "buy_confirm" && (callback === "confirm_yes" || callback === "confirm_no")) {
        console.log("[Callback] Handling buy confirmation:", callback, "for userId:", session.userId);
        result = await handleBuyConfirmation({ session, wallet }, callback === "confirm_yes");
        session.currentAction = undefined;
        await session.save();
      } else if (session.currentAction === "buy_custom_token" && args && isValidAddress(args)) {
        console.log("[Callback] Handling custom token input:", args, "for userId:", session.userId);
        result = await handleCustomTokenInput({ session, args, wallet });
      } else if (callback === null && args && isValidAddress(args)) {
        console.warn("[Callback] Unexpected null callback with address args:", args, "currentAction:", session.currentAction);
        if (!session.currentAction || session.currentAction === "buy_token") {
          console.log("[Callback] Setting currentAction to buy_custom_token for address input:", args);
          session.currentAction = "buy_custom_token";
          await session.save();
        }
        result = await handleCustomTokenInput({ session, args, wallet });
      } else if (session.currentAction === "export_wallet" && (callback === "confirm_yes" || callback === "confirm_no")) {
        console.log(`[Callback] Handling export confirmation: ${callback}, userId=${session.userId}`);
        result = await handleExportConfirmation(
          { session, wallet },
          callback === "confirm_yes"
        );
        session.currentAction = undefined;
        await session.save();
      } else if (callback === "settings_slippage") {
        console.log("[Callback] Handling settings_slippage for userId:", session.userId);
        result = await handleSettingsOption({ session }, "slippage");
      } else if (callback === "settings_gasPriority") {
        console.log("[Callback] Handling settings_gasPriority for userId:", session.userId);
        result = await handleSettingsOption({ session }, "gasPriority");
      } else if (callback?.startsWith("slippage_")) {
        console.log("[Callback] Processing slippage selection:", callback);
        const value = parseFloat(callback.replace("slippage_", ""));
        result = await updateSlippage({ session }, value);
      } else if (callback?.startsWith("gasPriority_")) {
        console.log("[Callback] Processing gas priority selection:", callback);
        const priority = callback.replace("gasPriority_", "") as "low" | "medium" | "high";
        result = await updateGasPriority({ session }, priority);
      } else if (["USDC", "DAI", "WBTC", "custom"].includes(callback)) {
        console.log("[Callback] Handling token selection:", callback, "for userId:", session.userId);
        result = await handleTokenSelection({ session, args: callback, wallet });
      } else if (callback === "import_wallet" && args) {
        console.log("[Callback] Processing private key input with args:", args);
        if (session.currentAction !== "import_wallet") {
          console.warn("[Callback] Setting currentAction to import_wallet");
          session.currentAction = "import_wallet";
        }
        result = await handlePrivateKeyInput({ session, args, wallet });
      } else if (session.currentAction === "import_wallet" && args) {
        console.log("[Callback] Processing private key input (legacy):", args);
        result = await handlePrivateKeyInput({ session, args, wallet });
      } else if (callback === "check_balance") {
        console.log("[Callback] Handling check_balance");
        result = await balanceHandler.handler({ session, wallet });
      } else if (callback === "check_history") {
        console.log("[Callback] Handling check_history");
        result = await historyHandler.handler({ session, wallet });
      } else if (callback === "buy_token") {
        console.log("[Callback] Handling buy_token");
        result = await buyHandler.handler({ session, wallet });
      } else if (callback === "sell_token") {
        console.log("[Callback] Handling sell_token");
        result = await sellHandler.handler({ session, wallet });
      } else if (callback === "open_settings") {
        console.log("[Callback] Handling open_settings");
        result = await settingsHandler.handler({ session });
      } else if (callback === "help") {
        console.log("[Callback] Handling help");
        result = await helpHandler.handler();
      } else if (callback === "deposit") {
        console.log("[Callback] Handling deposit");
        result = await depositHandler.handler({ session, wallet });
      } else if (callback === "withdraw") {
        console.log("[Callback] Handling withdraw");
        result = await withdrawHandler.handler({ session });
      } else if (callback === "export_key") {
        console.log("[Callback] Handling export_key for userId:", session.userId);
        result = await exportHandler.handler({ session, wallet });
      } else if (callback === "confirm_create_wallet") {
        session.walletAddress = undefined;
        result = await createHandler.handler({ session });
      } else if (callback === "cancel_create_wallet") {
        result = {
          response: "Operation cancelled. Your existing wallet remains unchanged.",
        };
      } else if (callback === "confirm_import_wallet") {
        session.walletAddress = undefined;
        console.log("[Callback] Confirming import wallet");
        result = await importHandler.handler({ session, wallet });
      } else if (callback === "cancel_import_wallet") {
        session.currentAction = undefined;
        result = {
          response: "Operation cancelled. Your existing wallet remains unchanged.",
        };
      } else {
        console.error("[Callback] Unknown callback:", callback, "args:", args, "currentAction:", session.currentAction, "sessionId:", req.sessionID);
        // Fallback: Treat numeric args as buy_amount if numeric
        if (args && !isNaN(parseFloat(args))) {
          console.warn("[Callback] Fallback: Treating args as buy_amount input:", args, "for userId:", session.userId);
          if (session.currentAction !== "buy_amount" || !session.tempData || !session.tempData.toToken || !session.tempData.walletAddress || !session.tempData.balance) {
            console.warn("[Callback] Invalid session state in fallback, userId:", session.userId, "currentAction:", session.currentAction, "tempData:", session.tempData);
            session.currentAction = undefined;
            session.tempData = {};
            await session.save();
            result = { response: "❌ Invalid session state. Please restart with /buy." };
          } else {
            result = await handleBuyAmountInput({ session, args, wallet });
          }
        } else {
          result = { response: "❌ Unknown callback or invalid session state. Please restart with /buy." };
        }
      }
    } catch (error) {
      console.error("[Callback] Error processing callback:", callback, "args:", args, "error:", error, "sessionId:", req.sessionID);
      result = { response: "❌ An error occurred. Please try again later." };
    }

    await session.save();
    console.log("[Callback] Session saved for userId:", session.userId, "sessionId:", req.sessionID);
    res.json(result);
    return;
  }
);

// ... rest of the code



// Other imports and app setup remain unchanged

// ... (rest of index.ts unchanged: other routes, server start, SIGINT handler)
// Start server
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`🤖 Base MEV-Protected Trading Bot running on port ${PORT}`);
  console.log(`ℹ️ API available at http://localhost:${PORT}`);
  console.log(`ℹ️ Frontend: http://localhost:5173/`);
});

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("🛑 Stopping server...");
  server.close(() => {
    closeDatabase();
    console.log("👋 Server stopped. Goodbye!");
    process.exit(0);
  });
});
