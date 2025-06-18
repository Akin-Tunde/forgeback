// src/handlers/create.ts
import { CommandHandler, CommandContext } from '../types/commands';
import { getWalletByUserId, saveWallet } from '../lib/database';
import { generateWallet } from '../lib/token-wallet';
import { verifyEncryptionKey } from '../lib/encryption';
import { WalletData } from '../types/wallet';

export const createHandler: CommandHandler = {
  command: "/create",
  description: "Create and save a new wallet",
  handler: async ({ session }: CommandContext) => {
    try {
      const userId = session.userId;
      if (!userId) {
        return {
          response: "❌ Please start the bot first with /start command.",
        };
      }

      if (!verifyEncryptionKey()) {
        return {
          response:
            "❌ Bot encryption key is not properly configured. Please contact the bot administrator.",
        };
      }

      const existingWallet = await getWalletByUserId(userId);
      if (existingWallet) {
        return {
          response:
            "⚠️ You already have a wallet set up. Creating a new wallet will replace your current one.\n\nMake sure you have exported your private key if you want to keep access to your current wallet.\n\nDo you want to continue?",
          buttons: [
            [
              {
                label: "Yes, create new wallet",
                callback: "confirm_create_wallet",
              },
              {
                label: "No, keep current wallet",
                callback: "cancel_create_wallet",
              },
            ],
          ],
        };
      }

      const wallet = await generateWallet(userId);
      const walletData: WalletData = {
        address: wallet.address,
        encryptedPrivateKey: wallet.encryptedPrivateKey,
        type: wallet.type || 'evm',
        createdAt: Date.now(),
      };
      await saveWallet(walletData, userId);

      session.walletAddress = wallet.address;
      await new Promise((resolve, reject) => {
        session.save((err) => (err ? reject(err) : resolve(undefined)));
      });

      return {
        response: `✅ Wallet created successfully!\n\nAddress: ${wallet.address}\n\nImportant:\n- This wallet is stored securely on our server\n- Use /export to get your private key\n- Store your private key somewhere safe\n- Never share your private key with anyone\n\nNow you can:\n- Use /deposit to receive funds\n- Use /balance to check your balance\n- Use /buy to buy tokens with ETH`,
        buttons: [[{ label: "🔑 Export Private Key", callback: "export_key" }]],
      };
    } catch (error) {
      console.error("Error in create command:", error);
      return {
        response:
          "❌ An error occurred while creating your wallet. Please try again later.",
      };
    }
  },
};