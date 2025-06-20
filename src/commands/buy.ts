import { CommandContext } from "../types/commands";
import {
  getTokenInfo,
  getTokenAddressFromSymbol,
  getWallet,
  getEthBalance,
  executeTransaction,
} from "../lib/token-wallet";
import { getQuote, getSwap, getGasParams } from "../lib/swap";
import {
  formatEthBalance,
  formatTransactionDetails,
} from "../utils/formatters";
import { isValidAddress, isValidAmount } from "../utils/validators";
import { saveTransaction } from "../lib/database";
import { NATIVE_TOKEN_ADDRESS } from "../utils/constants";
import { parseEther, formatUnits, Address } from "viem";
import { WalletData } from "../types/wallet";

export const buyHandler = {
  command: "buy",
  description: "Buy ERC-20 tokens with ETH",
  handler: async ({ session, wallet }: CommandContext) => {
    try {
      const userId = session.userId;
      if (!userId) {
        return {
          response: "❌ Please start the bot first with /start command.",
        };
      }

      if (!wallet) {
        return {
          response:
            "❌ You don't have a wallet yet.\n\nUse /create to create a new wallet or /import to import an existing one.",
        };
      }

      const balance = await getEthBalance(wallet.address as `0x${string}`);
      console.log(
        "[Buy] ETH balance for userId:",
        userId,
        "address:",
        wallet.address,
        "balance:",
        balance
      );
      if (BigInt(balance) <= BigInt(0)) {
        return {
          response:
            "❌ Your wallet has no ETH balance to buy tokens.\n\nUse /deposit to get your deposit address and add ETH first.",
        };
      }

      session.currentAction = "buy_token";
      session.tempData = {
        fromToken: NATIVE_TOKEN_ADDRESS,
        fromSymbol: "ETH",
        fromDecimals: 18,
        walletAddress: wallet.address,
        balance,
      };
      console.log(
        "[Buy] Saving session: userId =",
        userId,
        "currentAction =",
        session.currentAction,
        "tempData =",
        JSON.stringify(session.tempData)
      );
      await session.save();
      console.log(
        "[Buy] Session saved: userId =",
        userId,
        "currentAction =",
        session.currentAction
      );

      const buttons = [
        [
          { label: "USDC", callback: "USDC" },
          { label: "DAI", callback: "DAI" },
          { label: "WBTC", callback: "WBTC" },
        ],
        [{ label: "Custom Token", callback: "custom" }],
      ];

      const formattedBalance = formatEthBalance(balance);
      console.log("[Buy] Formatted balance for display:", formattedBalance);
      return {
        response: `💱 Buy Tokens with ETH\n\nYour ETH balance: ${formattedBalance} ETH\n\nSelect a token to buy or choose "Custom Token" to enter a specific token address:`,
        buttons,
      };
    } catch (error) {
      console.error(
        "[Buy] Error in buy command for userId:",
        session?.userId,
        error
      );
      return { response: "❌ An error occurred. Please try again later." };
    }
  },
};

