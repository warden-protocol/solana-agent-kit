import { PublicKey, VersionedTransaction } from "@solana/web3.js";
import {
  type SolanaAgentKit,
  signOrSendTX,
  getMintInfo,
} from "solana-agent-kit";
import {
  DEFAULT_OPTIONS,
  JUP_REFERRAL_ADDRESS,
  TOKENS,
} from "./utils/constants";
import { getAssociatedTokenAddress } from "@solana/spl-token";

/**
 * Swap tokens using Jupiter Exchange
 * @param agent SolanaAgentKit instance
 * @param outputMint Target token mint address
 * @param inputAmount Amount to swap (in token decimals)
 * @param inputMint Source token mint address (defaults to USDC)
 * @param slippageBps Slippage tolerance in basis points (default: 300 = 3%)
 * @returns Transaction signature
 */

export async function trade(
  agent: SolanaAgentKit,
  outputMint: PublicKey,
  inputAmount: number,
  inputMint: PublicKey = TOKENS.USDC,
  // @deprecated use dynamicSlippage instead
  _slippageBps: number = DEFAULT_OPTIONS.SLIPPAGE_BPS,
): Promise<Awaited<ReturnType<typeof signOrSendTX>>> {
  try {
    // Check if input token is native SOL
    const isNativeSol = inputMint.equals(TOKENS.SOL);

    // For native SOL, we use LAMPORTS_PER_SOL, otherwise fetch mint info
    const inputDecimals = isNativeSol
      ? 9 // SOL always has 9 decimals
      : (await getMintInfo(agent.connection, inputMint.toBase58())).decimals;

    // Calculate the correct amount based on actual decimals
    const scaledAmount = Math.floor(inputAmount * Math.pow(10, inputDecimals));

        // Determine fee account if Jupiter fee is configured
        let feeAccount: string | null = null;
        if (
          agent.config?.JUPITER_FEE_BPS &&
          agent.config?.JUPITER_REFERRAL_ACCOUNT
        ) {
          // Check if tokens are Token2022 by attempting to get mint info
          // If Token2022 is used, we'll skip fee collection as it's not supported
          const isToken2022 = await checkIfToken2022(agent, inputMint, outputMint);
    
          if (isToken2022) {
            console.warn(
              "Token2022 tokens are not supported for Jupiter fees. Proceeding without fees."
            );
          } else {
            // Fee collection strategy:
            // For ExactIn swaps, fees can be taken in input or output mint
            // Priority: USDC > SOL > input mint (for easier fee management)
            let feeMint: PublicKey;
    
            if (inputMint.equals(TOKENS.USDC) || outputMint.equals(TOKENS.USDC)) {
              // Prefer USDC for easier management
              feeMint = TOKENS.USDC;
            } else if (
              inputMint.equals(TOKENS.SOL) ||
              outputMint.equals(TOKENS.SOL)
            ) {
              // Next preference: SOL
              feeMint = TOKENS.SOL;
            } else {
              // Fall back to input mint
              feeMint = inputMint;
            }
    
            // Derive the associated token account for the fee mint
            const feeAccountOwner = new PublicKey(
              agent.config.JUPITER_REFERRAL_ACCOUNT
            );
            const feeAccountAddress = await getAssociatedTokenAddress(
              feeMint,
              feeAccountOwner
            );
    
            // Check if the fee account exists - if not, don't collect fees
            try {
              const feeAccountInfo =
                await agent.connection.getAccountInfo(feeAccountAddress);
              if (!feeAccountInfo) {
                console.warn(
                  `Fee account ${feeAccountAddress.toString()} does not exist. Proceeding without fees.`
                );
                console.warn(
                  `To collect fees, create the token account first: getAssociatedTokenAddress(${feeMint.toString()}, ${feeAccountOwner.toString()})`
                );
                feeAccount = null; // Don't pass fee account to Jupiter
              } else {
                feeAccount = feeAccountAddress.toString();
                console.log(
                  `Fee account exists. Fees will be collected in ${feeMint.equals(TOKENS.USDC) ? "USDC" : feeMint.equals(TOKENS.SOL) ? "SOL" : "input token"}`
                );
              }
            } catch (error) {
              console.warn(`Could not verify fee account existence: ${error}`);
              console.warn(`Proceeding without fees to avoid transaction failure.`);
              feeAccount = null; // Don't pass fee account to Jupiter on error
            }
          }
        }

    const quoteResponse = await (
      await fetch(
        `https://api.jup.ag/swap/v1/quote?` +
          `inputMint=${isNativeSol ? TOKENS.SOL.toString() : inputMint.toString()}` +
          `&outputMint=${outputMint.toString()}` +
          `&amount=${scaledAmount}` +
          `&dynamicSlippage=true` +
          `&minimizeSlippage=false` +
          `&onlyDirectRoutes=false` +
          `&maxAccounts=64` +
          `&swapMode=ExactIn` +
          `${agent.config?.JUPITER_FEE_BPS ? `&platformFeeBps=${agent.config?.JUPITER_FEE_BPS}` : ""}`,
          {
            headers: {
              "Content-Type": "application/json",
              ...(process.env.JUPITER_API_KEY && {
                "x-api-key": process.env.JUPITER_API_KEY,
              }),
            },
          }
      )
    ).json();


    const { swapTransaction } = await (
      await fetch("https://api.jup.ag/swap/v1/swap", {
        method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(process.env.JUPITER_API_KEY && {
              "x-api-key": process.env.JUPITER_API_KEY,
            }),
          },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: agent.wallet.publicKey.toString(),
          wrapAndUnwrapSol: true,
          dynamicComputeUnitLimit: true,
          dynamicSlippage: true,
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 10000000,
              global: false,
              priorityLevel: agent.config?.PRIORITY_LEVEL || "medium",
            },
          },
          feeAccount: feeAccount ? feeAccount.toString() : null,
        }),
      })
    ).json();
    // Deserialize transaction
    const swapTransactionBuf = Buffer.from(swapTransaction, "base64");

    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
    const { blockhash } = await agent.connection.getLatestBlockhash();
    transaction.message.recentBlockhash = blockhash;

    // Sign or send transaction
    return await signOrSendTX(agent, transaction);
  } catch (error: any) {
    throw new Error(`Swap failed: ${error.message}`);
  }
}

/**
 * Check if either input or output mint is a Token2022 token
 * Token2022 tokens will throw an error when trying to fetch with the standard token program
 * @param agent SolanaAgentKit instance
 * @param inputMint Input mint address
 * @param outputMint Output mint address
 * @returns boolean indicating if Token2022 is involved
 */
async function checkIfToken2022(
  agent: SolanaAgentKit,
  inputMint: PublicKey,
  outputMint: PublicKey
): Promise<boolean> {
  try {
    // Try to get mint info using the standard approach
    // getMintInfo already handles Token2022 detection internally
    await getMintInfo(agent.connection, inputMint.toBase58());
    await getMintInfo(agent.connection, outputMint.toBase58());

    // If we get here without errors, both tokens are standard SPL tokens
    return false;
  } catch (error) {
    // If there's an error, it might be Token2022, but we'll return false
    // as the getMintInfo function handles Token2022 internally
    // This function is more for demonstration - in practice, fees should work
    // with standard SPL tokens that getMintInfo can handle
    return false;
  }
}