export async function handleTokenSelection(context: CommandContext): Promise<{
  response: string;
  buttons?: { label: string; callback: string }[][];
}> {
  const { session, args: tokenSymbol, wallet } = context;
  try {
    const userId = session.userId;
    if (!userId || !tokenSymbol) {
      console.error(
        "[Buy] Invalid request: userId =",
        userId,
        "tokenSymbol =",
        tokenSymbol
      );
      return { response: "❌ Invalid request. Please try again." };
    }

    if (!wallet) {
      console.warn("[Buy] Wallet not found, userId:", userId);
      session.currentAction = undefined;
      session.tempData = {};
      await session.save();
      return {
        response:
          "❌ Wallet not found. Please create or import a wallet and restart with /buy.",
      };
    }

    if (tokenSymbol === "custom") {
      session.currentAction = "buy_custom_token";
      session.tempData = {
        ...session.tempData,
        walletAddress: wallet.address,
        balance:
          session.tempData?.balance ||
          (await getEthBalance(wallet.address as `0x${string}`)),
      };
      console.log(
        "[Buy] Saving session: userId =",
        userId,
        "currentAction =",
        session.currentAction,
        "tempData =",
        JSON.stringify(session.tempData)
      );
      await session.save();
      console.log(
        "[Buy] Session saved: userId =",
        userId,
        "currentAction =",
        session.currentAction
      );
      return {
        response: `💱 Buy Custom Token\n\nPlease send the ERC-20 token address you want to buy.\n\nThe address should look like: 0x1234...5678\n\nYou can cancel this operation by typing /cancel`,
      };
    }

    const tokenAddress = getTokenAddressFromSymbol(tokenSymbol);
    if (!tokenAddress) {
      console.warn("[Buy] Token symbol not recognized:", tokenSymbol);
      return { response: "❌ Token symbol not recognized." };
    }

    console.log("[Buy] Fetching token info for address:", tokenAddress);
    const tokenInfo = await getTokenInfo(tokenAddress);
    if (!tokenInfo) {
      console.error(
        "[Buy] Unable to get token information for address:",
        tokenAddress
      );
      return {
        response: "❌ Unable to get token information. Please try again.",
      };
    }

    const balance =
      session.tempData?.balance ||
      (await getEthBalance(wallet.address as `0x${string}`));
    console.log(
      "[Buy] ETH balance for userId:",
      userId,
      "address:",
      wallet.address,
      "balance:",
      balance
    );
    session.tempData = {
      ...session.tempData,
      toToken: tokenInfo.address,
      toSymbol: tokenInfo.symbol,
      toDecimals: tokenInfo.decimals,
      walletAddress: wallet.address,
      balance,
    };
    session.currentAction = "buy_amount";
    console.log(
      "[Buy] Saving session: userId =",
      userId,
      "currentAction =",
      session.currentAction,
      "tempData =",
      JSON.stringify(session.tempData)
    );
    await session.save();
    console.log(
      "[Buy] Session saved: userId =",
      userId,
      "currentAction =",
      session.currentAction
    );

    const formattedBalance = formatEthBalance(balance);
    console.log("[Buy] Formatted balance for display:", formattedBalance);
    return {
      response: `💱 Buy ${tokenInfo.symbol}\n\nYou are buying ${tokenInfo.symbol} with ETH.\n\nYour ETH balance: ${formattedBalance} ETH\n\nPlease enter the amount of ETH you want to spend:`,
    };
  } catch (error) {
    console.error(
      "[Buy] Error handling token selection for userId:",
      session?.userId,
      error
    );
    session.currentAction = undefined;
    session.tempData = {};
    await session.save();
    return { response: "❌ An error occurred. Please try again." };
  }
}

export async function handleCustomTokenInput(context: CommandContext): Promise<{
  response: string;
  buttons?: { label: string; callback: string }[][];
}> {
  const { session, args: input, wallet } = context;
  try {
    const userId = session.userId;
    console.log(
      "[Buy] handleCustomTokenInput: userId =",
      userId,
      "input =",
      input,
      "currentAction =",
      session.currentAction,
      "tempData =",
      JSON.stringify(session.tempData)
    );

    if (!userId || !input) {
      console.error(
        "[Buy] Invalid request: userId =",
        userId,
        "input =",
        input
      );
      return { response: "❌ Invalid request. Please try again." };
    }

    if (!wallet) {
      console.warn("[Buy] Wallet not found, userId:", userId);
      session.currentAction = undefined;
      session.tempData = {};
      await session.save();
      return {
        response:
          "❌ Wallet not found. Please create or import a wallet and restart with /buy.",
      };
    }

    if (!isValidAddress(input)) {
      console.warn("[Buy] Invalid token address format:", input);
      return {
        response:
          "❌ Invalid token address format. Please provide a valid Ethereum address.\n\nTry again or type /cancel to abort.",
      };
    }

    console.log("[Buy] Fetching token info for address:", input);
    const tokenInfo = await getTokenInfo(input as Address);
    if (!tokenInfo) {
      console.error(
        "[Buy] Unable to get token information for address:",
        input
      );
      return {
        response:
          "❌ Unable to get information for this token. It might not be a valid ERC-20 token on Base Network.\n\nPlease check the address and try again or type /cancel to abort.",
      };
    }

    console.log("[Buy] Fetching ETH balance for address:", wallet.address);
    const ethBalance = await getEthBalance(wallet.address as `0x${string}`);
    console.log(
      "[Buy] ETH balance for userId:",
      userId,
      "address:",
      wallet.address,
      "balance:",
      ethBalance
    );
    if (BigInt(ethBalance) <= BigInt(0)) {
      console.warn(
        "[Buy] Zero ETH balance for userId:",
        userId,
        "address:",
        wallet.address
      );
      return {
        response:
          "❌ Your wallet has no ETH balance to buy tokens.\n\nUse /deposit to get your deposit address and add ETH first.",
      };
    }

    session.tempData = {
      fromToken: NATIVE_TOKEN_ADDRESS,
      fromSymbol: "ETH",
      fromDecimals: 18,
      toToken: tokenInfo.address,
      toSymbol: tokenInfo.symbol,
      toDecimals: tokenInfo.decimals,
      walletAddress: wallet.address,
      balance: ethBalance,
    };
    session.currentAction = "buy_amount";
    console.log(
      "[Buy] Saving session: userId =",
      userId,
      "currentAction =",
      session.currentAction,
      "tempData =",
      JSON.stringify(session.tempData)
    );
    await session.save();
    console.log(
      "[Buy] Session updated for userId:",
      userId,
      "tempData =",
      JSON.stringify(session.tempData)
    );

    const formattedBalance = formatEthBalance(ethBalance);
    return {
      response: `💱 Buy ${tokenInfo.name}\n\nYou are buying ${tokenInfo.name} with ETH.\n\nYour ETH balance: ${formattedBalance} ETH\n\nPlease enter the amount of ETH you want to spend:`,
    };
  } catch (error) {
    console.error(
      "[Buy] Error handling custom token input for userId:",
      session?.userId,
      "input =",
      input,
      error
    );
    session.currentAction = undefined;
    session.tempData = {};
    await session.save();
    return {
      response:
        "❌ Failed to process token address. Please check the address and try again.",
    };
  }
}

export async function handleBuyAmountInput(context: CommandContext): Promise<{
  response: string;
  buttons?: { label: string; callback: string }[][];
}> {
  const { session, args: input, wallet } = context;
  try {
    const userId = session.userId;
    console.log(
      "[Buy] handleBuyAmountInput: userId =",
      userId,
      "input =",
      input,
      "currentAction =",
      session.currentAction,
      "tempData =",
      JSON.stringify(session.tempData)
    );

    if (!userId || !input) {
      console.error(
        "[Buy] Invalid request: userId =",
        userId,
        "input =",
        input
      );
      return { response: "❌ Invalid request. Please try again." };
    }

    if (!wallet) {
      console.warn("[Buy] Wallet not found, userId:", userId);
      session.currentAction = undefined;
      session.tempData = {};
      await session.save();
      return {
        response:
          "❌ Wallet not found. Please create or import a wallet and restart with /buy.",
      };
    }

    if (
      !session.tempData ||
      !session.tempData.toToken ||
      !session.tempData.toSymbol ||
      !session.tempData.toDecimals ||
      !session.tempData.walletAddress ||
      !session.tempData.balance
    ) {
      console.warn(
        "[Buy] Invalid session.tempData for buy_amount, userId:",
        userId,
        "tempData:",
        session.tempData
      );
      session.currentAction = undefined;
      session.tempData = {};
      await session.save();
      return {
        response: "❌ Invalid session state. Please restart with /buy.",
      };
    }

    if (!isValidAmount(input)) {
      console.warn("[Buy] Invalid amount format:", input);
      return {
        response:
          "❌ Invalid amount format. Please enter a positive number (e.g., 0.0000002).\n\nTry again or type /cancel to abort.",
      };
    }

    let amountInput = input;
    if (amountInput.startsWith(".")) {
      amountInput = "0" + amountInput;
    }

    const amount = parseFloat(amountInput);
    const balance = session.tempData.balance;
    if (amount > parseFloat(formatEthBalance(balance))) {
      console.warn(
        "[Buy] Insufficient balance: amount =",
        amount,
        "balance =",
        balance
      );
      return {
        response: `❌ Insufficient balance. You only have ${formatEthBalance(
          balance
        )} ETH available.\n\nPlease enter a smaller amount or type /cancel to abort.`,
      };
    }

    const amountWei = parseEther(amountInput).toString();
    session.tempData.fromAmount = amountWei;

    const gasParams = await getGasParams(
      session.settings?.gasPriority || "medium"
    );
    session.tempData.gasPrice = gasParams.price;
    session.tempData.maxFeePerGas = gasParams.maxFeePerGas;
    session.tempData.maxPriorityFeePerGas = gasParams.maxPriorityFeePerGas;

    const selectedSlippage = session.settings?.slippage.toString() || "1.0";
    const selectedGasPriority = session.settings?.gasPriority || "medium";

    console.log(
      "[Buy] Fetching quote for amount:",
      amountInput,
      "fromToken:",
      session.tempData.fromToken,
      "toToken:",
      session.tempData.toToken
    );
    const quote = await getQuote(
      session.tempData.fromToken,
      session.tempData.toToken,
      amountInput,
      session.tempData.gasPrice
    );

    if (!quote || !quote.data) {
      console.error(
        "[Buy] Failed to fetch quote, userId:",
        userId,
        "amountInput:",
        amountInput
      );
      return { response: "❌ Failed to fetch swap quote. Please try again." };
    }

    session.tempData.toAmount = quote.data.outAmount;
    session.tempData.estimatedGas = quote.data.estimatedGas;
    session.currentAction = "buy_confirm";
    console.log(
      "[Buy] Saving session: userId =",
      userId,
      "currentAction =",
      session.currentAction,
      "tempData =",
      JSON.stringify(session.tempData)
    );
    await session.save();
    console.log(
      "[Buy] Session saved: userId =",
      userId,
      "currentAction =",
      session.currentAction
    );

    const fromAmount = formatEthBalance(amountWei);
    const toAmount = formatUnits(
      BigInt(quote.data.outAmount),
      session.tempData.toDecimals
    );

    return {
      response: formatTransactionDetails(
        session.tempData.fromSymbol,
        session.tempData.toSymbol,
        fromAmount,
        toAmount,
        selectedGasPriority,
        selectedSlippage
      ),
      buttons: [
        [
          { label: "✅ Confirm", callback: "confirm_yes" },
          { label: "❌ Cancel", callback: "confirm_no" },
        ],
      ],
    };
  } catch (error) {
    console.error(
      "[Buy] Error handling buy amount input for userId:",
      session?.userId,
      "input =",
      input,
      error
    );
    session.currentAction = undefined;
    session.tempData = {};
    await session.save();
    return { response: "❌ An error occurred. Please try again later." };
  }
}

export async function handleBuyConfirmation(
  context: CommandContext,
  confirmed: boolean
): Promise<{
  response: string;
  buttons?: { label: string; callback: string }[][];
}> {
  const { session, wallet } = context;
  try {
    if (!confirmed) {
      session.currentAction = undefined;
      session.tempData = {};
      console.log(
        "[Buy] Saving session: userId =",
        session.userId,
        "currentAction =",
        session.currentAction
      );
      await session.save();
      return { response: "Trade cancelled." };
    }

    const userId = session.userId;
    if (!userId) {
      return {
        response: "❌ Session expired. Please use /start to begin again.",
      };
    }

    if (!wallet) {
      return {
        response:
          "❌ Wallet not found. Please create or import a wallet first.",
      };
    }

    if (
      !session.tempData ||
      !session.tempData.fromToken ||
      !session.tempData.toToken ||
      !session.tempData.fromAmount ||
      !session.tempData.fromDecimals ||
      !session.tempData.walletAddress
    ) {
      console.warn(
        "[Buy] Invalid session.tempData for buy_confirm, userId:",
        userId,
        "tempData:",
        session.tempData
      );
      session.currentAction = undefined;
      session.tempData = {};
      await session.save();
      return {
        response: "❌ Invalid session state. Please restart with /buy.",
      };
    }

    const {
      fromToken,
      toToken,
      fromAmount,
      fromDecimals,
      walletAddress,
      gasPrice,
    } = session.tempData;
    const slippage = session.settings?.slippage.toString() || "1.0";
    const formattedFromAmount = formatUnits(BigInt(fromAmount), fromDecimals);

    console.log(
      "[Buy] Fetching swap for userId:",
      userId,
      "fromToken:",
      fromToken,
      "toToken:",
      toToken,
      "amount:",
      formattedFromAmount
    );
    const swap = await getSwap(
      fromToken,
      toToken,
      formattedFromAmount,
      gasPrice,
      slippage,
      walletAddress
    );

    console.log("[Buy] Executing transaction for userId:", userId);
    const receipt = await executeTransaction(wallet, {
      to: swap.data.to,
      data: swap.data.data,
      value: swap.data.value,
      gasPrice: swap.data.gasPrice,
    });

    console.log(
      "[Buy] Saving transaction for userId:",
      userId,
      "txHash:",
      receipt.transactionHash
    );
    saveTransaction(
      receipt.transactionHash,
      userId,
      wallet.address,
      fromToken,
      toToken,
      fromAmount,
      receipt.status,
      session.tempData.toAmount,
      receipt.gasUsed
    );

    session.currentAction = undefined;
    session.tempData = {};
    console.log(
      "[Buy] Saving session: userId =",
      userId,
      "currentAction =",
      session.currentAction
    );
    await session.save();

    if (receipt.status === "success") {
      return {
        response: `✅ Transaction Successful\n\nYou bought ${formatUnits(
          session.tempData.toAmount,
          session.tempData.toDecimals
        )} ${session.tempData.toSymbol}\nPrice impact: ${
          swap.data.price_impact
        }\nView on Block Explorer: https://basescan.org/tx/${
          receipt.transactionHash
        }`.replace(/`/g, ""),
      };
    } else {
      return {
        response:
          `❌ Transaction Failed\n\nView on Block Explorer: https://basescan.org/tx/${receipt.transactionHash}`.replace(
            /`/g,
            ""
          ),
      };
    }
  } catch (error) {
    console.error(
      "[Buy] Error processing buy confirmation for userId:",
      session?.userId,
      error
    );
    session.currentAction = undefined;
    session.tempData = {};
    console.log(
      "[Buy] Saving session: userId =",
      session.userId,
      "currentAction =",
      session.currentAction
    );
    await session.save();
    return {
      response:
        "❌ An error occurred while processing your trade. Please try again later.",
    };
  }
}
